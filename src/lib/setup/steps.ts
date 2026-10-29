/** Shared by server pages and the client spine: a "use client" module can't hand values to server code. */
/** #1251 WS1: the first-timer's three steps, in the owner's words. */
export const SETUP_STEPS = [
  { step: 1, label: "Your business", href: "/brand" },
  { step: 2, label: "Your ads", href: "/create" },
  { step: 3, label: "Go live", href: "/campaigns" },
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number]["step"];

export type LiveSignals = {
  launched_at: string | null;
  status?: string;
  meta_campaign_id?: string | null;
  /** `raw.source`; AdBrain's own creates are "campaign_operation". */
  source?: string | null;
  raw?: unknown;
};

/**
 * Whether a campaign ever went live: AdBrain activated it (`launched_at`, #672), it is on or finished, or it was
 * imported from Meta (#1403: a Meta campaign AdBrain didn't create, even if paused now). Go live's own campaign is
 * created paused first, so a `campaign_operation` row counts only once it's activated.
 */
export function wentLive(campaign: LiveSignals): boolean {
  if (campaign.launched_at || campaign.status === "active" || campaign.status === "completed") return true;
  const raw = campaign.raw && typeof campaign.raw === "object" ? campaign.raw as { source?: unknown } : null;
  const source = campaign.source !== undefined ? campaign.source : typeof raw?.source === "string" ? raw.source : null;
  return Boolean(campaign.meta_campaign_id) && source !== "campaign_operation";
}

/** A first-timer has no campaign that went live (`wentLive`). */
export function firstTimer(campaigns: LiveSignals[]): boolean {
  return !campaigns.some(wentLive);
}

/**
 * #1934 (#1475): step 1's Make my ads tap, kept for one arrival at step 2. A returning owner's step 2 starts a paid
 * batch only with it, so a reload, bookmark or Back to `/create?again=1` shows the Make 3 ads tap instead.
 */
const MAKE_TAP_MS = 2 * 60 * 1000;
const makeTapKey = (businessId: string) => `setup-make-tap:${businessId}`;
export function markMakeTap(businessId: string) {
  try { window.sessionStorage.setItem(makeTapKey(businessId), String(Date.now())); } catch { /* step 2 shows the tap */ }
}
export function takeMakeTap(businessId: string): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(makeTapKey(businessId)));
    window.sessionStorage.removeItem(makeTapKey(businessId));
    return at > 0 && Date.now() - at < MAKE_TAP_MS;
  } catch { return false; }
}
