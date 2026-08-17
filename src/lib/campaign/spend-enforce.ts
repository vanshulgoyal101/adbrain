import { logEvent } from "@/lib/audit";
import { campaignsToAutoPause } from "@/lib/campaign/spend";
import { metaClientForBusiness } from "@/lib/meta/credentials";
import { createClient } from "@/lib/supabase/server";
import {
  getCampaigns,
  getLatestResults,
  getSpendLimits,
} from "@/lib/supabase/queries";

/**
 * Runaway-spend protection: when auto-pause is on and tracked spend has reached
 * the weekly cap, pause every active campaign on Meta and locally. Best-effort —
 * never throws, so it can't break the refresh/sync that triggers it. Returns the
 * ids that were paused.
 */
export async function enforceAutoPause(businessId: string): Promise<string[]> {
  try {
    const [limits, campaigns] = await Promise.all([
      getSpendLimits(businessId),
      getCampaigns(businessId),
    ]);
    if (!limits.autoPause || !limits.weeklyCapRupees) return [];

    const results = await getLatestResults(campaigns.map((c) => c.id));
    const toPause = campaignsToAutoPause(
      campaigns.map((c) => ({
        id: c.id,
        status: c.status,
        dailyBudget: c.daily_budget,
        spend: results[c.id]?.spend ?? 0,
      })),
      limits,
    );
    if (!toPause.length) return [];

    const meta = await metaClientForBusiness(businessId);
    if (!meta) return [];

    const supabase = await createClient();
    const paused: string[] = [];
    for (const id of toPause) {
      const campaign = campaigns.find((c) => c.id === id);
      if (!campaign?.meta_campaign_id) continue;
      try {
        await meta.updateCampaignStatus(campaign.meta_campaign_id, "PAUSED");
        await supabase.from("campaigns").update({ status: "paused" }).eq("id", id);
        paused.push(id);
        await logEvent({
          businessId,
          action: "spend.auto_paused",
          entityType: "campaign",
          entityId: id,
          metaObjectId: campaign.meta_campaign_id,
          reason: `Weekly spend cap of ₹${limits.weeklyCapRupees} reached`,
        });
      } catch {
        // Leave it running rather than fail the whole refresh; the banner still warns.
      }
    }
    return paused;
  } catch {
    return [];
  }
}
