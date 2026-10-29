import { readStoredCampaignBinding } from "@/lib/campaign/binding";
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
  /** #1058: lifetime budget still to spend on the account's running capped runs; Meta's room doesn't count it. */
  committed: z.object({
    runs: z.number().int().nonnegative(), remainingPaise: z.number().int().nonnegative(),
    /** #1094: ACTIVE daily-budget ad sets have no total, so they're named, not subtracted. */
    uncapped: z.object({ adSets: z.number().int().nonnegative(), dailyPaise: z.number().int().nonnegative() }).optional(),
  }).optional(),
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

/** True once the latest capped run's Meta end time has passed (#221). */
export function cappedRunEnded(raw: unknown, now = Date.now()): boolean {
  const parsed = z.object({ cap: z.object({ endTime: z.iso.datetime({ offset: true }) }) }).safeParse(raw);
  return parsed.success && Date.parse(parsed.data.cap.endTime) <= now;
}

/** #2281: delivering now. A capped run past its end time isn't, even before the sweep moves its status off 'active'. */
export function runningNow(campaign: Pick<Campaign, "status" | "raw">, now = Date.now()): boolean {
  return campaign.status === "active" && !cappedRunEnded(campaign.raw, now);
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

/** #662: why a campaign card offers Ads Manager instead of Resume. */
export const RESUME_IN_ADS_MANAGER = "AdBrain can only resume campaigns it launched. Resume this one in Ads Manager.";

/**
 * #662: what an activation review reads, or null when AdBrain can't review this campaign: it must
 * have launched it (its ad sets and ads on record) and the campaign must be bound to a Meta account,
 * Page and connection with a budget. Synced and older rows aren't, so they're resumed in Ads
 * Manager. The card and `GET /api/campaigns/[id]` share this check.
 */
export function reviewableCampaign(campaign: Pick<Campaign, "meta_campaign_id" | "meta_adset_id" | "meta_ad_ids" | "raw" | "daily_budget"
  | "meta_ad_account_id" | "meta_page_id" | "meta_connection_generation">) {
  const children = intendedCampaignChildren(campaign);
  const binding = readStoredCampaignBinding(campaign);
  if (!campaign.meta_campaign_id || !children || !binding.metaAdAccountId || !binding.metaPageId
    || binding.metaConnectionGeneration === null || campaign.daily_budget === null || !Number.isFinite(campaign.daily_budget)) return null;
  return {
    metaCampaignId: campaign.meta_campaign_id, adAccountId: binding.metaAdAccountId, pageId: binding.metaPageId,
    generation: binding.metaConnectionGeneration, dailyBudgetRupees: campaign.daily_budget, children,
  };
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