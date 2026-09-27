import { isAuthApiError, isAuthSessionMissingError } from "@supabase/supabase-js";

export function isSignedOutAuthError(error: unknown): boolean {
  return isAuthSessionMissingError(error) ||
    (isAuthApiError(error) && (error.status === 401 || error.status === 403));
}