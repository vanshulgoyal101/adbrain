import { withMetaConnection, type AuthorizedBusiness } from "@/lib/meta/connection-access";
import { readStoredCampaignBinding } from "@/lib/campaign/binding";
import { observeCustomerCosts, settleCustomerCosts } from "./customer-balance";
import type { CustomerBalance } from "./customer-balance-contracts";

type RunningCampaign = { id: string; status: string | null; meta_campaign_id: string | null };

/**
 * Records Meta lifetime spend for every active campaign with an open reservation, so a funded run
 * is not held only because its evidence aged (#216). `complete` is false when any read or write failed.
 */
export async function refreshOpenRunCosts(context: AuthorizedBusiness, campaigns: RunningCampaign[], balance: CustomerBalance | null): Promise<{ observed: number; complete: boolean }> {
  if (!balance) return { observed: 0, complete: false };
  const open = new Set(balance.reservations.filter(item => item.state !== "closed").map(item => item.campaignId));
  let observed = 0;
  let complete = true;
  for (const campaign of campaigns) {
    if (campaign.status !== "active" || !open.has(campaign.id)) continue;
    const binding = readStoredCampaignBinding(campaign);
    if (!campaign.meta_campaign_id || !binding.metaAdAccountId || !binding.metaPageId || binding.metaConnectionGeneration === null) {
      complete = false;
      continue;
    }
    const { metaAdAccountId, metaPageId, metaConnectionGeneration } = binding;
    try {
      await withMetaConnection(context, {
        purpose: "read_insights",
        binding: { adAccountId: metaAdAccountId, pageId: metaPageId },
        expectedGeneration: metaConnectionGeneration,
      }, async meta => observeCustomerCosts(context, {
        campaignId: campaign.id, adAccountId: metaAdAccountId, connectionGeneration: metaConnectionGeneration,
        mediaPaise: await meta.readLifetimeSpendPaise(campaign.meta_campaign_id!),
      }));
      observed += 1;
    } catch {
      complete = false;
    }
  }
  return { observed, complete };
}

/**
 * For every paused run still holding its reserve: confirms with Meta that the whole tree has
 * stopped, then records its lifetime spend as a settle read. SQL finalizes and releases the
 * reserve once the spend has settled (#221). `complete` is false when Meta has not confirmed the
 * stop or any read or write failed; the run then keeps its reserve.
 */
export async function settlePausedRuns(context: AuthorizedBusiness, campaigns: RunningCampaign[], balance: CustomerBalance | null): Promise<{ read: number; finalized: number; complete: boolean }> {
  if (!balance) return { read: 0, finalized: 0, complete: false };
  let read = 0;
  let finalized = 0;
  let complete = true;
  for (const reservation of balance.reservations) {
    if (reservation.state !== "paused") continue;
    const campaign = campaigns.find(item => item.id === reservation.campaignId);
    if (campaign?.status === "active") continue;
    const binding = readStoredCampaignBinding(campaign);
    if (campaign?.status !== "paused" || !campaign.meta_campaign_id || !binding.metaAdAccountId || !binding.metaPageId || binding.metaConnectionGeneration === null) {
      complete = false;
      continue;
    }
    const { metaAdAccountId, metaPageId, metaConnectionGeneration } = binding;
    try {
      const outcome = await withMetaConnection(context, {
        purpose: "read_insights",
        binding: { adAccountId: metaAdAccountId, pageId: metaPageId },
        expectedGeneration: metaConnectionGeneration,
      }, async meta => {
        if (!await meta.readCampaignStopped(campaign.meta_campaign_id!)) throw new Error("Meta has not confirmed the stop.");
        return settleCustomerCosts(context, {
          campaignId: campaign.id, adAccountId: metaAdAccountId, connectionGeneration: metaConnectionGeneration,
          reservationId: reservation.reservationId, mediaPaise: await meta.readLifetimeSpendPaise(campaign.meta_campaign_id!),
        });
      });
      read += 1;
      if (outcome.finalized) finalized += 1;
    } catch {
      complete = false;
    }
  }
  return { read, finalized, complete };
}
