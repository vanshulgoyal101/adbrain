import type { MetaCampaignState } from "@/lib/meta/insights";
import type { Campaign, Json } from "@/lib/types";
import { storedCappedAdSetIds } from "@/lib/campaign/activation";
import { outsideChanges } from "@/lib/campaign/gone-in-meta";
import { saveCampaignBudget } from "@/lib/campaign/trusted-write";

/**
 * #1903: mirror a pause or daily-budget change made in Meta Ads Manager onto the row, worked out again on the
 * row as it is at write time, and only while its status and daily budget are still those seen when Meta was read.
 * `raised` is true when this write found the daily budget went up.
 */
export async function saveOutsideChanges(
  actor: { businessId: string; userId: string },
  campaign: Pick<Campaign, "id" | "status" | "daily_budget" | "raw">,
  state: MetaCampaignState | undefined,
  now: Date = new Date(),
): Promise<{ changed: boolean; raised: boolean }> {
  if (!state) return { changed: false, raised: false };
  const capped = storedCappedAdSetIds(campaign.raw);
  if (!outsideChanges(campaign, state, capped, now)) return { changed: false, raised: false };
  let changed = false, raised = false;
  const { error } = await saveCampaignBudget(actor, campaign.id, current => {
    // The row moved since Meta was read (e.g. the owner's own budget edit): leave it to the next refresh's fresh read.
    if (current.status !== campaign.status || current.daily_budget !== campaign.daily_budget) return { raw: current.raw };
    const next = outsideChanges({ status: current.status, daily_budget: current.daily_budget, raw: current.raw as Campaign["raw"] }, state, capped, now);
    if (!next) return { raw: current.raw };
    changed = true;
    raised = next.raised;
    return { ...next.daily_budget !== undefined ? { daily_budget: next.daily_budget } : {}, raw: next.raw as Json };
  });
  return error ? { changed: false, raised: false } : { changed, raised };
}
