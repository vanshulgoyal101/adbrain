import type { AuthOutcome } from "./auth-events";

/** Tells the server how a browser sign-in step ended (#451 L4); fire-and-forget, never the email. */
export function reportAuthOutcome(outcome: AuthOutcome): void {
  if (process.env.NEXT_PUBLIC_PRODUCT_LOGGING_ENABLED === "false" || navigator.doNotTrack === "1"
    || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return;
  try {
    void fetch("/api/auth/outcome", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", keepalive: true,
      body: JSON.stringify(outcome),
    }).catch(() => {});
  } catch {
    // Telemetry must never affect sign-in.
  }
}
