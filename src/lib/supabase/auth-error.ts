import { AuthInvalidJwtError, isAuthApiError, isAuthSessionMissingError } from "@supabase/supabase-js";

const DEAD_SESSION_CODES = ["refresh_token_not_found", "refresh_token_already_used", "session_not_found", "bad_jwt"];

export function isSignedOutAuthError(error: unknown): boolean {
  return isAuthSessionMissingError(error) ||
    (isAuthApiError(error) && (error.status === 401 || error.status === 403));
}

/** A getClaims() failure that means the visitor has no usable session (not an Auth outage). */
export function isSignedOutClaimsError(error: unknown): boolean {
  return isSignedOutAuthError(error) || error instanceof AuthInvalidJwtError
    || (isAuthApiError(error) && DEAD_SESSION_CODES.includes(error.code ?? ""));
}
