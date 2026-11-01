import { z } from "zod";
import type { CampaignDestination } from "@/lib/campaign/outcomes";

export interface CampaignInsights {
  destination?: CampaignDestination;
  periodStart?: string | null;
  periodEnd?: string | null;
  impressions: number;
  clicks: number;
  leads: number;
  spend: number;
  cpl: number | null;
  conversations?: number;
  costPerConversation?: number | null;
  /** Meta link_click: WhatsApp button taps, not verified chat opens or a count of non-senders. */
  whatsappOpens?: number;
  /** Meta returned no rows: nothing delivered in the requested period. */
  noDelivery?: true;
  /** #1903: the campaign's own status and budgets, read with the binding check (no extra call). */
  metaState?: MetaCampaignState;
}

/** #1903: what Meta says the campaign is set to, raw minor units, for spotting changes made in Ads Manager. */
export interface MetaCampaignState {
  status: string;
  dailyBudget?: string;
  lifetimeBudget?: string;
  adSets: Array<{ id: string; status?: string; dailyBudget?: string; lifetimeBudget?: string; endTime?: string }>;
}

const amountSchema = z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)
  .pipe(z.number().nonnegative().max(Number.MAX_SAFE_INTEGER));
const countSchema = amountSchema.pipe(z.number().int());
const rowSchema = z.object({
  impressions: countSchema.optional(),
  clicks: countSchema.optional(),
  spend: amountSchema.optional(),
  date_start: z.iso.date().optional(),
  date_stop: z.iso.date().optional(),
  actions: z.array(z.object({ action_type: z.string(), value: z.string() })).optional(),
});
type InsightRow = z.infer<typeof rowSchema>;
const insightsSchema = z.object({
  data: z.array(rowSchema).max(1),
  paging: z.object({ next: z.string().optional() }).optional(),
});

/** One action's count in an insights row (Meta lists each action type at most once). */
function actionCounter(row: InsightRow | undefined) {
  return (names: string[]) => {
    for (const name of names) {
      const matches = row?.actions?.filter(action => action.action_type === name) ?? [];
      if (matches.length > 1) throw new Error("Campaign insight actions are ambiguous.");
      if (matches.length === 1) {
        const count = countSchema.safeParse(matches[0].value);
        if (!count.success) throw new Error("Campaign insight count is invalid.");
        return count.data;
      }
    }
    return 0;
  };
}

const LEAD_ACTIONS = ["lead", "onsite_conversion.lead_grouped"];
/** #371/#789: the headline WhatsApp result; Meta also reports first replies and depth, which we don't switch to silently. */
const CONVERSATION_ACTIONS = ["onsite_conversion.messaging_conversation_started_7d"];

export function decodeCampaignInsights(payload: unknown, destination: CampaignDestination, options?: { requireSpend?: boolean }): CampaignInsights {
  const parsed = insightsSchema.safeParse(payload);
  if (!parsed.success || parsed.data.paging?.next) throw new Error("Campaign insights are incomplete or invalid.");
  const row = parsed.data.data[0];
  if (options?.requireSpend && row && row.spend === undefined) throw new Error("Campaign spend observation is unavailable.");
  if (row?.date_start && row.date_stop && row.date_start > row.date_stop) throw new Error("Campaign insight dates are invalid.");
  const actionCount = actionCounter(row);
  const spend = row?.spend ?? 0;
  const leads = actionCount(LEAD_ACTIONS);
  const conversations = actionCount(CONVERSATION_ACTIONS);
  return {
    destination,
    periodStart: row?.date_start ?? null,
    periodEnd: row?.date_stop ?? null,
    impressions: row?.impressions ?? 0,
    clicks: row?.clicks ?? 0,
    spend, leads, cpl: leads > 0 ? spend / leads : null,
    ...(destination === "whatsapp" ? { conversations, costPerConversation: conversations > 0 ? spend / conversations : null, whatsappOpens: actionCount(["link_click"]) } : {}),
    ...(row ? {} : { noDelivery: true as const }),
  };
}

const lifetimeSpendSchema = z.object({
  data: z.array(z.object({ spend: z.string().regex(/^\d{1,13}(?:\.\d{1,2})?$/) })).max(1),
  paging: z.object({ next: z.string().optional() }).optional(),
});

