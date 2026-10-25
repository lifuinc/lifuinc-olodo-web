// =========================================================================
// OLODO PLATFORM ENVIRONMENT CONFIGURATION (.ENV EQUIVALENT)
// =========================================================================
// Paste your platform API keys here in this central configuration file.
// Lecturers will NEVER see these keys; the platform uses them automatically.
// =========================================================================

export const ENV = {
  // 1. Google Gemini AI API Key (Powers the NOUN CBT Exam Generator)
  // Paste your key from https://aistudio.google.com/apikey here:
  GEMINI_API_KEY: "",

  // 2. Paystack Public Key (For student payments & course checkout)
  // Paste your key from https://dashboard.paystack.co/#/settings/developer
  // Use 'pk_test_...' for testing or 'pk_live_...' for production
  PAYSTACK_PUBLIC_KEY: "pk_test_c68612984920803452f10928a47a192801928374",

  // 3. Platform Environment ('development' | 'production')
  ENVIRONMENT: "production",
};
