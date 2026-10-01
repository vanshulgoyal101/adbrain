import type { ConnectionDTO } from "@/lib/meta/connect-contracts";
import type { CampaignDeliverySnapshot } from "@/lib/meta/client";
import type { Campaign } from "@/lib/types";
import { z } from "zod";

const storedChildrenSchema = z.object({
  source: z.literal("campaign_operation"),
  metaResult: z.object({
    campaignId: z.string().min(1),
    adSetIds: z.array(z.string().min(1)).nonempty(),
    adIds: z.array(z.string().min(1)).nonempty(),
  }),
});

export const campaignDeliverySnapshotSchema = z.object({
  campaign: z.object({ id: z.string().min(1), status: z.string(), effectiveStatus: z.string().nullable() }),
  adSets: z.array(z.object({
    id: z.string().min(1), status: z.string(), effectiveStatus: z.string().nullable(),
    dailyBudgetPaise: z.number().int().nonnegative(), pageId: z.string().min(1),
    destinationType: z.string().nullable(), targeting: z.unknown(),
  })),
  ads: z.array(z.object({
    id: z.string().min(1), status: z.string(), effectiveStatus: z.string().nullable(),
    adSetId: z.string().min(1), creativeId: z.string().min(1),
  })),
});

export function intendedCampaignChildren(campaign: Pick<Campaign, "meta_campaign_id" | "meta_adset_id" | "meta_ad_ids" | "raw">) {
  const parsed = storedChildrenSchema.safeParse(campaign.raw);
  if (!parsed.success) return null;
  const { campaignId, adSetIds, adIds } = parsed.data.metaResult;
  if (campaignId !== campaign.meta_campaign_id || adSetIds[0] !== campaign.meta_adset_id
    || adIds.length !== campaign.meta_ad_ids.length
    || new Set(adSetIds).size !== adSetIds.length || new Set(adIds).size !== adIds.length
    || adIds.some(id => !campaign.meta_ad_ids.includes(id))) return null;
  return { adSetIds, adIds };
}

export function activationConfirmationPayload(
  campaign: Pick<Campaign, "id" | "meta_campaign_id" | "daily_budget" | "status">,
  connection: Pick<ConnectionDTO, "selected" | "generation">,
  delivery: CampaignDeliverySnapshot,
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
    delivery,
    status: "active",
  });
}