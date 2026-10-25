// =========================================================================
// OLODO PLATFORM ENVIRONMENT CONFIGURATION TEMPLATE (env.example.js)
// =========================================================================
// Copy this file to env.js and insert your keys.
// Lecturers will NEVER see these keys; the platform uses them automatically.
// =========================================================================

export const ENV = {
  // 1. Google Gemini AI API Key (Powers the NOUN CBT Exam Generator)
  GEMINI_API_KEY: "your_gemini_api_key_here",

  // 2. Paystack Public Key (For student payments & course checkout)
  PAYSTACK_PUBLIC_KEY: "pk_test_your_paystack_public_key_here",

  // 3. Platform Environment ('development' | 'production')
  ENVIRONMENT: "production",
};