/** Lifetime campaign spend in exact paise; Meta returns no row for a campaign that never delivered. */
export function decodeLifetimeSpendPaise(payload: unknown): number {
  const parsed = lifetimeSpendSchema.safeParse(payload);
  if (!parsed.success || parsed.data.paging?.next) throw new Error("Campaign lifetime spend is incomplete or invalid.");
  const spend = parsed.data.data[0]?.spend;
  if (spend === undefined) return 0;
  const [rupees, paise = ""] = spend.split(".");
  return Number(rupees) * 100 + Number(paise.padEnd(2, "0"));
}
/** #783: one ad of a campaign and its lifetime results. An ad Meta hasn't delivered has no insights row. */
export type AdResult = {
  adId: string; name: string | null; effectiveStatus: string | null; creativeId: string | null;
  delivered: boolean; impressions: number; clicks: number; spend: number;
  /** Chats for a WhatsApp campaign, form leads otherwise. */
  results: number; costPerResult: number | null; whatsappOpens?: number;
  /** Archived (an audience edit rebuilt its ad set) or gone from the listing: its results count, but it can't be "Best so far". */
  replaced: boolean;
};

const adListSchema = z.object({
  data: z.array(z.object({ id: z.string().regex(/^\d+$/), name: z.string().optional(), effective_status: z.string().optional(), creative: z.object({ id: z.string() }).optional() })).max(100),
  paging: z.object({ next: z.string().optional() }).optional(),
});
const adInsightsSchema = z.object({
  data: z.array(rowSchema.extend({ ad_id: z.string().regex(/^\d+$/) })).max(100),
  paging: z.object({ next: z.string().optional() }).optional(),
});

/**
 * #783/#789: a campaign's ads (from `/{campaign}/ads`, every status Meta lists) left-joined with `level=ad`
 * insights, which list only delivering ads, so a paused or unspent ad stays visible. Same action names as the
 * campaign total.
 */
export function decodeAdResults(adsPayload: unknown, insightsPayload: unknown, destination: CampaignDestination): AdResult[] {
  const ads = adListSchema.safeParse(adsPayload);
  const insights = adInsightsSchema.safeParse(insightsPayload);
  if (!ads.success || !insights.success || ads.data.paging?.next || insights.data.paging?.next) throw new Error("Ad results are incomplete or invalid.");
  const rows = new Map<string, InsightRow>();
  for (const row of insights.data.data) {
    if (rows.has(row.ad_id)) throw new Error("Ad results are ambiguous.");
    rows.set(row.ad_id, row);
  }
  if (new Set(ads.data.data.map(ad => ad.id)).size !== ads.data.data.length) throw new Error("Ad results are ambiguous.");
  const known = new Set(ads.data.data.map(ad => ad.id));
  // Meta can't list deleted ads, but their delivery stays in the insights: keep it so the totals add up.
  const gone = [...rows.keys()].filter(id => !known.has(id)).map(id => ({ id, name: undefined, effective_status: undefined, creative: undefined }));
  return [...ads.data.data, ...gone].map((ad) => {
    const row = rows.get(ad.id);
    const count = actionCounter(row);
    const spend = row?.spend ?? 0;
    const results = destination === "whatsapp" ? count(CONVERSATION_ACTIONS) : count(LEAD_ACTIONS);
    return {
      adId: ad.id, name: ad.name ?? null, effectiveStatus: ad.effective_status ?? null, creativeId: ad.creative?.id ?? null,
      delivered: Boolean(row), impressions: row?.impressions ?? 0, clicks: row?.clicks ?? 0, spend,
      results, costPerResult: results > 0 ? spend / results : null,
      ...(destination === "whatsapp" ? { whatsappOpens: count(["link_click"]) } : {}),
      replaced: !known.has(ad.id) || ad.effective_status === "ARCHIVED",
    };
  });
}

/** #783 (CPO): "Best so far" needs at least this many results, and a cost at least this much lower than the next ad. */
export const BEST_AD_MIN_RESULTS = 5;
export const BEST_AD_MARGIN = 0.3;

/**
 * The ad to call "Best so far", or null while it's too early. The runner-up's cost is its cost per result,
 * or, for an ad with spend but no results, at least its spend; an ad with neither isn't a comparison.
 */
export function bestAd(ads: AdResult[]): AdResult | null {
  const ranked = ads.filter(ad => !ad.replaced && ad.results >= BEST_AD_MIN_RESULTS && ad.costPerResult !== null)
    .sort((left, right) => left.costPerResult! - right.costPerResult!);
  const best = ranked[0];
  if (!best) return null;
  const others = ads.filter(ad => ad !== best && (ad.results > 0 || ad.spend > 0)).map(ad => ad.costPerResult ?? ad.spend);
  if (!others.length) return null;
  return best.costPerResult! <= Math.min(...others) * (1 - BEST_AD_MARGIN) ? best : null;
}
