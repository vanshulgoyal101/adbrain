/** Shared by server pages and the client spine: a "use client" module can't hand values to server code. */
/** #1251 WS1: the first-timer's three steps, in the owner's words. */
export const SETUP_STEPS = [
  { step: 1, label: "Your business", href: "/brand" },
  { step: 2, label: "Your ads", href: "/create" },
  { step: 3, label: "Go live", href: "/campaigns" },
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number]["step"];

/** A first-timer has no campaign that ever went live (`launched_at` is the first confirmed activation) or is on or finished (imported from Meta, or run before #672 recorded `launched_at`). */
export function wentLive(campaign: {
  launched_at: string | null;
  status?: string;
  meta_campaign_id?: string | null;
  raw?: { source?: string | null } | null;
}): boolean {
  if (campaign.launched_at || campaign.status === "active" || campaign.status === "completed") return true;
  if (!campaign.meta_campaign_id) return false;
  const source = campaign.raw && typeof campaign.raw === "object" && !Array.isArray(campaign.raw) ? campaign.raw.source : undefined;
  return source !== "campaign_operation";
}

export function firstTimer(campaigns: {
  launched_at: string | null;
  status?: string;
  meta_campaign_id?: string | null;
  raw?: { source?: string | null } | null;
}[]): boolean {
  return !campaigns.some(wentLive);
}
