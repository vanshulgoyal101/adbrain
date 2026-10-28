import { goneInMeta } from "@/lib/campaign/gone-in-meta";
import type { Campaign, CampaignResult } from "@/lib/types";

type ReviewCampaign = Pick<Campaign, "id" | "status" | "meta_campaign_id" | "created_at" | "raw">;
export type HomeAdReview = { kind: "checking" | "rejected"; campaignId: string };

const IN_REVIEW = new Set(["PENDING_REVIEW", "IN_PROCESS"]);
const REPLACED = new Set(["DELETED", "ARCHIVED"]);

/** The newest campaign launched to Meta that is still on or paused there. */
export function newestLiveCampaign<T extends ReviewCampaign>(campaigns: T[]): T | undefined {
  return campaigns
    .filter((campaign) => campaign.meta_campaign_id && campaign.status !== "draft" && campaign.status !== "completed" && !goneInMeta(campaign))
    .sort((left, right) => (right.created_at ?? "").localeCompare(left.created_at ?? ""))[0];
}

/**
 * #1469: Home's line between launch and first delivery. Reads the newest launched campaign still in Meta:
 * "rejected" when Meta disapproved any of its ads; "checking" while it is on and every ad is still in review
 * (or, right after launch, nothing is synced yet and nothing has delivered). `adStatuses` are the stored
 * per-ad effective statuses (`ad_results`), so Home needs no Meta call to decide.
 */
export function homeAdReview(
  campaigns: ReviewCampaign[],
  adStatuses: Record<string, (string | null)[]>,
  results: Record<string, Pick<CampaignResult, "impressions">>,
): HomeAdReview | null {
  const newest = newestLiveCampaign(campaigns);
  if (!newest) return null;
  const statuses = (adStatuses[newest.id] ?? []).filter((status) => !status || !REPLACED.has(status));
  if (statuses.includes("DISAPPROVED")) return { kind: "rejected", campaignId: newest.id };
  if (newest.status !== "active" || (results[newest.id]?.impressions ?? 0) > 0) return null;
  return statuses.every((status) => status && IN_REVIEW.has(status)) ? { kind: "checking", campaignId: newest.id } : null;
}
