import type { Campaign } from "@/lib/types";
import type { MetaCampaignState } from "@/lib/meta/insights";

/** #721: Meta deleted or archived it; Refresh ended the row and kept why in `raw.metaStatus`. One word on every page (#1150). */
export function goneInMeta(campaign: Pick<Campaign, "raw">): "Deleted in Meta" | "Archived in Meta" | null {
  const status = campaign.raw && typeof campaign.raw === "object" && !Array.isArray(campaign.raw) ? (campaign.raw as { metaStatus?: unknown }).metaStatus : null;
  return status === "DELETED" ? "Deleted in Meta" : status === "ARCHIVED" ? "Archived in Meta" : null;
}

/** #1601 (CPO): the owner-facing lines for a campaign deleted in Meta Ads Manager. */
export const GONE_LINES = {
  deleted: "This campaign was deleted in Meta Ads Manager, so it can't run or be changed here. Nothing more will spend. Its results up to then stay below.",
} as const;

/** #1600: Home names a campaign deleted in Meta for a week after AdBrain found it (`raw.metaGoneAt`), then lets it go. */
export function recentlyDeletedInMeta(campaign: Pick<Campaign, "raw">, now: number = Date.now()): boolean {
  if (goneInMeta(campaign) !== "Deleted in Meta") return false;
  const at = Date.parse(String((campaign.raw as { metaGoneAt?: unknown }).metaGoneAt ?? ""));
  return Number.isFinite(at) && now - at < 7 * 86_400_000;
}

/** #1968: the campaigns Pause all stops (running and still in Meta), in the shape Home and Settings both pass it. */
export function pausableCampaigns<T extends Pick<Campaign, "id" | "name" | "status" | "raw" | "meta_ad_account_id" | "meta_campaign_id">>(campaigns: T[]) {
  return campaigns.filter((campaign) => campaign.status === "active" && !goneInMeta(campaign))
    .map(({ id, name, meta_ad_account_id, meta_campaign_id }) => ({ id, name, meta_ad_account_id, meta_campaign_id }));
}

/** #1903 (CPO #1601): lines for a campaign paused, or its daily budget changed, in Meta Ads Manager. */
export const OUTSIDE_LINES = {
  paused: "This was paused in Meta Ads Manager. Nothing is spending.",
  budget: (now: string, was: string) => `The daily budget was changed in Meta Ads Manager: now ${now} a day (was ${was}).`,
  endTime: (now: string) => `End date changed in Meta Ads Manager: now ${now}.`,
} as const;

type OutsideRow = Pick<Campaign, "status" | "daily_budget" | "raw">;
type BudgetChange = { wasRupees: number; nowRupees: number; at: string };
type EndTimeChange = { was: string; now: string; at: string };

function rawObject(raw: Campaign["raw"]): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

const second = (iso: unknown): number => typeof iso === "string" ? Math.floor(Date.parse(iso) / 1000) : Number.NaN;

/** The latest capped run AdBrain recorded (#157): its ad set and the end time stored for it. */
function latestCap(raw: Campaign["raw"]): { adSetId: string; endTime: string } | null {
  const cap = rawObject(raw).cap as { adSetId?: unknown; endTime?: unknown } | undefined;
  return cap && typeof cap.adSetId === "string" && typeof cap.endTime === "string" && Number.isFinite(second(cap.endTime))
    ? { adSetId: cap.adSetId, endTime: cap.endTime } : null;
}

/** #2290: the end time Meta holds for the latest capped run's ad set, or null when Meta doesn't say. */
export function metaCapEndTime(raw: Campaign["raw"], state: MetaCampaignState): string | null {
  const cap = latestCap(raw);
  const at = Date.parse(state.adSets.find(adSet => adSet.id === cap?.adSetId)?.endTime ?? "");
  return cap && Number.isFinite(at) ? new Date(at).toISOString() : null;
}

/** #2290: the run's end date changed in Meta Ads Manager, while the row still holds that time (an AdBrain edit since replaces it). */
export function endTimeChangedInMeta(campaign: Pick<Campaign, "raw">): EndTimeChange | null {
  const change = rawObject(campaign.raw).metaEndTimeChange as Partial<EndTimeChange> | undefined;
  const cap = latestCap(campaign.raw);
  if (!change || !cap || typeof change.was !== "string" || typeof change.now !== "string" || typeof change.at !== "string") return null;
  return second(change.now) === second(cap.endTime) ? { was: change.was, now: change.now, at: change.at } : null;
}

/** #1903: AdBrain thinks it runs, Meta says the owner paused it in Ads Manager. AdBrain's own status is kept. */
export function pausedInMeta(campaign: Pick<Campaign, "status" | "raw">): boolean {
  return campaign.status === "active" && typeof rawObject(campaign.raw).metaPausedAt === "string";
}

/** #1903: the daily budget Meta changed, while the row still holds that budget (an AdBrain edit since replaces it). */
export function budgetChangedInMeta(campaign: Pick<Campaign, "daily_budget" | "raw">): (BudgetChange & { raised: boolean }) | null {
  const change = rawObject(campaign.raw).metaBudgetChange as Partial<BudgetChange> | undefined;
  if (!change || typeof change.wasRupees !== "number" || typeof change.nowRupees !== "number" || typeof change.at !== "string") return null;
  if (campaign.daily_budget === null || Math.round(campaign.daily_budget * 100) !== Math.round(change.nowRupees * 100)) return null;
  return { wasRupees: change.wasRupees, nowRupees: change.nowRupees, at: change.at, raised: change.nowRupees > change.wasRupees };
}

