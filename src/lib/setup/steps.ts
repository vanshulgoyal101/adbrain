/** Shared by server pages and the client spine: a "use client" module can't hand values to server code. */
/** #1251 WS1: the first-timer's three steps, in the owner's words. */
export const SETUP_STEPS = [
  { step: 1, label: "Your business", href: "/brand" },
  { step: 2, label: "Your ads", href: "/create" },
  { step: 3, label: "Go live", href: "/campaigns" },
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number]["step"];

/** A first-timer has no campaign that ever went live (`launched_at` is the first confirmed activation) or is on or finished (imported from Meta, or run before #672 recorded `launched_at`). */
export function firstTimer(campaigns: { launched_at: string | null; status?: string }[]): boolean {
  return !campaigns.some((campaign) => campaign.launched_at || campaign.status === "active" || campaign.status === "completed");
}
