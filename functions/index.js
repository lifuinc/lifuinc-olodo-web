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

    const secretKey = (process.env.PAYSTACK_SECRET_KEY || "").trim();
    if (!secretKey) {
      console.error("Webhook error: Missing PAYSTACK_SECRET_KEY env var");
      return res.status(500).send("Server configuration error");
    }

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
        const quantity = Math.max(1, Math.min(200, Number(meta.quantity) || 1));
        const unitPrice = Number(meta.unitPrice) || amountInNaira;
        const discountApplied = Boolean(meta.discountApplied || quantity > 5);
        const voucherPins = Array.isArray(meta.voucherPins) ? meta.voucherPins : [];

        const isMonthly =
          String(passType).toLowerCase() === "monthly" ||
          String(passType).toLowerCase().startsWith("monthly_pass");
        const durationDays = isMonthly ? 30 : 180;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

        const purchaseDoc = {
          userEmail: email,
          userId: email,
          reference: reference,
          type: passType,
          courseCode: courseCode,
          level: level,
          semester: semester,
          quantity: quantity,
          unitPrice: unitPrice,
          discountApplied: discountApplied,
          voucherPins: voucherPins,
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

          if (voucherPins.length > 0) {
            const pinType =
              courseCode && courseCode !== "ALL" && String(passType).includes("single")
                ? "single_course"
                : isMonthly
                  ? "monthly"
                  : "full";
            const batch = getDb().batch();
            for (const rawPin of voucherPins) {
              const cleanPin = String(rawPin || "").trim().toUpperCase();
              if (!cleanPin) continue;
              const pinRef = getDb().collection("institutional_pins").doc(cleanPin);
              batch.set(
                pinRef,
                {
                  pin: cleanPin,
                  type: pinType,
                  courseCode: pinType === "single_course" ? courseCode : "",
                  level: level === "General" ? "" : level,
                  semester: semester,
                  maxRedemptions: 1,
                  timesRedeemed: 0,
                  active: true,
                  faceValue: unitPrice,
                  channel: "paystack_self_service",
                  buyerEmail: email,
                  paystackReference: reference,
                  note: `Self-Service (${quantity} PIN${quantity > 1 ? "s" : ""}${discountApplied ? " · 10% Off" : ""})`,
                  createdAt: getAdmin().firestore.FieldValue.serverTimestamp(),
                },
                { merge: true }
              );
            }
            await batch.commit();
          }

          console.log(
            `✓ Purchase recorded: Ref=${reference}, Email=${email}, Type=${passType}, Qty=${quantity}`
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
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed. Use POST." });
    }

    const {
      batchText,
      courseContext,
      batchIndex = 0,
      totalBatches = 1,
      allowFallback = false,
      batchType = "extract",
      includeDiagrams = true,
      pageImages = []
    } = req.body || {};
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
      ? `\nCOURSE CONTEXT: "${courseContext.trim()}". Distractors MUST be plausible scholars, theories, formulas, terms, or historical dates strictly relevant to this course.`
      : "";

    const diagramInstruction = includeDiagrams
      ? `\nDIAGRAM GENERATION RULE (diagramSvg):
- If a question involves a graph (e.g., straight-line graph y = mx + c, T² vs M graph, slope/intercept, I-V curve, supply/demand curve), scientific apparatus (spiral spring, pendulum, vernier caliper, micrometer, circuit diagram, optics ray), logic gate, chemical structure, or biological structure/diagram (or corresponds to a figure in an attached PDF page image), generate a clean, textbook-grade SVG illustration in the "diagramSvg" field.
- The "diagramSvg" MUST be a valid, self-contained XML string starting with <svg viewBox="0 0 400 260" xmlns="http://www.w3.org/2000/svg"> and ending with </svg>.
- Always include a clean light background <rect width="400" height="260" rx="12" fill="#f8fafc"/>, crisp dark axes/lines (#1e293b), accent curves/shapes (#0284c7, #16a34a, #ea580c), and legible labels (font-family="sans-serif" font-size="12" font-weight="bold" fill="#0f172a").
- NEVER copy watermarks or phone numbers from the PDF.
- If a question is purely conceptual/textual and does NOT benefit from a diagram, set "diagramSvg": null.`
      : `\n- Do NOT generate diagrams; set "diagramSvg": null for all items.`;

    const extractPrompt = `You are an expert NOUN (National Open University of Nigeria) CBT exam generator.

TASK:
Convert every single Past Question entry (separated by ---) in the provided text into a 4-option multiple-choice question.

STRICT ACCURACY & EXTRACTION CONSTRAINTS:
1. Keep the core question sentence faithful to the NOUN source. Strip any leading labels like "MCQ1", "FBQ12", "Q1." and ignore any third-party watermarks or phone numbers.
2. HOW TO IDENTIFY THE EXACT CORRECT ANSWER:
   - Case A (Explicit Answer Line): If the entry has "Answer: <value>" or a separate answer line underneath the question, that <value> MUST be the exact correct answer.
   - Case B (Inline Answer After Blank): If the answer is written inline right after a blank line on the same line (for example: "When biologists choose to learn about organisms in their natural habitats it is called____ Field study"), extract "Field study" as the correct "answer", and replace the trailing inline answer in the "question" with a clean blank "_____". NEVER ignore an inline answer after a blank!
3. Create 3 plausible, academic distractors relevant to the question and course so there are 4 options total (including the exact correct answer).${contextInstruction}${diagramInstruction}
4. Output a strict JSON array only.

Output JSON Schema:
[
  {
    "question": "When biologists choose to learn about organisms in their natural habitats it is called _____",
    "options": ["Field study", "Laboratory study", "Taxonomy", "Ecology survey"],
    "answer": "Field study",
    "explanation": "Studying organisms directly in their natural habitat is known as a field study.",
    "diagramSvg": null
  }
]`;

    const summaryPrompt = `You are an expert NOUN (National Open University of Nigeria) CBT exam generator.

TASK:
Read the provided NOUN Course Summary / Lecture Note passage and generate between 5 and 8 high-yield, exam-standard 4-option multiple-choice questions (and fill-in-the-blank style CBT questions) that test the formulas, definitions, experimental graphs/slopes, apparatus, and key facts in this passage.

STRICT CONSTRAINTS:
1. Every question and its verified "answer" MUST be 100% factually grounded in the provided summary passage.
2. Ignore any third-party watermarks, tutor names, or phone numbers in the text.
3. Provide 4 distinct options (the 1 exact correct answer + 3 plausible academic distractors) and a clear 1-sentence explanation.${contextInstruction}${diagramInstruction}
4. Output a strict JSON array only.

Output JSON Schema:
[
  {
    "question": "In the spiral spring experiment, a graph of T² plotted on the vertical axis against mass M on the horizontal axis gives a straight line with slope equal to _____",
    "options": ["4π²/k", "2π/k", "k/4π²", "g/L"],
    "answer": "4π²/k",
    "explanation": "From T² = (4π²/k)M + (4π²/k)m₀, the slope of T² against M is 4π²/k.",
    "diagramSvg": "<svg viewBox=\\"0 0 400 260\\" xmlns=\\"http://www.w3.org/2000/svg\\"><rect width=\\"400\\" height=\\"260\\" rx=\\"12\\" fill=\\"#f8fafc\\"/>...</svg>"
  }
]`;

    const systemPrompt = batchType === "summary" ? summaryPrompt : extractPrompt;

    const userParts = [
      {
        text: batchType === "summary"
          ? `Generate NOUN CBT exam questions from this course summary passage (Batch ${Number(batchIndex) + 1} of ${totalBatches}):\n\n${batchText}`
          : `Process this batch (${Number(batchIndex) + 1} of ${totalBatches}) of NOUN past question entries:\n\n${batchText}`
      }
    ];

    if (Array.isArray(pageImages) && pageImages.length > 0) {
      for (const img of pageImages.slice(0, 3)) {
        if (img && img.data) {
          userParts.push({
            inlineData: {
              mimeType: img.mimeType || "image/jpeg",
              data: img.data
            }
          });
        }
      }
    }

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: userParts
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

    // Helper to call Gemini REST API with per-request timeout protection
    async function callGemini(apiKey, modelsToTry) {
      let lastErr = null;

      for (const model of modelsToTry) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 55000);

        // Disable thinking token overhead on gemini-3.5-flash so 10 questions finish in ~5s
        const modelBody = {
          ...requestBody,
          generationConfig: {
            ...requestBody.generationConfig,
            ...(model === "gemini-3.5-flash" ? { thinkingConfig: { thinkingBudget: 0 } } : {})
          }
        };

        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(modelBody),
            signal: controller.signal
          });
          clearTimeout(timer);

          if (response.ok) {
            const data = await response.json();
            return { success: true, data };
          }

          const errJson = await response.json().catch(() => ({}));
          const status = response.status;
          const msg = errJson?.error?.message || `HTTP ${status}`;
          lastErr = { status, msg };

          // Check if Daily quota is completely exhausted vs temporary per-minute rate limit
          if (status === 429) {
            const isDailyExhausted = /per\s*day|daily|GenerateRequestsPerDay/i.test(msg);
            return {
              success: false,
              isQuotaExceeded: true,
              isDailyExhausted,
              error: msg
            };
          }
        } catch (fetchErr) {
          clearTimeout(timer);
          lastErr = {
            status: 503,
            msg: fetchErr.name === "AbortError" ? "Model request timed out" : fetchErr.message
          };
        }
      }

      return {
        success: false,
        isQuotaExceeded: false,
        isDailyExhausted: false,
        error: lastErr?.msg || "Unknown Gemini API error"
      };
    }

    try {
      let result = null;
      let usedFallback = false;

      // 1. Always try Primary Key (Free) first on verified 3.5 models
      if (primaryKey) {
        result = await callGemini(primaryKey, ["gemini-3.5-flash", "gemini-3.5-flash-lite"]);
      }

      // 2. Only switch to Paid Fallback Key if:
      //    - Primary Key's Daily Quota is exhausted, OR
      //    - The client has already completed its patient Free-Tier cooldown retries (allowFallback === true), OR
      //    - No primaryKey is configured
      const shouldUseFallback =
        (!result || !result.success) &&
        fallbackKey &&
        (!primaryKey || result?.isDailyExhausted || allowFallback === true);

      if (shouldUseFallback) {
        console.warn(`[Gemini Proxy] Switching to Fallback Key (allowFallback=${allowFallback}, dailyExhausted=${!!result?.isDailyExhausted})...`);
        result = await callGemini(fallbackKey, ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash"]);
        usedFallback = true;
      }

      if (!result || !result.success) {
        // Tell the client this batch can be retried after a brief pacing pause on the Primary Key
        return res.status(429).json({
          retryable: true,
          error: result?.error || "AI service busy, retrying batch..."
        });
      }

      const parts = result.data?.candidates?.[0]?.content?.parts || [];
      const jsonPart = [...parts].reverse().find((p) => p.text && !p.thought) || parts[0];
      const candidate = jsonPart?.text;
      if (!candidate) {
        return res.status(502).json({ error: "Gemini returned empty candidate text." });
      }

      let parsedQuestions;
      try {
        parsedQuestions = JSON.parse(candidate);
      } catch (e) {
        const cleaned = candidate.replace(/```json/gi, "").replace(/```/g, "").trim();
        const startIdx = cleaned.indexOf("[");
        const endIdx = cleaned.lastIndexOf("]");
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          parsedQuestions = JSON.parse(cleaned.slice(startIdx, endIdx + 1));
        } else {
          parsedQuestions = JSON.parse(cleaned);
        }
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

        let diagramSvg = null;
        if (q.diagramSvg && typeof q.diagramSvg === "string") {
          const rawSvg = q.diagramSvg.trim();
          const svgStart = rawSvg.indexOf("<svg");
          const svgEnd = rawSvg.lastIndexOf("</svg>");
          if (svgStart !== -1 && svgEnd !== -1 && svgEnd > svgStart) {
            diagramSvg = rawSvg
              .slice(svgStart, svgEnd + 6)
              .replace(/<script[\s\S]*?<\/script>/gi, "");
          }
        }

        return {
          id: `ai_${Date.now()}_${batchIndex}_${idx + 1}`,
          question: questionText,
          options,
          answer: correctAnswer,
          explanation: (q.explanation || `${correctAnswer} is the verified answer.`).trim(),
          diagramSvg,
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
