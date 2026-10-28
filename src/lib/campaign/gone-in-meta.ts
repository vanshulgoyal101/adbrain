import type { Campaign } from "@/lib/types";

/**
 * #721: Meta deleted or archived it; Refresh ended the row and kept why in `raw.metaStatus`. One word on every page (#1150).
 * #1600: `MISSING` is Meta answering "object does not exist" (100/33) to the scheduled refresh.
 */
export function goneInMeta(campaign: Pick<Campaign, "raw">): "Deleted in Meta" | "Archived in Meta" | "Not found in Meta" | null {
  const status = campaign.raw && typeof campaign.raw === "object" && !Array.isArray(campaign.raw) ? (campaign.raw as { metaStatus?: unknown }).metaStatus : null;
  return status === "DELETED" ? "Deleted in Meta" : status === "ARCHIVED" ? "Archived in Meta" : status === "MISSING" ? "Not found in Meta" : null;
}

/** #1601 (CPO): the owner-facing lines for a campaign deleted in Meta Ads Manager. */
export const GONE_LINES = {
  deleted: "This campaign was deleted in Meta Ads Manager, so it can't run or be changed here. Nothing more will spend. Its results up to then stay below.",
} as const;

/** #1600: Home names a campaign deleted in Meta for a week after AdBrain found it (`raw.metaGoneAt`), then lets it go. */
export function recentlyDeletedInMeta(campaign: Pick<Campaign, "raw">, now: number = Date.now()): boolean {
  if (goneInMeta(campaign) !== "Deleted in Meta") return false;
  const at = Date.parse(String((campaign.raw as { metaGoneAt?: unknown }).metaGoneAt ?? ""));
  return Number.isFinite(at) && now - at < 7 * 86_400_000;
}
