/**
 * #1414: why a sign-in callback failed, in a word the login page can explain with one action.
 * - `link_expired`: an email link opened late or twice (Supabase `otp_expired`).
 * - `other_browser`: the sign-in finished in a different browser than it started in (PKCE verifier missing). Email links
 *   come back with a `code` too, so this is usually a link opened inside Gmail or another app (QA 2, #1414).
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

/** What the login page's panel does for each reason (#1418). */
export type CallbackAction = "new_link" | "google" | "email" | "retry" | "help";

/** The CPO's #1418 words, verbatim: a title, a sentence, one primary and at most one secondary. No codes on screen. */
export const CALLBACK_ERRORS: Record<CallbackErrorReason, {
  title: string; text: string; primary: { action: CallbackAction; label: string }; secondary: { action: CallbackAction; label: string } | null;
}> = {
  link_expired: {
    title: "This sign-in link has expired",
    text: "Each link works once and only for a short time. We'll send you a fresh one.",
    primary: { action: "new_link", label: "Send a new link" }, secondary: { action: "google", label: "Use Google instead" },
  },
  other_browser: {
    title: "Google sign-in didn't finish here",
    text: "This happens when Google opens in a different app or tab. Try again in this browser, or get an email link.",
    primary: { action: "google", label: "Try Google again" }, secondary: { action: "email", label: "Email me a link instead" },
  },
  cancelled: {
    title: "Google sign-in was cancelled",
    text: "No problem. Try again, or sign in with an email link.",
    primary: { action: "google", label: "Try Google again" }, secondary: { action: "email", label: "Email me a link instead" },
  },
  auth: {
    title: "Sign-in didn't finish",
    text: "Please try once more. If it keeps happening, message us and we'll help.",
    primary: { action: "retry", label: "Try again" }, secondary: { action: "help", label: "Help on WhatsApp" },
  },
};

/** Supabase's older links put the error in the fragment (`/login#error_code=otp_expired`); read it the same way. */
export function hashCallbackError(hash: string): CallbackErrorReason | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const code = params.get("error_code") ?? params.get("error");
  return code ? callbackErrorReason(code) : null;
}

/** A reason from the address, never free text from it. */
export function parseCallbackError(value: string | null): CallbackErrorReason | null {
  if (!value) return null;
  return value in CALLBACK_ERRORS ? value as CallbackErrorReason : "auth";
}
