import { logEvent } from "@/lib/audit";
import { weeklySpendDecision } from "@/lib/campaign/spend";
import {
  requireOwnedBusiness,
  withMetaConnection,
} from "@/lib/meta/connection-access";
import { readStoredCampaignBinding } from "@/lib/campaign/binding";
import { saveCampaign } from "./trusted-write";
import { confirmCustomerCampaign, getCustomerBalance } from "@/lib/payments/customer-balance";
import { refreshOpenRunCosts } from "@/lib/payments/meta-cost-evidence";
import { fundingMode } from "@/lib/payments/operator-funding";
import {
  getCampaigns,
  getSpendLimits,
} from "@/lib/supabase/queries";

/**
 * Best-effort guardrail; an unverified decision or pause must remain visible to
 * the caller even when a results refresh itself succeeded.
 */
export async function enforceAutoPauseWithStatus(businessId: string): Promise<{ paused: string[]; confirmed: boolean }> {
  try {
    const [limits, campaigns] = await Promise.all([
      getSpendLimits(businessId),
      getCampaigns(businessId),
    ]);
    let context;
    try {
      context = await requireOwnedBusiness(businessId);
    } catch {
      return { paused: [], confirmed: false };
    }
    // #245: an unreadable funding mode falls back to the customer rules (fail closed).
    let fundingVerified = true;
    // #759: only a managed business has an AdBrain allowance to hold; operator and own-account runs are capped on Meta.
    const metaFunded = await fundingMode(businessId).then(mode => mode !== "managed").catch(() => { fundingVerified = false; return false; });
    let customerBalance = null;
    if (!metaFunded) {
      const initialBalance = await getCustomerBalance(context).catch(() => null);
      const refresh = await refreshOpenRunCosts(context, campaigns, initialBalance);
      customerBalance = refresh.observed ? await getCustomerBalance(context).catch(() => null) : initialBalance;
    }
    // #245/#759: a run funded on Meta (operator or own account) is capped there and has no customer allowance to hold.
    const financialHold = !metaFunded && (!customerBalance || customerBalance.held);
    if (!financialHold && (!limits.autoPause || limits.weeklyCapRupees === null)) return { paused: [], confirmed: fundingVerified };

    const decision = financialHold
      ? { toPause: campaigns.filter(campaign => campaign.status === "active").map(campaign => campaign.id), verified: Boolean(customerBalance) }
      : await weeklySpendDecision(campaigns, limits, async campaign => {
        const binding = readStoredCampaignBinding(campaign);
        if (!campaign.meta_campaign_id || !binding.metaAdAccountId || !binding.metaPageId || binding.metaConnectionGeneration === null) {
          throw new Error("Campaign binding is unavailable.");
        }
        return withMetaConnection(context, {
          purpose: "read_insights",
          binding: { adAccountId: binding.metaAdAccountId, pageId: binding.metaPageId },
          expectedGeneration: binding.metaConnectionGeneration,
        }, async (meta, connection) => ({
          insights: await meta.getCampaignInsights(campaign.meta_campaign_id!, { weekly: true }),
          currency: connection.selected?.currency ?? null,
          timezoneName: connection.selected?.timezoneName ?? null,
        }));
      });
    const toPause = decision.toPause;
    if (!toPause.length) return { paused: [], confirmed: decision.verified && fundingVerified };

    const paused: string[] = [];
    let confirmed = decision.verified && fundingVerified;
    for (const id of toPause) {
      const campaign = campaigns.find((c) => c.id === id);
      if (!campaign?.meta_campaign_id) { confirmed = false; continue; }
      const storedBinding = readStoredCampaignBinding(campaign);
      if (
        !storedBinding.metaAdAccountId ||
        !storedBinding.metaPageId ||
        storedBinding.metaConnectionGeneration === null
      ) {
        confirmed = false;
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
        if (reservation) await confirmCustomerCampaign(context, id, reservation.reservationId, "paused").catch(() => { confirmed = false; });
        const { error } = await saveCampaign(context, { status: "paused" }, id);
        if (error) { confirmed = false; continue; }
        paused.push(id);
        await logEvent({
          businessId,
          action: "spend.auto_paused",
          entityType: "campaign",
          entityId: id,
          metaObjectId: campaign.meta_campaign_id,
          reason: financialHold ? "Customer advertising funds or attributed costs require reconciliation" : decision.verified ? `Weekly spend cap of ₹${limits.weeklyCapRupees} reached` : "Weekly spend observation could not be verified",
        });
      } catch {
        confirmed = false;
      }
    }
    return { paused, confirmed };
  } catch {
    return { paused: [], confirmed: false };
  }
}

export async function enforceAutoPause(businessId: string): Promise<string[]> {
  return (await enforceAutoPauseWithStatus(businessId)).paused;
}
