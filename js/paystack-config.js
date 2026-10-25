import { ENV } from "./env.js";

// Olodo Paystack Configuration
// Centralized in js/env.js (.env equivalent)
export const PAYSTACK_PUBLIC_KEY = ENV.PAYSTACK_PUBLIC_KEY || "pk_test_c68612984920803452f10928a47a192801928374";

/**
 * Initiates Paystack inline checkout popup.
 * Supports Bank Transfer, USSD, OPay, Palmpay, and Cards.
 */
export function initializePaystackPayment({
  email,
  amountInNaira,
  metadata,
  onSuccess,
  onClose,
}) {
  const handler = PaystackPop.setup({
    key: PAYSTACK_PUBLIC_KEY,
    email: email.trim(),
    amount: amountInNaira * 100, // Paystack expects amount in Kobo
    currency: "NGN",
    channels: ["card", "bank", "ussd", "qr", "mobile_money", "bank_transfer"],
    metadata: {
      custom_fields: [
        {
          display_name: "Student Email",
          variable_name: "student_email",
          value: email,
        },
        {
          display_name: "Pass Type",
          variable_name: "pass_type",
          value: metadata.passType || "Pass",
        },
        {
          display_name: "Course Code",
          variable_name: "course_code",
          value: metadata.courseCode || "All",
        },
        {
          display_name: "Academic Level",
          variable_name: "academic_level",
          value: metadata.level || "General",
        },
      ],
    },
    callback: function (response) {
      // response contains { reference: "..." }
      if (onSuccess) onSuccess(response);
    },
    onClose: function () {
      if (onClose) onClose();
    },
  });

  handler.openIframe();
}
