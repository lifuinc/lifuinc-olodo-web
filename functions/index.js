const { onRequest } = require("firebase-functions/v2/https");
const crypto = require("crypto");

let adminInstance = null;
let db = null;

function getAdmin() {
  if (!adminInstance) {
    adminInstance = require("firebase-admin");
  }
  return adminInstance;
}

function getDb() {
  if (!db) {
    const admin = getAdmin();
    if (!admin.apps.length) admin.initializeApp();
    db = admin.firestore();
  }
  return db;
}

// =========================================================================
// 1. PAYSTACK WEBHOOK HANDLER (Cloud Functions v2)
// =========================================================================
// Triggered directly by Paystack servers upon confirmed student payment
// Automatically credits purchases even during network drops / USSD delays
// =========================================================================
exports.paystackWebhook = onRequest(
  {
    cors: false,
    maxInstances: 10,
    region: "us-central1",
  },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    const secretKey =
      process.env.PAYSTACK_SECRET_KEY ||
      "sk_test_e606ff23917afc349b1d20c9ef4f6be7469b4f74";

    const signature = req.headers["x-paystack-signature"];
    if (!signature) {
      console.warn("Webhook rejected: Missing x-paystack-signature header");
      return res.status(401).send("Missing signature");
    }

    try {
      const hash = crypto
        .createHmac("sha512", secretKey)
        .update(req.rawBody)
        .digest("hex");

      if (hash !== signature) {
        console.warn("Webhook rejected: Signature mismatch");
        return res.status(401).send("Invalid signature");
      }
    } catch (err) {
      console.error("Signature computation error:", err);
      return res.status(500).send("Verification error");
    }

    const event = req.body;
    console.log(`Verified Paystack Event: ${event?.event}`);

    try {
      if (event && event.event === "charge.success") {
        const data = event.data || {};
        const meta = data.metadata || {};

        const email = (data.customer?.email || meta.email || "").toLowerCase().trim();
        const reference = (data.reference || "").trim();
        const courseCode = (meta.courseCode || "").toUpperCase().trim();
        const level = meta.level || "General";
        const semester = meta.semester || meta.period || "1st Semester";
        const passType =
          meta.passType ||
          (courseCode && courseCode !== "ALL"
            ? `single_course_${courseCode.toLowerCase().replace(/[^a-z0-9]/g, "")}`
            : "semester_pass_180days");
        const amountInNaira = data.amount ? Math.round(data.amount / 100) : 0;

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);

        const purchaseDoc = {
          userEmail: email,
          userId: email,
          reference: reference,
          type: passType,
          courseCode: courseCode,
          level: level,
          semester: semester,
          price: amountInNaira.toString(),
          channel: "paystack_webhook",
          status: "verified",
          purchasedAt: getAdmin().firestore.FieldValue.serverTimestamp(),
          expiresAt: expiresAt,
          gatewayResponse: data.gateway_response || "Successful",
          ipAddress: data.ip_address || "",
          verifiedAt: getAdmin().firestore.FieldValue.serverTimestamp(),
        };

        if (reference) {
          await getDb()
            .collection("purchases")
            .doc(reference)
            .set(purchaseDoc, { merge: true });

          console.log(
            `✓ Purchase recorded: Ref=${reference}, Email=${email}, Type=${passType}, Course=${courseCode}`
          );
        }
      }

      return res.status(200).send("Webhook received");
    } catch (err) {
      console.error("Error processing webhook:", err);
      return res.status(200).send("Error logged");
    }
  }
);

