import type { Campaign } from "@/lib/types";

/** #721: Meta deleted or archived it; Refresh ended the row and kept why in `raw.metaStatus`. One word on every page (#1150). */
export function goneInMeta(campaign: Pick<Campaign, "raw">): "Deleted in Meta" | "Archived in Meta" | null {
  const status = campaign.raw && typeof campaign.raw === "object" && !Array.isArray(campaign.raw) ? (campaign.raw as { metaStatus?: unknown }).metaStatus : null;
  return status === "DELETED" ? "Deleted in Meta" : status === "ARCHIVED" ? "Archived in Meta" : null;
}
