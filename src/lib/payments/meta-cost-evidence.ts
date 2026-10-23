import { withMetaConnection, type AuthorizedBusiness } from "@/lib/meta/connection-access";
import { readStoredCampaignBinding } from "@/lib/campaign/binding";
import { observeCustomerCosts } from "./customer-balance";
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
