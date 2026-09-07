import type { ConnectionDTO } from "@/lib/meta/connect-contracts";
import type { Campaign } from "@/lib/types";

export function activationConfirmationPayload(
  campaign: Pick<Campaign, "id" | "meta_campaign_id" | "daily_budget" | "status">,
  connection: Pick<ConnectionDTO, "selected" | "generation">,
): string {
  if (!connection.selected) throw new Error("Meta assets are unavailable. Review the connection again.");
  const selected = connection.selected;
  return JSON.stringify({
    campaignId: campaign.id,
    metaCampaignId: campaign.meta_campaign_id,
    dailyBudget: campaign.daily_budget,
    campaignStatus: campaign.status,
    selected: {
      metaBusinessId: selected.metaBusinessId,
      adAccountId: selected.adAccountId,
      accountName: selected.accountName,
      pageId: selected.pageId,
      pageName: selected.pageName,
      currency: selected.currency,
      timezoneName: selected.timezoneName,
    },
    connectionGeneration: connection.generation,
    status: "active",
  });
}