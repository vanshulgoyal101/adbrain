import { readStoredCampaignBinding } from "@/lib/campaign/binding";
import type { Campaign, CampaignResult } from "@/lib/types";

/**
 * #1003: results older than this are refreshed in the background when a campaign card or Home
 * opens. The 15-min pg_cron refresh (#992) is the floor; this covers a missed run. Below it the
 * refresh route answers from the stored row with no Meta call (`?ifStale=1`).
 */
export const RESULTS_STALE_MS = 10 * 60_000;

export function resultsStale(fetchedAt: string | null | undefined, now = Date.now()): boolean {
  const at = fetchedAt ? Date.parse(fetchedAt) : NaN;
  return Number.isNaN(at) || now - at > RESULTS_STALE_MS;
}

/** Live campaigns the refresh route can read from Meta whose newest results are stale or missing. */
export function staleCampaignIds(
  campaigns: Campaign[],
  results: Record<string, Pick<CampaignResult, "fetched_at"> | undefined>,
  now = Date.now(),
): string[] {
  return campaigns.filter((campaign) => {
    if (campaign.status !== "active" || !campaign.meta_campaign_id) return false;
    const binding = readStoredCampaignBinding(campaign);
    if (!binding.metaAdAccountId || !binding.metaPageId || binding.metaConnectionGeneration === null) return false;
    return resultsStale(results[campaign.id]?.fetched_at, now);
  }).map((campaign) => campaign.id);
}

export type BackgroundRefresh = { result?: CampaignResult; fresh?: boolean; summary?: string; gone?: string; campaign?: Campaign | null };

/** One quiet refresh: the stored row when it's fresh, else Meta's latest. Null on any failure (the card keeps its age). */
export async function refreshIfStale(campaignId: string): Promise<BackgroundRefresh | null> {
  try {
    const response = await fetch(`/api/campaigns/${campaignId}/refresh?ifStale=1`, { method: "POST" });
    const data = (await response.json()) as BackgroundRefresh;
    return response.ok || (response.status === 410 && data.gone) ? data : null;
  } catch {
    return null;
  }
}
