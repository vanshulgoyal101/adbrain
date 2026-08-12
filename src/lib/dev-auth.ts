/**
 * Local developer bypass. When NEXT_PUBLIC_DEV_AUTH_BYPASS=true, the app can be
 * browsed as a fixed "developer" identity without a real Supabase session —
 * useful for local UI work when the backend isn't reachable. This module is
 * edge-safe (no next/headers, no server-only deps) so it can be used from both
 * the proxy middleware and server components.
 */

export const DEV_AUTH_COOKIE = "adbrain_dev_auth";

/** Minimal user shape the app needs (id for RLS, email for display). */
export interface AppUser {
  id: string;
  email: string | null;
}

/** The seeded developer identity (matches the documented dev user id). */
export const DEV_USER: AppUser = {
  id: "adfbc844-6d5b-46b0-9de6-71229a977430",
  email: "dev@adbrain.local",
};

/** Dev bypass is only ever active when explicitly enabled via env. */
export function isDevAuthEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "true";
}
