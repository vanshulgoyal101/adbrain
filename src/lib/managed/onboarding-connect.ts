/**
 * #526: set while onboarding's Facebook sign-in runs, so the completion page returns the attempt to
 * onboarding instead of the account picker. Holds a timestamp: a key older than 10 minutes is
 * ignored, and the onboarding tab clears its copy as soon as the popup answers or it unmounts, so a
 * later ordinary Connect in that tab is never redirected (QA, #570).
 */
export const ONBOARDING_CONNECT_KEY = "adbrain:onboarding-connect";
export const ONBOARDING_CONNECT_MAX_AGE_MS = 10 * 60_000;

export function markOnboardingConnect(storage: Storage, now = Date.now()): void {
  storage.setItem(ONBOARDING_CONNECT_KEY, String(now));
}

export function clearOnboardingConnect(storage: Storage): void {
  storage.removeItem(ONBOARDING_CONNECT_KEY);
}

/** Whether this completion belongs to onboarding; the key is used up either way. */
export function takeOnboardingConnect(storage: Storage, now = Date.now()): boolean {
  const started = Number(storage.getItem(ONBOARDING_CONNECT_KEY));
  clearOnboardingConnect(storage);
  return Number.isFinite(started) && started > 0 && now >= started && now - started < ONBOARDING_CONNECT_MAX_AGE_MS;
}
