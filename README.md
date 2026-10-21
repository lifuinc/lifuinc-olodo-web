# Olodo Educator & Vetting Portal (Web)

The official web portal for the **Olodo** multi-tier educational examination and active recall prep platform.

Hosted live on Firebase: **https://brainsquard-studio-b458b.web.app**

## Key Capabilities
- **Multi-Tier Question Bank Uploader:** Supports Tertiary (100L-600L/PGD/Masters), Senior Secondary (SSS 1-3), Junior Secondary (JSS 1-3), Primary (Basic 1-6), and National Exams (JAMB/WAEC/NECO).
- **Format Agnostic Parser:** Accepts pipe-delimited (`Question | Answer`), structured text, numbered lists, and full question bank formats with automatic answer hashing.
- **Academic Vetting Queue:** Super Admin approval workflow. Question packs remain pending until reviewed and approved by the vetting board before going live to mobile student devices.
- **Financials & Educator Payout Ledger:** Live tracking of student single-course and semester-pass purchases with 1-click Paystack Bulk Transfer CSV exports.
- **Mobile Responsive Drawer:** Clean, lightweight CSS/JS web dashboard designed for both desktop and mobile educator access.

## Architecture
- **Hosting:** Firebase Hosting
- **Database:** Cloud Firestore (`courses`, `lecturers`, `purchases`)
- **Authentication:** Firebase Auth (Google Sign-In & Email/Password)
- **Security:** Strict Firebase Security Rules ensuring student privacy and educator access isolation.
