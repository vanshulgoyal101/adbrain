import { logEvent } from "@/lib/audit";
import { campaignsToAutoPause } from "@/lib/campaign/spend";
import {
  ConnectionAccessError,
  requireOwnedBusiness,
  withMetaConnection,
} from "@/lib/meta/connection-access";
import { readStoredCampaignBinding } from "@/lib/campaign/binding";
import { saveCampaign } from "./trusted-write";
import { confirmCustomerCampaign, getCustomerBalance } from "@/lib/payments/customer-balance";
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
    let context;
    try {
      context = await requireOwnedBusiness(businessId);
    } catch {
      return [];
    }
    const customerBalance = await getCustomerBalance(context).catch(() => null);
    const financialHold = !customerBalance || customerBalance.held;
    if (!financialHold && (!limits.autoPause || !limits.weeklyCapRupees)) return [];

    const results = financialHold ? {} : await getLatestResults(campaigns.map((c) => c.id));
    const toPause = financialHold ? campaigns.filter(campaign => campaign.status === "active").map(campaign => campaign.id) : campaignsToAutoPause(
      campaigns.map((c) => ({
        id: c.id,
        status: c.status,
        dailyBudget: c.daily_budget,
        spend: results[c.id]?.spend ?? 0,
      })),
      limits,
    );
    if (!toPause.length) return [];

    const paused: string[] = [];
    for (const id of toPause) {
      const campaign = campaigns.find((c) => c.id === id);
      if (!campaign?.meta_campaign_id) continue;
      const storedBinding = readStoredCampaignBinding(campaign);
      if (
        !storedBinding.metaAdAccountId ||
        !storedBinding.metaPageId ||
        storedBinding.metaConnectionGeneration === null
      ) {
        continue;
      }
      try {
        await withMetaConnection(
          context,
          {
            purpose: "pause",
            binding: {
              adAccountId: storedBinding.metaAdAccountId,
              pageId: storedBinding.metaPageId,
            },
            expectedGeneration: storedBinding.metaConnectionGeneration,
          },
          (meta) => meta.updateCampaignStatus(campaign.meta_campaign_id!, "PAUSED"),
        );
        const reservation = customerBalance?.reservations.find(item => item.campaignId === id && item.state !== "closed");
        if (reservation) await confirmCustomerCampaign(context, id, reservation.reservationId, "paused").catch(() => undefined);
        const { error } = await saveCampaign(context, { status: "paused" }, id);
        if (error) continue;
        paused.push(id);
        await logEvent({
          businessId,
          action: "spend.auto_paused",
          entityType: "campaign",
          entityId: id,
          metaObjectId: campaign.meta_campaign_id,
          reason: financialHold ? "Customer advertising funds or attributed costs require reconciliation" : `Weekly spend cap of ₹${limits.weeklyCapRupees} reached`,
        });
      } catch (error) {
        if (!(error instanceof ConnectionAccessError)) {
          // Provider and persistence failures remain best-effort; the next refresh retries.
        }
        // Leave it running rather than fail the whole refresh; the banner still warns.
      }
    }
    return paused;
  } catch {
    return [];
  }
}
