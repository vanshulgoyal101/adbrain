import { z } from "zod";

/** How an owner signs in (#451 L4). */
export const AUTH_METHODS = ["password", "email_link", "google"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

/** Supabase Auth error codes worth telling apart; anything else is "other". Never the email or message. */
export const AUTH_CODES = [
  "invalid_credentials", "email_not_confirmed", "over_email_send_rate_limit", "over_request_rate_limit",
  "otp_expired", "otp_disabled", "signup_disabled", "user_banned", "validation_failed", "email_address_invalid",
  "email_address_not_authorized", "flow_state_not_found", "flow_state_expired", "bad_code_verifier",
  "bad_oauth_state", "bad_oauth_callback", "provider_disabled", "email_provider_disabled", "request_timeout",
  "captcha_failed", "unexpected_failure", "network", "other",
] as const;
export type AuthCode = (typeof AUTH_CODES)[number];

export const authOutcomeSchema = z.union([
  z.strictObject({ method: z.enum(AUTH_METHODS), outcome: z.literal("failed"), code: z.enum(AUTH_CODES) }),
  z.strictObject({ method: z.enum(AUTH_METHODS), outcome: z.enum(["success", "started"]) }),
]);
export type AuthOutcome = z.infer<typeof authOutcomeSchema>;

/** The reportable code of a Supabase Auth error. */
export function authCode(error: unknown): AuthCode {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (typeof code === "string" && (AUTH_CODES as readonly string[]).includes(code)) return code as AuthCode;
  return error instanceof TypeError ? "network" : "other";
}

/** A code from a URL or provider, kept only when it is a plain identifier. */
export function safeAuthCode(code: string | null | undefined): string {
  return code && /^[a-z0-9_]{1,60}$/.test(code) ? code : "other";
}