/** A daily budget raised in Ads Manager in the last 7 days (Home shows it that long). */
export function recentlyRaisedInMeta(campaign: Pick<Campaign, "daily_budget" | "raw">, now: number = Date.now()): (BudgetChange & { raised: boolean }) | null {
  const budget = budgetChangedInMeta(campaign);
  return budget?.raised && now - Date.parse(budget.at) < 7 * 86_400_000 ? budget : null;
}

const minor = (value: string | undefined): number => value === undefined ? 0 : /^\d{1,15}$/.test(value) ? Number(value) : Number.NaN;

/**
 * Meta's daily budget for the campaign in paise, counted as AdBrain stores it (campaign budget, or the sum of
 * the uncapped ad sets' budgets; #671). Null when it isn't a plain daily budget, so nothing is compared.
 */
export function metaDailyBudgetPaise(state: MetaCampaignState, cappedAdSetIds: readonly string[]): number | null {
  if (minor(state.lifetimeBudget) !== 0) return null;
  let adSetBudget = 0;
  for (const adSet of state.adSets) {
    if (cappedAdSetIds.includes(adSet.id)) continue;
    if (!["ACTIVE", "PAUSED"].includes(adSet.status ?? "") || minor(adSet.lifetimeBudget) !== 0) return null;
    const daily = minor(adSet.dailyBudget);
    if (!Number.isSafeInteger(daily)) return null;
    adSetBudget += daily;
  }
  const campaignBudget = minor(state.dailyBudget);
  const total = campaignBudget > 0 && adSetBudget === 0 ? campaignBudget : campaignBudget === 0 ? adSetBudget : Number.NaN;
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

/**
 * #1903: the row update for what Meta reports, or null when nothing changed. Read-only on Meta. The status never
 * changes here (enforce-spend keeps guarding a row AdBrain thinks runs); `daily_budget` follows Meta so every
 * guardrail and the budget dialog start from what Meta will spend (as Sync does, #671).
 */
export function outsideChanges(
  row: OutsideRow, state: MetaCampaignState, cappedAdSetIds: readonly string[], now: Date,
): { daily_budget?: number; raw: Campaign["raw"]; raised: boolean } | null {
  const raw = rawObject(row.raw);
  let changed = false;
  let raised = false;
  let dailyBudget: number | undefined;
  const pausedThere = row.status === "active" && state.status === "PAUSED";
  if (pausedThere && typeof raw.metaPausedAt !== "string") { raw.metaPausedAt = now.toISOString(); changed = true; }
  if (!pausedThere && "metaPausedAt" in raw) { delete raw.metaPausedAt; changed = true; }
  const paise = metaDailyBudgetPaise(state, cappedAdSetIds);
  if (paise !== null && row.daily_budget !== null && row.daily_budget > 0 && Math.round(row.daily_budget * 100) !== paise) {
    const nowRupees = paise / 100;
    const earlier = budgetChangedInMeta(row);
    const wasRupees = earlier ? earlier.wasRupees : row.daily_budget;
    if (Math.round(wasRupees * 100) === paise) delete raw.metaBudgetChange;
    else raw.metaBudgetChange = { wasRupees, nowRupees, at: now.toISOString() } satisfies BudgetChange;
    raised = nowRupees > row.daily_budget;
    dailyBudget = nowRupees;
    changed = true;
  }
  // #2290: a capped run's end date moved in Ads Manager. Store Meta's time, so enforce-spend ends the run when Meta does.
  const cap = latestCap(row.raw);
  const metaEnd = metaCapEndTime(row.raw, state);
  if (cap && metaEnd && second(metaEnd) !== second(cap.endTime)) {
    const was = endTimeChangedInMeta(row)?.was ?? cap.endTime;
    if (second(was) === second(metaEnd)) delete raw.metaEndTimeChange;
    else raw.metaEndTimeChange = { was, now: metaEnd, at: now.toISOString() } satisfies EndTimeChange;
    const stored = raw.cap as Record<string, unknown>;
    // health.ts dates the run's start as endTime − days, so the days move with the end (as AdBrain's own edit does).
    const days = typeof stored.days === "number" ? Math.max(1, stored.days + Math.round((Date.parse(metaEnd) - Date.parse(cap.endTime)) / 86_400_000)) : undefined;
    raw.cap = { ...stored, endTime: metaEnd, ...days !== undefined ? { days } : {} };
    changed = true;
  }
  return changed ? { ...dailyBudget !== undefined ? { daily_budget: dailyBudget } : {}, raw: raw as Campaign["raw"], raised } : null;
}

/** #763: synced from Meta, not launched by AdBrain (no launch result on record). */
export function madeOutsideAdBrain(campaign: Pick<Campaign, "meta_campaign_id" | "raw">): boolean {
  const raw = campaign.raw;
  return !!campaign.meta_campaign_id && !(raw && typeof raw === "object" && "metaResult" in raw);
}
