import type { TrackingEvent, TrackingStatus } from "@/lib/meta/pixels";
import type { WebsiteGoal } from "@/lib/types/campaign";
import { websiteButton } from "@/lib/campaign/website-button";

/** #2714 (#2595 C2): a signup or sales goal; visits need no tracking. */
export type ConversionGoal = Exclude<WebsiteGoal, "visits">;

/** The Brand's chosen tracking (null when none is chosen) and what Meta reported for it; null status = not read. */
export type ReviewTracking = { pixelId: string | null; status: TrackingStatus | null };

/**
 * #2714 (CTO on #2595): signup and sales goals stay closed to every account, internal too, until real tracking
 * recordings and B2's validate_only tapes exist. Fixtures alone never open them; opening is a CEO decision.
 */
export function websiteGoalOpen(goal: WebsiteGoal = "visits"): boolean {
  return goal === "visits";
}

export function conversionGoal(destination: string | undefined, goal: WebsiteGoal | undefined): ConversionGoal | null {
  return destination === "website" && (goal === "leads" || goal === "sales") ? goal : null;
}

/** The event the goal is measured by: the owner picks the tracking, never a free event name. */
export function goalEvent(goal: ConversionGoal): TrackingEvent {
  return goal === "leads" ? "Lead" : "Purchase";
}

export type TrackingBlocker =
  | { key: "trackingNone" | "trackingChoose" }
  | { key: "trackingUnreadable"; reconnect: boolean }
  | { key: "trackingQuiet" | "trackingEventMissing"; since: string; until: string; lastSeenAt: string | null };

/**
 * #2714: a conversion launch needs the chosen tracking to have reported the goal's event in the checked window.
 * Anything else blocks: never a silent fall back to visits or to another of the account's pixels.
 */
export function trackingBlocker(goal: ConversionGoal, tracking: ReviewTracking | undefined): TrackingBlocker | null {
  if (!tracking?.status) return { key: "trackingUnreadable", reconnect: false };
  const { status } = tracking;
  if (status.state === "none") return { key: "trackingNone" };
  if (!tracking.pixelId) return { key: "trackingChoose" };
  if (status.state === "unreadable" || status.pixelId !== tracking.pixelId) {
    return { key: "trackingUnreadable", reconnect: status.unreadable === "reconnect" };
  }
  const seen = status.counts?.[goalEvent(goal)] ?? 0;
  if (status.state === "ready" && seen > 0) return null;
  if (!status.window) return { key: "trackingUnreadable", reconnect: false };
  const key = status.state === "quiet" || !status.totalEvents ? "trackingQuiet" : "trackingEventMissing";
  return { key, since: status.window.since, until: status.window.until, lastSeenAt: status.lastSeenAt };
}

/** #2714: the first chosen ad whose button promises the other goal ("Buy now" on signups, "Sign up" on sales). */
export function goalWordsMismatch<T extends { headline: string | null; cta?: string | null }>(goal: ConversionGoal, creatives: T[]): T | null {
  const wrong = goal === "leads" ? "shop_now" : "sign_up";
  return creatives.find((creative) => websiteButton(creative.cta) === wrong) ?? null;
}