// =========================================================================
// 2. SECURE GEMINI QUESTION GENERATOR (Cloud Functions v2)
// =========================================================================
// Protects Gemini API keys server-side (never exposed to browser / client JS)
// Automatically falls back to Paid Key when Free Key quota is exhausted (429)
// =========================================================================
exports.generateQuestions = onRequest(
  {
    cors: true,
    maxInstances: 10,
    region: "us-central1",
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed. Use POST." });
    }

    const { batchText, courseContext, batchIndex = 0, totalBatches = 1 } = req.body || {};
    if (!batchText || typeof batchText !== "string" || !batchText.trim()) {
      return res.status(400).json({ error: "Missing or invalid batchText parameter." });
    }

    const primaryKey = (process.env.GEMINI_PRIMARY_KEY || process.env.GEMINI_API_KEY || "").trim();
    const fallbackKey = (process.env.GEMINI_FALLBACK_KEY || "").trim();

    if (!primaryKey && !fallbackKey) {
      return res.status(500).json({
        error: "Server Gemini API Key is not configured. Please set GEMINI_PRIMARY_KEY in functions/.env."
      });
    }

    const contextInstruction = courseContext && courseContext.trim().length > 0
      ? `\nCOURSE CONTEXT: "${courseContext.trim()}". Distractors MUST be plausible scholars, theories, terms, or historical dates strictly relevant to this course.`
      : "";

    const systemPrompt = `You are a NOUN CBT exam generator.

TASK:
Convert every single fill-in-the-blank / Q&A entry in the provided text into a 4-option multiple-choice question.

STRICT CONSTRAINTS:
1. DO NOT rephrase, modernize, or rewrite the sentences. Keep the EXACT verbatim text and blank line from the source.
2. The correct answer MUST be the verbatim answer given directly underneath each item in the text.
3. Create 3 plausible distractors (options) relevant to the course context.${contextInstruction}
4. Output strict JSON array only.

Output JSON Schema:
[
  {
    "question": "_____ inferred that without conflict we cannot have change",
    "options": ["Ross (1993)", "Quicy Wright (1990)", "Kriesberg (1973)", "Stagner"],
    "answer": "Ross (1993)",
    "explanation": "Ross (1993) inferred that without conflict we cannot have change."
  }
]`;

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [
            { text: `Process this batch (${Number(batchIndex) + 1} of ${totalBatches}) of raw entries:\n\n${batchText}` }
          ]
        }
      ],
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2
      }
    };

    // Helper to call Gemini REST API
    async function callGemini(apiKey) {
      const models = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.8-flash"];
      let lastErr = null;

      for (const model of models) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody)
          });

          if (response.ok) {
            const data = await response.json();
            return { success: true, data };
          }

          const errJson = await response.json().catch(() => ({}));
          const status = response.status;
          const msg = errJson?.error?.message || `HTTP ${status}`;
          lastErr = { status, msg };

          // If rate limit / quota exceeded (429), return immediately to trigger fallback key
          if (status === 429) {
            return { success: false, isQuotaExceeded: true, error: msg };
          }
        } catch (fetchErr) {
          lastErr = { status: 0, msg: fetchErr.message };
        }
      }

      return {
        success: false,
        isQuotaExceeded: false,
        error: lastErr?.msg || "Unknown Gemini API error"
      };
    }

    try {
      let result = null;
      let usedFallback = false;

      // 1. Try Primary Key (Free)
      if (primaryKey) {
        result = await callGemini(primaryKey);
      }

      // 2. If Primary failed due to quota limit (429) or failed and Fallback Key exists, try Fallback
      if ((!result || !result.success) && fallbackKey) {
        console.warn(`[Gemini Proxy] Primary key failed or quota exhausted. Switching to Fallback Key...`);
        result = await callGemini(fallbackKey);
        usedFallback = true;
      }

      if (!result || !result.success) {
        return res.status(502).json({
          error: `Gemini generation failed: ${result?.error || "All available keys failed"}`
        });
      }

      const candidate = result.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!candidate) {
        return res.status(502).json({ error: "Gemini returned empty candidate text." });
      }

      let parsedQuestions;
      try {
        parsedQuestions = JSON.parse(candidate);
      } catch (e) {
        const cleaned = candidate.replace(/```json/g, "").replace(/```/g, "").trim();
        parsedQuestions = JSON.parse(cleaned);
      }

      if (!Array.isArray(parsedQuestions)) {
        return res.status(502).json({ error: "Gemini returned non-array JSON response." });
      }

      function shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      }

      const formatted = parsedQuestions.map((q, idx) => {
        const questionText = (q.question || q.text || "").trim();
        const correctAnswer = (q.answer || q.correctAnswer || "").trim();
        let options = Array.isArray(q.options) ? q.options.map((o) => String(o).trim()) : [];

        if (!options.includes(correctAnswer)) {
          options.push(correctAnswer);
        }

        while (options.length < 4) {
          options.push(`Alternative Option ${options.length + 1}`);
        }
        if (options.length > 4) {
          const distractors = options.filter((o) => o !== correctAnswer).slice(0, 3);
          options = [correctAnswer, ...distractors];
        }

        options = shuffle(options);

        return {
          id: `ai_${Date.now()}_${batchIndex}_${idx + 1}`,
          question: questionText,
          options,
          answer: correctAnswer,
          explanation: (q.explanation || `${correctAnswer} is the verified answer.`).trim(),
        };
      });

      return res.status(200).json({
        success: true,
        usedFallback,
        questions: formatted,
      });
    } catch (err) {
      console.error("Error in generateQuestions Cloud Function:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  }
);
