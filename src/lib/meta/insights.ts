import { z } from "zod";
import { outcomeDefinition, WEBSITE_CONVERSIONS, type CampaignDestination } from "@/lib/campaign/outcomes";
import { BEST_AD_MARGIN, BEST_AD_MIN_RESULTS } from "@/lib/campaign/ad-results";
import type { ConversionGoal } from "@/lib/campaign/website-tracking";
import { websiteConversionEvent } from "@/lib/meta/destinations";
export { BEST_AD_MARGIN, BEST_AD_MIN_RESULTS } from "@/lib/campaign/ad-results";

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
  /** #2601: website campaigns only. Pages loaded after a tap (the result), taps on the link, ₹ per tap and ₹ per page view. */
  landingPageViews?: number;
  linkClicks?: number;
  cpc?: number | null;
  costPerLandingPageView?: number | null;
  /**
   * #2716: website leads/sales only, beside the page views. Meta-attributed pixel conversions, their value
   * (null: Meta sent no value, not zero) and ₹ per conversion. Never enquiries.
   */
  conversionGoal?: ConversionGoal;
  /** #2716: Meta sent a malformed or ambiguous conversion; the read keeps its page views and spend, conversions show as unavailable. */
  conversionsUnavailable?: true;
  conversions?: number;
  conversionValue?: number | null;
  costPerConversion?: number | null;
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

/**
 * #2716: a website campaign's conversion goal from its ad sets' promoted pixel event. Mixed or unknown events
 * remain unknown, so their conversions are never guessed.
 */
export function conversionGoalFromAdSets(adSets: ReadonlyArray<{ promoted_object?: { custom_event_type?: string } }>): ConversionGoal | null {
  const events = new Set(adSets.map(adSet => adSet.promoted_object?.custom_event_type));
  if (events.size !== 1) return null;
  const [event] = events;
  return (["leads", "sales"] as const).find(goal => websiteConversionEvent(goal) === event) ?? null;
}

const conversionHistorySchema = z.object({
  data: z.array(z.object({
    id: z.string(),
    destination_type: z.literal("WEBSITE"),
    promoted_object: z.object({ page_id: z.string(), custom_event_type: z.string() }),
  })).min(1).max(100),
  paging: z.object({ next: z.string().optional() }).optional(),
});

export function conversionHistoryMatches(payload: unknown, goal: ConversionGoal, pageId: string): boolean {
  const parsed = conversionHistorySchema.safeParse(payload);
  return parsed.success && !parsed.data.paging?.next
    && parsed.data.data.every(adSet => adSet.promoted_object.page_id === pageId
      && adSet.promoted_object.custom_event_type === websiteConversionEvent(goal));
}

const amountSchema = z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)
  .pipe(z.number().nonnegative().max(Number.MAX_SAFE_INTEGER));
const countSchema = amountSchema.pipe(z.number().int());
const actionValuesSchema = z.array(z.object({ action_type: z.string(), value: z.string() }));
const rowSchema = z.object({
  impressions: countSchema.optional(),
  clicks: countSchema.optional(),
  spend: amountSchema.optional(),
  date_start: z.iso.date().optional(),
  date_stop: z.iso.date().optional(),
  actions: z.array(z.object({ action_type: z.string(), value: z.unknown() })).optional(),
  action_values: z.unknown().optional(),
});
type InsightRow = z.infer<typeof rowSchema>;
const insightsSchema = z.object({
  data: z.array(rowSchema).max(1),
  paging: z.object({ next: z.string().optional() }).optional(),
});

const websiteConversionActions = new Set(Object.values(WEBSITE_CONVERSIONS).flatMap<string>(definition => definition.metaActions));

function validActions(row: InsightRow | undefined): boolean {
  return row?.actions?.every(action => typeof action.value === "string"
    || websiteConversionActions.has(action.action_type)) ?? true;
}

function readAction(actions: InsightRow["actions"], names: readonly string[], schema: z.ZodType<number>) {
  for (const name of names) {
    const matches = actions?.filter(action => action.action_type === name) ?? [];
    if (matches.length > 1) return { state: "ambiguous" as const };
    if (matches.length === 1) {
      const parsed = schema.safeParse(matches[0].value);
      return parsed.success ? { state: "value" as const, value: parsed.data } : { state: "invalid" as const };
    }
  }
  return { state: "missing" as const };
}

/** One action's count in an insights row (Meta lists each action type at most once). */
function actionCounter(row: InsightRow | undefined) {
  return (names: readonly string[]) => {
    const result = readAction(row?.actions, names, countSchema);
    if (result.state === "ambiguous") throw new Error("Campaign insight actions are ambiguous.");
    if (result.state === "invalid") throw new Error("Campaign insight count is invalid.");
    return result.state === "value" ? result.value : 0;
  };
}

/**
 * #2716: a website leads/sales goal's conversions, read from the same row as its page views. Best effort: a bad
 * conversion field never fails the read, because spend, page views and the spend checks depend on it.
 */
