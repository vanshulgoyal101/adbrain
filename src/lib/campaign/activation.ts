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

/** Live Meta ad account funding shown in the activation review of an operator-funded business (#245). */
export const accountFundingSchema = z.object({
  spendCapPaise: z.number().int().nonnegative(), amountSpentPaise: z.number().int().nonnegative(),
  roomPaise: z.number().int().nonnegative(), prepay: z.boolean(),
});

const storedCapsSchema = z.object({
  cap: z.object({ adSetId: z.string().min(1) }).optional(),
  cappedAdSetIds: z.array(z.string().min(1)).optional(),
});

/** Lifetime-budget ad sets AdBrain created for capped runs (#157); no other ad set may carry a lifetime budget. */
export function storedCappedAdSetIds(raw: unknown): string[] {
  const parsed = storedCapsSchema.safeParse(raw);
  if (!parsed.success) return [];
  return [...new Set([...parsed.data.cappedAdSetIds ?? [], ...parsed.data.cap ? [parsed.data.cap.adSetId] : []])];
}

export function intendedCampaignChildren(campaign: Pick<Campaign, "meta_campaign_id" | "meta_adset_id" | "meta_ad_ids" | "raw">) {
  const parsed = storedChildrenSchema.safeParse(campaign.raw);
  if (!parsed.success) return null;
  const { campaignId, adSetIds, adIds } = parsed.data.metaResult;
  const cappedAdSetIds = storedCappedAdSetIds(campaign.raw);
  if (campaignId !== campaign.meta_campaign_id || adSetIds[0] !== campaign.meta_adset_id
    || adIds.length !== campaign.meta_ad_ids.length
    || new Set(adSetIds).size !== adSetIds.length || new Set(adIds).size !== adIds.length
    || adIds.some(id => !campaign.meta_ad_ids.includes(id))
    || cappedAdSetIds.includes(adSetIds[0]) || cappedAdSetIds.some(id => !adSetIds.includes(id))) return null;
  return { adSetIds, adIds, cappedAdSetIds };
}

export function activationConfirmationPayload(
  campaign: Pick<Campaign, "id" | "meta_campaign_id" | "daily_budget" | "status">,
  connection: Pick<ConnectionDTO, "selected" | "generation">,
  delivery: CampaignDeliverySnapshot,
  capDays?: number,
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
    ...(capDays ? { cap: { days: capDays, totalPaise: Math.round((campaign.daily_budget ?? 0) * 100) * capDays } } : {}),
    status: "active",
  });
}