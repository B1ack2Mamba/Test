// Feature flags for payment-related UX and server billing.
//
// - PAYMENTS_UI_ENABLED: shows wallet/top-up/pricing in the UI.
// - PAYMENTS_ENABLED: performs actual wallet debits in API routes.
// - TRAINING_SELF_REVEAL_ENABLED: allows a participant to unlock their own digits in training.
//
// Defaults: everything OFF.

export const PAYMENTS_UI_ENABLED = process.env.NEXT_PUBLIC_PAYMENTS_ENABLED === "1";

// Server-side flags (API routes). Next will inline process.env at build time.
export const PAYMENTS_ENABLED = process.env.PAYMENTS_ENABLED === "1";
export const TRAINING_SELF_REVEAL_ENABLED = process.env.TRAINING_SELF_REVEAL_ENABLED === "1";