function conversionFigures(row: InsightRow | undefined, goal: ConversionGoal) {
  const action = WEBSITE_CONVERSIONS[goal];
  const count = readAction(row?.actions, action.metaActions, countSchema);
  const values = actionValuesSchema.safeParse(row?.action_values === undefined ? [] : row.action_values);
  if (!values.success || count.state === "ambiguous" || count.state === "invalid") {
    return { conversionGoal: goal, conversionsUnavailable: true as const };
  }
  const value = readAction(values.data, action.metaValueActions, amountSchema);
  if (value.state === "ambiguous" || value.state === "invalid") return { conversionGoal: goal, conversionsUnavailable: true as const };
  const conversions = count.state === "value" ? count.value : 0;
  const conversionValue = value.state === "value" ? value.value : null;
  if (conversions === 0 && conversionValue !== null && conversionValue > 0) return { conversionGoal: goal, conversionsUnavailable: true as const };
  const costPerConversion = conversions > 0 && row?.spend !== undefined ? row.spend / conversions : null;
  return { conversionGoal: goal, conversions, conversionValue, costPerConversion };
}

function adConversions(figures: ReturnType<typeof conversionFigures>) {
  return "conversions" in figures ? { conversions: figures.conversions, conversionValue: figures.conversionValue } : { conversionsUnavailable: true as const };
}

const LEAD_ACTIONS = outcomeDefinition("instant_form").metaActions;
/** #371/#789: the headline WhatsApp result; Meta also reports first replies and depth, which we don't switch to silently. */
const CONVERSATION_ACTIONS = outcomeDefinition("whatsapp").metaActions;
/** Taps on the ad's link, from the same `actions` list (so the request and its recorded tapes stay as they are). */
const LINK_CLICK_ACTIONS = ["link_click"];

/** A campaign's or an ad's headline result: chats for WhatsApp, page views for a website, form leads otherwise. */
function resultCount(count: ReturnType<typeof actionCounter>, destination: CampaignDestination) {
  return count(outcomeDefinition(destination).metaActions);
}

export function decodeCampaignInsights(payload: unknown, destination: CampaignDestination, options?: { requireSpend?: boolean; conversionGoal?: ConversionGoal | null }): CampaignInsights {
  const parsed = insightsSchema.safeParse(payload);
  if (!parsed.success || parsed.data.paging?.next) throw new Error("Campaign insights are incomplete or invalid.");
  const row = parsed.data.data[0];
  const conversionGoal = destination === "website" ? options?.conversionGoal : null;
  if (!validActions(row)) throw new Error("Campaign insights are incomplete or invalid.");
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
    ...(destination === "whatsapp" ? { conversations, costPerConversation: conversations > 0 ? spend / conversations : null, whatsappOpens: actionCount(LINK_CLICK_ACTIONS) } : {}),
    ...(destination === "website" ? websiteFigures(spend, resultCount(actionCount, destination), actionCount(LINK_CLICK_ACTIONS)) : {}),
    ...(conversionGoal ? conversionFigures(row, conversionGoal) : {}),
    ...(row ? {} : { noDelivery: true as const }),
  };
}

function websiteFigures(spend: number, landingPageViews: number, linkClicks: number) {
  return { landingPageViews, linkClicks, cpc: linkClicks > 0 ? spend / linkClicks : null, costPerLandingPageView: landingPageViews > 0 ? spend / landingPageViews : null };
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
  /** Chats for a WhatsApp campaign, landing-page views for a website one (#2601), form leads otherwise. */
  results: number; costPerResult: number | null; whatsappOpens?: number;
  /** #2601: a website campaign's ad also counts its results as landing-page views, so storage knows which they are. */
  landingPageViews?: number;
  /** #2716: a website leads/sales ad's pixel conversions and their value (null: none sent), apart from its page views. */
  conversions?: number; conversionValue?: number | null; conversionsUnavailable?: true;
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
export function decodeAdResults(adsPayload: unknown, insightsPayload: unknown, destination: CampaignDestination, conversionGoal?: ConversionGoal | null): AdResult[] {
  const ads = adListSchema.safeParse(adsPayload);
  const insights = adInsightsSchema.safeParse(insightsPayload);
  if (!ads.success || !insights.success || ads.data.paging?.next || insights.data.paging?.next) throw new Error("Ad results are incomplete or invalid.");
  const goal = destination === "website" ? conversionGoal : null;
  const rows = new Map<string, InsightRow>();
  for (const row of insights.data.data) {
    if (!validActions(row)) throw new Error("Ad results are incomplete or invalid.");
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
    const results = resultCount(count, destination);
    return {
      adId: ad.id, name: ad.name ?? null, effectiveStatus: ad.effective_status ?? null, creativeId: ad.creative?.id ?? null,
      delivered: Boolean(row), impressions: row?.impressions ?? 0, clicks: row?.clicks ?? 0, spend,
      results, costPerResult: results > 0 ? spend / results : null,
      ...(destination === "whatsapp" ? { whatsappOpens: count(LINK_CLICK_ACTIONS) } : {}),
      ...(destination === "website" ? { landingPageViews: results } : {}),
      ...(goal ? adConversions(conversionFigures(row, goal)) : {}),
      replaced: !known.has(ad.id) || ad.effective_status === "ARCHIVED",
    };
  });
}

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
