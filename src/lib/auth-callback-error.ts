/**
 * #1414: why a sign-in callback failed, in a word the login page can explain with one action.
 * - `link_expired`: an email link opened late or twice (Supabase `otp_expired`).
 * - `other_browser`: Google finished in a different browser than it started in (PKCE verifier missing).
 * - `cancelled`: the owner backed out of Google.
 */
export type CallbackErrorReason = "link_expired" | "other_browser" | "cancelled" | "auth";

export function callbackErrorReason(code: string | null | undefined): CallbackErrorReason {
  switch (code) {
    case "otp_expired":
      return "link_expired";
    case "pkce_code_verifier_not_found":
    case "bad_code_verifier":
    case "flow_state_not_found":
    case "flow_state_expired":
      return "other_browser";
    case "access_denied":
      return "cancelled";
    default:
      return "auth";
  }
}

/** What the login page says for each reason, and the one action it offers. */
export const CALLBACK_ERRORS: Record<CallbackErrorReason, { text: string; action: "new_link" | "google" | null }> = {
  link_expired: { text: "That sign-in link has expired or was already used. Each link works once, within an hour.", action: "new_link" },
  other_browser: { text: "Google sign-in has to finish in the browser where it started. Start it again here.", action: "google" },
  cancelled: { text: "Sign-in was cancelled. Nothing changed.", action: null },
  auth: { text: "Sign-in failed. Please try again.", action: null },
};

/** A reason from the address, never free text from it. */
export function parseCallbackError(value: string | null): CallbackErrorReason | null {
  if (!value) return null;
  return value in CALLBACK_ERRORS ? value as CallbackErrorReason : "auth";
}
