const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();

// Paystack Webhook Handler (Cloud Functions v2)
// Triggered directly by Paystack servers upon confirmed payment
exports.paystackWebhook = onRequest(
  {
    cors: false,
    maxInstances: 10,
    region: "us-central1",
  },
  async (req, res) => {
    // Only accept POST requests
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
          purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
          expiresAt: expiresAt,
          gatewayResponse: data.gateway_response || "Successful",
          ipAddress: data.ip_address || "",
          verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (reference) {
          await db
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
