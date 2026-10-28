import { GRAPH } from "@/lib/meta/graph-version";
import { z } from "zod";
import { WHATSAPP_PUBLISHER_PLATFORMS } from "@/lib/meta/placements";
import type { SetupReads } from "@/lib/meta/setup-checklist";
import { fetchPublicUrl } from "@/lib/security/ssrf";
import { readBoundedResponse } from "@/lib/imageGen/raster";
import { destinationFromAdSets, type CampaignDestination } from "@/lib/campaign/outcomes";
import type { CampaignSkipReason } from "@/lib/campaign/sync-skips";
import { decodeAdResults, decodeCampaignInsights, decodeLifetimeSpendPaise, type AdResult, type CampaignInsights } from "./insights";
import { maskWhatsAppNumber, maskedWhatsAppNumberPattern } from "./whatsapp-status-shared";
import { graphEndpoint, graphEntity, graphErrorCode, graphOutcome } from "./graph-event";
import { recordProductEvent } from "@/lib/observability/logger";
import { EXCLUDABLE_CITIES, INDIA_REGION_KEYS, mergeExclusions, serviceAreaExclusions, TargetingExclusionsMissingError, type IncludedPlace } from "./service-area";
import { AD_LANGUAGE_KEYS, storedLocales } from "./locales";
export type { AdResult, CampaignInsights } from "./insights";


export interface MetaCredentials {
  adAccountId: string;
  pageId: string;
  accessToken: string;
}

export interface LeadForm {
  id: string;
  name: string;
  status: string;
}

/** A raw instant-form lead as returned by the Graph API. */
export interface MetaLead {
  id: string;
  created_time: string;
  field_data: { name: string; values: string[] }[];
  /** The ad's campaign; absent for leads Meta didn't get from an ad (e.g. organic or test leads). */
  campaign_id?: string;
}

export interface MetaLeadPage<T> {
  data: T[];
  after: string | null;
}

const formPageSchema = z.object({ id: z.string().min(1).max(200), name: z.string().max(1000), status: z.string() });
const leadPageSchema = z.object({
  id: z.string().min(1).max(200),
  created_time: z.string().refine(value => !value || Number.isFinite(Date.parse(value))).optional().default(""),
  field_data: z.array(z.object({ name: z.string(), values: z.array(z.string()) })).default([]),
  campaign_id: z.string().regex(/^\d{1,64}$/).optional().catch(undefined),
});

function parseLeadPage<T>(value: unknown, schema: z.ZodType<T>, previous?: string | null): MetaLeadPage<T> {
  const page = z.object({
    data: z.array(schema).max(200),
    paging: z.object({ next: z.string().optional(), cursors: z.object({ after: z.string().min(1).max(4096) }).partial().optional() }).optional(),
  }).safeParse(value);
  if (!page.success) throw new MetaError("Malformed Meta lead page.");
  const after = page.data.paging?.next ? page.data.paging.cursors?.after : null;
  if (after === undefined || (after !== null && (after === previous || !/^[A-Za-z0-9_+/=-]+$/.test(after)))) {
    throw new MetaError("Invalid Meta lead page cursor.");
  }
  return { data: page.data.data, after };
}

async function collectLeadPages<T>(read: (after: string | null) => Promise<MetaLeadPage<T>>): Promise<T[]> {
  const values: T[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  for (let count = 0; count < 100; count++) {
    const page = await read(after);
    values.push(...page.data);
    if (!page.after) return values;
    if (seen.has(page.after)) throw new MetaError("Repeated Meta lead page cursor.");
    seen.add(page.after);
    after = page.after;
  }
  throw new MetaError("Meta lead page limit exceeded; use resumable sync.");
}

export interface CreativeInput {
  imageUrl: string;
  headline: string;
  message: string;
  description?: string | null;
  cta?: string | null;
  /**
   * The same ad at 9:16 for Stories and Reels (#333); without it every placement gets the 4:5 image.
   * May still be rendering: it is awaited only when its upload is due, so the render overlaps Meta's calls.
   */
  storyImage?: Uint8Array | null | Promise<Uint8Array | null>;
}

/** A resolved Meta geo-targeting spec (subset of the targeting `geo_locations`). */
export interface GeoTargeting {
  countries?: string[];
  regions?: { key: string }[];
  cities?: { key: string; radius?: number; distance_unit?: string }[];
}

export interface AudienceInterest {
  id: string;
  name: string;
}

/** One result from Meta's adgeolocation search. */
export interface GeoSearchResult {
  key: string;
  name: string;
  type: string; // "city" | "region" | "country" | "zip" | ...
  country_code?: string;
  country_name?: string;
  region?: string;
}

/**
 * A place the user picked from search (already carries a Meta key), optionally
 * with a per-city radius. Used to build targeting without re-searching.
 */
export interface GeoItem {
  key: string;
  name: string;
  type: string;
  radiusKm?: number;
}

/** A city/region name resolved to a Meta geo key. */
export interface MatchedGeo {
  name: string;
  type: string;
  key: string;
  label: string;
}

/** #1045: one ad's status as Meta reads it back; `changed` is false when it already had that status (no write). */
export type AdStatus = { id: string; status: string | null; effectiveStatus: string | null; changed: boolean };

export interface ResolvedGeo {
  targeting: GeoTargeting;
  matched: MatchedGeo[];
  unresolved: string[];
}

export interface CreateCampaignResult {
  campaignId: string;
  adSetId: string;
  adSetIds: string[];
  adIds: string[];
  destination: AdDestination;
  /** #672: the creative each ad runs on, in ad order (the single-image one after a placement fallback). */
  creativeIds?: string[];
}

export type CampaignMutationCheckpoint = {
  phase: "campaign" | "adset" | "creative" | "ad";
  externalId: string;
  variantIndex?: number;
  creativeIndex?: number;
};

export interface MetaCampaignSummary {
  id: string;
  name: string;
  status: string;
  objective: string;
  daily_budget?: string;
  effective_status?: string;
  created_time?: string;
}

/** #773: what an owner may change on a launched ad set's audience (the same inputs as launch). */
export type AudienceChanges = {
  location?: GeoTargeting;
  excludedLocation?: GeoTargeting;
  age?: { min: number; max: number };
  gender?: "all" | "men" | "women";
  /** Meta ad locale keys; an empty list removes the language limit. */
  languages?: number[];
};
export type AudienceEdit = { mode: "patch" | "rebuild"; validated: boolean; adSetId: string; adIds: string[]; retiredAdSetId: string | null };
/** #765 (b): a running ad set's PAUSED copy was switched on and the old ad set retired. */
export type AdSetSwitch = { fromAdSetId: string; adSetId: string; adIds: string[] };
/** #774: an ad set's budget as Meta reports it, in paise. A capped run has a lifetime budget and an end time. */
export type AdSetBudget = {
  adSetId: string; status: string; dailyBudgetPaise: number; lifetimeBudgetPaise: number; remainingPaise: number; endTime: string | null;
};
export type AdSetBudgetChange = { dailyBudgetPaise?: number; lifetimeBudgetPaise?: number; endTime?: string };

/** Interests (or other detailed targeting) make Meta refuse an in-place targeting update (100/1359202). */
function hasInterests(targeting: Record<string, unknown>): boolean {
  const flexible = targeting.flexible_spec;
  return (Array.isArray(targeting.interests) && targeting.interests.length > 0)
    || (Array.isArray(flexible) && flexible.some(spec => spec && typeof spec === "object" && Object.keys(spec).length > 0));
}

/**
 * #912: Meta refuses an in-place targeting update (100/1359202) on an ad set with interests, and on every
 * WhatsApp (click-to-WhatsApp, Advantage+ audience) ad set even without them; those are rebuilt.
 */
export function needsRebuild(adSet: { targeting?: unknown; destination_type?: string | null }): boolean {
  const targeting = adSet.targeting && typeof adSet.targeting === "object" ? adSet.targeting as Record<string, unknown> : {};
  return hasInterests(targeting) || adSet.destination_type === "WHATSAPP";
}

const AUTO_EXCLUDED_REGIONS = new Set<string>(INDIA_REGION_KEYS);
const AUTO_EXCLUDED_CITIES = new Set(EXCLUDABLE_CITIES.map(city => city.key));

/**
 * #773: exclusions only grow. The ad set's existing exclusions are kept and the new ones added by key
 * (per type). The one exception: when the area itself changes, an exclusion AdBrain's own service-area
 * rule added earlier (a state or city of #741's list) that the new area no longer excludes is dropped,
 * because it may cover the new area. The owner's own exclusions are never removed.
 */
function grownExclusions(existing: unknown, added: GeoTargeting, areaChanged: boolean): Record<string, unknown> | undefined {
  const old = existing && typeof existing === "object" && !Array.isArray(existing) ? existing as Record<string, unknown> : {};
  const fresh = buildGeoLocations(added, []);
  const out: Record<string, unknown> = { ...old };
  for (const type of ["regions", "cities"] as const) {
    const auto = type === "regions" ? AUTO_EXCLUDED_REGIONS : AUTO_EXCLUDED_CITIES;
    const additions = Array.isArray(fresh[type]) ? fresh[type] as Array<{ key: string }> : [];
    const additionKeys = new Set(additions.map(item => item.key));
    const kept = (Array.isArray(old[type]) ? old[type] as Array<{ key: string }> : [])
      .filter(item => !areaChanged || !auto.has(String(item.key)) || additionKeys.has(item.key));
    const merged = [...kept, ...additions.filter(item => !kept.some(have => have.key === item.key))];
    if (merged.length) out[type] = merged; else delete out[type];
  }
  const countries = [...new Set([
    ...Array.isArray(old.countries) ? old.countries as string[] : [],
    ...Array.isArray(fresh.countries) ? fresh.countries as string[] : [],
  ])];
  if (countries.length) out.countries = countries; else delete out.countries;
  return Object.keys(out).length ? out : undefined;
}

/**
 * #773: the source targeting with the owner's changes, built by launch's rules: area and exclusions hard;
 * with Advantage+ audience on, a hard age_min up to 25, age_max 65 and the owner's range as `age_range`.
 */
function editedTargeting(source: Record<string, unknown>, changes: AudienceChanges): Record<string, unknown> {
  const next: Record<string, unknown> = { ...source };
  if (changes.location) next.geo_locations = { ...buildGeoLocations(changes.location, []), location_types: ["home", "recent"] };
  if (changes.excludedLocation) {
    const grown = grownExclusions(source.excluded_geo_locations, changes.excludedLocation, Boolean(changes.location));
    if (grown) next.excluded_geo_locations = grown; else delete next.excluded_geo_locations;
  }
  if (changes.age) {
    const advantage = (source.targeting_automation as { advantage_audience?: number } | undefined)?.advantage_audience === 1;
    const { min, max } = changes.age;
    if (advantage) {
      const hardMin = Math.min(min, ADVANTAGE_AUDIENCE_MAX_HARD_AGE_MIN);
      Object.assign(next, { age_min: hardMin, age_max: 65 });
      if (min !== hardMin || max !== 65) next.age_range = [min, max]; else delete next.age_range;
    } else {
      Object.assign(next, { age_min: min, age_max: max });
      delete next.age_range;
    }
  }
  if (changes.gender) {
    if (changes.gender === "all") delete next.genders; else next.genders = [changes.gender === "men" ? 1 : 2];
  }
  if (changes.languages) {
    if (changes.languages.length) next.locales = [...changes.languages]; else delete next.locales;
  }
  return next;
}

/** A place (city, region or country) that is both in `geo_locations` and in `excluded_geo_locations`. */
function excludesIncludedPlace(targeting: Record<string, unknown>): boolean {
  const geo = (value: unknown) => (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const keys = (spec: Record<string, unknown>, type: string) => new Set((Array.isArray(spec[type]) ? spec[type] as unknown[] : [])
    .map(item => typeof item === "string" ? item : String((item as { key?: unknown }).key)));
  const included = geo(targeting.geo_locations);
  const excluded = geo(targeting.excluded_geo_locations);
  return ["cities", "regions", "countries"].some(type => {
    const out = keys(excluded, type);
    return [...keys(included, type)].some(key => out.has(key));
  });
}

const numbers = (value: unknown): number[] => Array.isArray(value) ? value.map(Number).filter(Number.isInteger) : [];

/** Meta echoed the changed audience back (it may add defaults, so only what changed is compared). */
function sameAudience(targeting: Record<string, unknown> | undefined, sent: Record<string, unknown>, changes: AudienceChanges): boolean {
  if (!targeting) return false;
  const norm = (value: unknown): string => JSON.stringify(value ?? null);
  return (!changes.location || targeting.geo_locations !== undefined)
    && (!changes.excludedLocation || sent.excluded_geo_locations === undefined || targeting.excluded_geo_locations !== undefined)
    && (!changes.age || ["age_min", "age_max", "age_range"].every(key => norm(targeting[key]) === norm(sent[key])))
    && (!changes.gender || norm(targeting.genders) === norm(sent.genders))
    && (!changes.languages || norm(storedLocales(numbers(targeting.locales))) === norm(storedLocales(numbers(sent.locales))));
}

export class MetaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number,
    readonly subcode?: number,
    /** #615: Meta's own diagnosis for telemetry; never tokens or request bodies. */
    readonly details?: MetaErrorDetails,
  ) {
    super(message);
    this.name = "MetaError";
  }
}

/** #757: Graph 190 (any subcode: expired, password change, checkpoint, permission removed) means the token is dead. */
export function isMetaReauthError(error: unknown): error is MetaError {
  return error instanceof MetaError && error.code === 190;
}

/**
 * #735: a create that failed after Meta made the campaign but before any ad set, where AdBrain then
 * deleted that empty PAUSED campaign and Meta confirmed it. Nothing is left in Meta.
 */
export class MetaCreateRolledBackError extends MetaError {
  constructor(readonly campaignId: string, readonly original: unknown) {
    super(`${original instanceof Error ? original.message : "Campaign creation failed"} (the empty paused campaign ${campaignId} was deleted; nothing is left in Meta)`,
      original instanceof MetaError ? original.status : undefined, original instanceof MetaError ? original.code : undefined,
      original instanceof MetaError ? original.subcode : undefined, original instanceof MetaError ? original.details : undefined);
    this.name = "MetaCreateRolledBackError";
  }
}

export type MetaErrorDetails = { userTitle?: string; fbtraceId?: string; path?: string };

type GraphErrorBody = { message?: string; error_user_msg?: string; error_user_title?: string; code?: number; error_subcode?: number; fbtrace_id?: string };


const META_SUBCODE_MESSAGES: Record<number, (userMessage: string) => string> = {
  2446307: userMessage =>
    `Meta's minimum campaign spending limit for this currency is ${userMessage.match(/₹\s?[\d,]+(?:\.\d+)?/)?.[0] ?? "higher than this amount"}.`,
  1885257: () => "Meta does not allow changing a daily budget ad set to a lifetime budget.",
  // #774: recorded in tests/core/fixtures/meta/edit-budget-refused.json (the text arrives in the token user's locale).
  1885272: userMessage =>
    `That budget is below Meta's minimum${userMessage.match(/₹\s?[\d,]+(?:\.\d+)?/) ? ` of ${userMessage.match(/₹\s?[\d,]+(?:\.\d+)?/)![0]} a day` : ""}. Choose a higher budget.`,
};

/** English text for a Graph error; error_user_msg follows the token user's locale (#185). */
export function metaErrorMessage(error: GraphErrorBody | undefined, status: number): string {
  const userMessage = error?.error_user_msg ?? "";
  const mapped = error?.error_subcode ? META_SUBCODE_MESSAGES[error.error_subcode]?.(userMessage) : undefined;
  if (mapped) return mapped;
  if (userMessage && /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]+$/u.test(userMessage)) return userMessage;
  return error?.message || `Meta HTTP ${status}`;
}

export class CampaignDeliveryError extends MetaError {}
/** The switch failed after the old ad set was paused and it couldn't be turned back on: reconcile in Meta. */
export class AdSetSwitchStuckError extends CampaignDeliveryError {}

/** #721: Meta deleted or archived the campaign, so it has no ad sets left to read. */
export class CampaignGoneError extends MetaError {
  constructor(readonly metaStatus: "DELETED" | "ARCHIVED") {
    super(`This campaign was ${metaStatus === "DELETED" ? "deleted" : "archived"} in Meta, so it has no new results.`);
    this.name = "CampaignGoneError";
  }
}

export type CampaignDeliverySnapshot = {
  campaign: { id: string; status: string; effectiveStatus: string | null };
  adSets: Array<{ id: string; status: string; effectiveStatus: string | null; dailyBudgetPaise: number; pageId: string; destinationType: string | null; targeting: unknown }>;
  ads: Array<{ id: string; status: string; effectiveStatus: string | null; adSetId: string; creativeId: string }>;
};

export type PausedCampaignTree = {
  confirmed: boolean;
  objects: Array<{ id: string; level: "campaign" | "adset" | "ad"; status: string; effectiveStatus: string | null }>;
};

export type CappedAdSet = { adSetId: string; adIds: string[]; lifetimeBudgetPaise: number; endTime: string };
/** #1058/#1094: ad set states that can still spend their budget; over-counting is the safe side for money. */
const SPENDING_AD_SET_STATUSES = ["ACTIVE", "IN_PROCESS", "WITH_ISSUES"];
export type AccountFunding = { spendCapPaise: number; amountSpentPaise: number; roomPaise: number; prepay: boolean };
export type CappedActivation = {
  campaign: { id: string; status: "ACTIVE"; effectiveStatus: string | null };
  adSet: { id: string; status: "ACTIVE"; effectiveStatus: string | null; lifetimeBudgetPaise: number; budgetRemainingPaise: number; endTime: string };
  ads: Array<{ id: string; status: "ACTIVE"; effectiveStatus: string | null }>;
};

export type AdReviewState = "in_review" | "approved" | "rejected" | "issues" | "unknown";
/** #1305: Meta's policy key (e.g. "Personal Attributes") with its message; null policy for `issues_info`. */
export type AdReviewFeedback = { policy: string | null; message: string };
export type AdReview = { adId: string; state: AdReviewState; effectiveStatus: string | null; reasons: string[]; feedback: AdReviewFeedback[] };

/** Meta's review outcome for one ad, from `effective_status`, `ad_review_feedback` and `issues_info`. */
export function adReviewState(ad: { id: string; effective_status?: string; ad_review_feedback?: unknown; issues_info?: unknown }): AdReview {
  const status = ad.effective_status ?? null;
  // `{ global: { "Personal Attributes": "…" }, placement_specific: {…} }`: the inner keys are the policies (#1305).
  const feedback: AdReviewFeedback[] = ad.ad_review_feedback && typeof ad.ad_review_feedback === "object"
    ? Object.values(ad.ad_review_feedback as Record<string, unknown>).flatMap((group): AdReviewFeedback[] =>
      group && typeof group === "object"
        ? Object.entries(group as Record<string, unknown>).map(([policy, message]) => ({ policy: policy.trim() || null, message: typeof message === "string" ? message.trim() : "" }))
        : [{ policy: null, message: typeof group === "string" ? group.trim() : "" }])
      .filter((item) => item.message)
    : [];
  const issues: AdReviewFeedback[] = Array.isArray(ad.issues_info)
    ? ad.issues_info.map(issue => (issue as { error_message?: unknown }).error_message)
      .filter((reason): reason is string => typeof reason === "string" && reason.trim() !== "")
      .map((message) => ({ policy: null, message: message.trim() }))
    : [];
  const state: AdReviewState = status === "DISAPPROVED" ? "rejected"
    : status === "WITH_ISSUES" ? "issues"
    : status === "IN_PROCESS" || status === "PENDING_REVIEW" ? "in_review"
    : status && ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "PREAPPROVED"].includes(status) ? "approved"
    : "unknown";
  const all = [...feedback, ...issues];
  return { adId: ad.id, state, effectiveStatus: status, reasons: all.map((item) => item.message), feedback: all };
}

/** Graph allows about one status write per object per 30 s (error 613). */
const STATUS_RATE_LIMIT_WAIT_MS = 30_000;

/** Convert raw Graph API text into stable customer-facing copy. */
export function friendlyMetaError(
  error: unknown,
  fallback = "Meta could not complete that request.",
): string {
  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();
  if (/lead_gen_form_id|call_to_action|invalid.*cta|cta.*invalid/.test(normalized)) {
    return "Meta rejected the ad call-to-action for this lead form. Please choose another approved creative or lead form and try again.";
  }
  if (/permission|permissions|not authorized|oauth|access token|token.*expired|session/.test(normalized)) {
    return "Your Meta connection needs attention. Reconnect the ad account in Settings and try again.";
  }
  if (/targeting|geo|location|age_min|age_max|audience/.test(normalized)) {
    return "Meta rejected the audience settings. Review the locations and age range, then try again.";
  }
  if (/minimum campaign spending limit/.test(normalized)) {
    return `${message} The campaign stays paused.`;
  }
  if (/below meta's minimum/.test(normalized)) return message;
  if (/bid_strategy|bid strategy|bidding strategy/.test(normalized)) {
    return "Meta rejected the bidding strategy. Changing the daily budget alone may not fix this; the campaign bidding configuration needs review.";
  }
  if (/billing_event|billing event/.test(normalized)) {
    return "Meta rejected the billing event for this campaign. The billing and optimization settings need review before trying again.";
  }
  if (/budget|daily_budget/.test(normalized)) {
    return "Meta rejected the budget settings. Check the daily budget and try again.";
  }
  if (/image|creative|adcreative|ad image/.test(normalized)) {
    return "Meta could not use this creative. Choose another approved ad or regenerate it, then try again.";
  }
  return fallback;
}

/** Where leads land: an in-ad instant form, a WhatsApp chat, or a phone call. */
export type AdDestination = "instant_form" | "whatsapp" | "call";

/** #680: WhatsApp and lead-form ads get the 9:16 placement creative and leave Audience Network out, so an A/B differs only in destination. */
function hasPlacementCreative(destination: AdDestination): boolean {
  return destination === "whatsapp" || destination === "instant_form";
}

export interface DestinationPlan {
  optimizationGoal: string;
  destinationType: string;
}

/** Ad-set optimisation goal + destination type for a lead destination. */
export function destinationPlan(dest: AdDestination): DestinationPlan {
  switch (dest) {
    case "call":
      return { optimizationGoal: "QUALITY_CALL", destinationType: "PHONE_CALL" };
    case "whatsapp":
      return { optimizationGoal: "CONVERSATIONS", destinationType: "WHATSAPP" };
    default:
      return { optimizationGoal: "LEAD_GENERATION", destinationType: "ON_AD" };
  }
}

function normalizeWhatsAppNumber(value: string): string | null {
  const number = value.replace(/[\s().-]/g, "").replace(/^\+?/, "+");
  return /^\+[1-9]\d{6,14}$/.test(number) ? number : null;
}

/**
 * How a click-to-WhatsApp chat opens (#840): the business's greeting, then either a message
 * pre-typed for the customer (optionally with a Call now button under the greeting) or up to
 * three tap-to-send questions (ice breakers, #680 B1).
 */
export type WhatsAppOpening = { autofill: string; greeting: string; callButton?: boolean; iceBreakers?: string[] };

import { ICE_BREAKER_LIMITS } from "./limits";
export { ICE_BREAKER_LIMITS };

/** Meta's click-to-WhatsApp `page_welcome_message` for an opening (shapes from Meta's click-to-WhatsApp guide). */
export function whatsappWelcomeMessage(opening: WhatsAppOpening): string {
  const iceBreakers = opening.iceBreakers?.map((title) => title.trim()).filter(Boolean) ?? [];
  if (opening.iceBreakers && (!iceBreakers.length || iceBreakers.length > ICE_BREAKER_LIMITS.count
    || iceBreakers.some((title) => [...title].length > ICE_BREAKER_LIMITS.chars) || new Set(iceBreakers).size !== iceBreakers.length)) {
    throw new MetaError(`Use 1 to ${ICE_BREAKER_LIMITS.count} different questions of up to ${ICE_BREAKER_LIMITS.chars} characters each.`);
  }
  if (iceBreakers.length && opening.callButton) throw new MetaError("A Call now button goes with a pre-typed message, not with questions.");
  return JSON.stringify({
    type: "VISUAL_EDITOR",
    version: 2,
    landing_screen_type: "welcome_message",
    media_type: "text",
    text_format: iceBreakers.length
      ? { customer_action_type: "ice_breakers", message: { text: opening.greeting, ice_breakers: iceBreakers.map((title) => ({ title })) } }
      : {
        customer_action_type: "autofill_message",
        message: {
          autofill_message: { content: opening.autofill },
          text: opening.greeting,
          ...(opening.callButton ? { automated_greeting_message_cta: { type: "call" } } : {}),
        },
      },
  });
}

/** #775: the words an owner can change on a launched ad. Pictures and CTA come later (#744). */
export type AdCopyEdit = {
  headline?: string;
  message?: string;
  description?: string;
  whatsappGreeting?: { autofill: string; greeting: string };
};

type StoredCreative = { name?: string; object_story_spec?: Record<string, unknown>; asset_feed_spec?: Record<string, unknown> };

/**
 * #775: the `adcreatives` form for an edited copy of a launched ad's creative. Starts from the
 * creative exactly as Meta stores it (images, 9:16 rules, Page and Instagram ids are kept) and
 * changes only the edited words, in whichever shape the ad was launched (single image or placement).
 */
export function editedCreativeForm(creative: StoredCreative, edit: AdCopyEdit): Record<string, string> {
  const text = (value: string | undefined) => value?.trim() || undefined;
  const headline = text(edit.headline), message = text(edit.message), description = text(edit.description);
  if (!headline && !message && !description && !edit.whatsappGreeting) throw new MetaError("Change at least one part of the ad before saving.");
  const welcome = edit.whatsappGreeting ? whatsappWelcomeMessage(edit.whatsappGreeting) : undefined;
  const name = (headline ?? creative.name ?? "AdBrain creative").slice(0, 90);
  if (creative.asset_feed_spec) {
    const feed = structuredClone(creative.asset_feed_spec) as Record<string, unknown> & { additional_data?: Record<string, unknown> };
    if (message) feed.bodies = [{ text: message }];
    if (headline) feed.titles = [{ text: headline }];
    if (description) feed.descriptions = [{ text: description }];
    if (welcome) {
      if (!feed.additional_data?.page_welcome_message) throw new MetaError("This ad has no WhatsApp message to change.");
      feed.additional_data = { ...feed.additional_data, page_welcome_message: welcome };
    }
    return { name, object_story_spec: JSON.stringify(creative.object_story_spec ?? {}), asset_feed_spec: JSON.stringify(feed) };
  }
  const story = structuredClone(creative.object_story_spec ?? {}) as { link_data?: Record<string, unknown> };
  if (!story.link_data) throw new MetaError("This ad's format can't be edited in AdBrain yet.");
  if (message) story.link_data.message = message;
  if (headline) story.link_data.name = headline;
  if (description) story.link_data.description = description;
  if (welcome) {
    if (!story.link_data.page_welcome_message) throw new MetaError("This ad has no WhatsApp message to change.");
    story.link_data.page_welcome_message = welcome;
  }
  return { name, object_story_spec: JSON.stringify(story) };
}

/** The creative call-to-action for a lead destination. */
export function destinationCTA(
  dest: AdDestination,
  opts: { leadFormId?: string; phone?: string; ctaLabel?: string | null },
): { type: string; value: Record<string, unknown> } {
  if (dest === "call" && opts.phone) {
    return { type: "CALL_NOW", value: { link: `tel:${opts.phone}` } };
  }
  if (dest === "whatsapp") {
    return { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP", ...(opts.phone ? { link: `https://wa.me/${opts.phone.replace(/^\+/, "")}` } : {}) } };
  }
  // A human creative CTA is presentation copy, not a safe Graph API CTA. In
  // particular, BOOK_NOW is not accepted for every instant-form lead ad.
  return {
    type: "LEARN_MORE",
    value: { lead_gen_form_id: opts.leadFormId },
  };
}

/** Meta rejects a hard minimum age above this with Advantage+ audience on (subcode 1870188). */
const ADVANTAGE_AUDIENCE_MAX_HARD_AGE_MIN = 25;

/**
 * Ad set targeting with Advantage+ audience on (#334). Area and exclusions stay hard
 * limits; Meta may go beyond the owner's age range, gender and interests, which it
 * treats as suggestions. Meta only accepts a hard age_min up to 25 and no hard
 * age_max below 65 (subcode 1870189), so the owner's range is sent as `age_range`.
 */
export function adSetTargeting(params: {
  location: GeoTargeting | undefined;
  excludedLocation?: GeoTargeting;
  ageMin: number;
  ageMax: number;
  gender?: "all" | "men" | "women";
  interests?: AudienceInterest[];
}): Record<string, unknown> {
  const hardMin = Math.min(params.ageMin, ADVANTAGE_AUDIENCE_MAX_HARD_AGE_MIN);
  return {
    geo_locations: { ...buildGeoLocations(params.location, []), location_types: ["home", "recent"] },
    ...(hasGeo(params.excludedLocation) ? { excluded_geo_locations: buildGeoLocations(params.excludedLocation, []) } : {}),
    age_min: hardMin,
    age_max: 65,
    ...(params.ageMin !== hardMin || params.ageMax !== 65 ? { age_range: [params.ageMin, params.ageMax] } : {}),
    ...(params.gender === "men" ? { genders: [1] } : params.gender === "women" ? { genders: [2] } : {}),
    ...(params.interests?.length ? { flexible_spec: [{ interests: params.interests }] } : {}),
    targeting_automation: { advantage_audience: ADVANTAGE_AUDIENCE ? 1 : 0 },
  };
}

/** #783: every ad status Meta will list for a campaign's ads; DELETED can't be requested (1815001). */
const LISTED_AD_STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES", "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED", "PENDING_BILLING_INFO"];

/** #906/#680: a WhatsApp or lead-form ad set's targeting names its platforms without Audience Network. */
export function withoutAudienceNetwork(targeting: Record<string, unknown>): Record<string, unknown> {
  const platforms = Array.isArray(targeting.publisher_platforms) ? (targeting.publisher_platforms as unknown[]).filter(item => item !== "audience_network") : [];
  const { audience_network_positions: _dropped, ...rest } = targeting;
  void _dropped;
  return { ...rest, publisher_platforms: platforms.length ? platforms : [...WHATSAPP_PUBLISHER_PLATFORMS] };
}

/** #334: every ad set runs with Advantage+ audience (area and age_min hard). The learning ledger records it (#588). */
const ADVANTAGE_AUDIENCE = true;

/** A short, loggable code for a failed Graph call: Meta's code/subcode, else the HTTP status. */
export function metaErrorCode(error: unknown): string {
  if (error instanceof MetaError) return error.code ? `${error.code}${error.subcode ? `.${error.subcode}` : ""}` : `http.${error.status ?? "unknown"}`;
  return error instanceof Error && error.name === "TimeoutError" ? "timeout" : "unknown";
}

const GET_RETRY_DELAY_MS = 500;

/** #1199: a failure a repeat of the same read can cure: our 15 s timeout, a dropped connection, or a Meta 5xx. */
function transientReadFailure(error: unknown): boolean {
  if (error instanceof MetaError) return error.status !== undefined && error.status >= 500;
  return error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError");
}

/**
 * Meta answered and refused the request (a 4xx with a Meta subcode, e.g. 100/1772103). Timeouts,
 * transport errors and 5xx are not refusals: the object may exist, so retrying could duplicate it.
 */
function isMetaRefusal(error: unknown): boolean {
  return error instanceof MetaError && error.status !== undefined && error.status >= 400 && error.status < 500 && error.subcode !== undefined;
}

const STORY_PLACEMENTS = {
  publisher_platforms: ["facebook", "instagram", "messenger"],
  facebook_positions: ["story", "facebook_reels"],
  instagram_positions: ["story", "reels", "profile_reels"],
  messenger_positions: ["story"],
};
// Placement creatives go to WhatsApp and lead-form ads, whose ad sets leave Audience Network out (#906, #680).
const FEED_PLACEMENTS = {
  publisher_platforms: ["facebook", "instagram", "messenger"],
  facebook_positions: ["feed", "right_hand_column", "marketplace", "video_feeds", "search", "instream_video", "facebook_reels_overlay", "profile_feed", "notification", "biz_disco_feed"],
  instagram_positions: ["stream", "explore", "explore_home", "profile_feed", "ig_search"],
  messenger_positions: ["messenger_home", "sponsored_messages"],
};

/**
 * A creative with a 4:5 feed image and a 9:16 image that Meta uses for Stories and Reels (#333).
 * Placement asset customisation needs asset_feed_spec; object_story_spec then carries only the Page.
 */
export function placementCreativeSpec(p: {
  pageId: string;
  instagramUserId: string;
  feedHash: string;
  storyHash: string;
  headline: string;
  message: string;
  description?: string;
  link: string;
  destination: AdDestination;
  whatsappNumber?: string;
  whatsappGreeting?: WhatsAppOpening;
  leadFormId?: string;
}) {
  const cta = destinationCTA(p.destination, { leadFormId: p.leadFormId, phone: p.whatsappNumber });
  return {
    object_story_spec: { page_id: p.pageId, instagram_user_id: p.instagramUserId },
    asset_feed_spec: {
      images: [
        { hash: p.feedHash, adlabels: [{ name: "adbrain_feed" }] },
        { hash: p.storyHash, adlabels: [{ name: "adbrain_story" }] },
      ],
      bodies: [{ text: p.message }],
      titles: [{ text: p.headline }],
      ...(p.description?.trim() ? { descriptions: [{ text: p.description.trim() }] } : {}),
      link_urls: [{ website_url: p.link }],
      call_to_action_types: [cta.type],
      // #680: a lead ad names its form here; with only the type Meta refuses (3390001).
      ...(p.destination === "instant_form" && p.leadFormId ? { call_to_actions: [{ type: cta.type, value: { lead_gen_form_id: p.leadFormId } }] } : {}),
      ...(p.destination === "whatsapp" && p.whatsappGreeting ? { additional_data: { page_welcome_message: whatsappWelcomeMessage(p.whatsappGreeting) } } : {}),
      ad_formats: ["SINGLE_IMAGE"],
      optimization_type: "PLACEMENT",
      // Every placement must match exactly one rule, by explicit position, or Meta can't show it there.
      asset_customization_rules: [
        { customization_spec: STORY_PLACEMENTS, image_label: { name: "adbrain_story" }, priority: 1 },
        { customization_spec: FEED_PLACEMENTS, image_label: { name: "adbrain_feed" }, priority: 2 },
      ],
    },
  };
}

/** One ad set in a campaign — its own audience, for an audience A/B test. */
export interface AdSetVariant {
  label?: string;
  ageMin?: number;
  ageMax?: number;
  location?: GeoTargeting;
  excludedLocation?: GeoTargeting;
}

/**
 * Split an age range into two contiguous bands for an A/B test. Returns a single
 * band when the range is too narrow to split meaningfully.
 */
export function splitAgeRange(
  min: number,
  max: number,
): { ageMin: number; ageMax: number; label: string }[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 6) {
    return [{ ageMin: min, ageMax: max, label: `Age ${min}–${max}` }];
  }
  const mid = Math.floor((min + max) / 2);
  return [
    { ageMin: min, ageMax: mid, label: `Age ${min}–${mid}` },
    { ageMin: mid + 1, ageMax: max, label: `Age ${mid + 1}–${max}` },
  ];
}

/** Meta city-radius bounds (kilometers). */
const RADIUS_MIN_KM = 5;
const RADIUS_MAX_KM = 80;

function clampRadiusKm(km: number): number {
  if (!Number.isFinite(km)) return 25;
  return Math.min(Math.max(Math.round(km), RADIUS_MIN_KM), RADIUS_MAX_KM);
}

/**
 * Pick the best adgeolocation match for a typed place name. Meta returns
 * Exact names and qualified city/region labels take precedence. Otherwise keep
 * Meta's relevance order within the requested country and preferred place type.
 */
export function pickBestGeoMatch(
  matches: GeoSearchResult[],
  query: string,
  preferCountry = "",
): GeoSearchResult | null {
  if (!matches.length) return null;
  const normalizedQuery = query.trim().toLowerCase();
  const exact = matches.filter((match) => [match.name, geoLabel(match)]
    .some((label) => label.trim().toLowerCase() === normalizedQuery));
  const candidates = exact.length ? exact : matches;
  const inCountry = preferCountry
    ? candidates.filter((m) => !m.country_code || m.country_code === preferCountry)
    : candidates;
  const pool = inCountry.length ? inCountry : candidates;
  for (const type of ["city", "region", "country"]) {
    const hit = pool.find((m) => m.type === type);
    if (hit) return hit;
  }
  return pool[0] ?? null;
}

/**
 * Build the targeting `geo_locations` object, falling back to whole countries
 * when no city/region/country resolved.
 */
export function buildGeoLocations(
  geo: GeoTargeting | undefined,
  fallbackCountries: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (geo?.cities?.length) out.cities = geo.cities;
  if (geo?.regions?.length) out.regions = geo.regions;
  if (geo?.countries?.length) out.countries = geo.countries;
  if (!out.cities && !out.regions && !out.countries) {
    out.countries = fallbackCountries;
  }
  return out;
}

/** Short human label for a resolved geo match (e.g. "Jaipur (city)"). */
function geoLabel(m: GeoSearchResult): string {
  const region = m.region ? `, ${m.region}` : "";
  return `${m.name}${region}`;
}

/**
 * Convert user-picked places (each already carrying a Meta key) into a
 * `GeoTargeting` spec. Cities get a radius (their own, else the default);
 * regions and countries are exact. Duplicates are removed. Pure — no network.
 */
export function geoItemsToTargeting(
  items: GeoItem[],
  defaultRadiusKm = 25,
  cityScope: "city_only" | "radius" = "radius",
): GeoTargeting {
  const cities: NonNullable<GeoTargeting["cities"]> = [];
  const regions: NonNullable<GeoTargeting["regions"]> = [];
  const countries: string[] = [];
  const seen = new Set<string>();
  for (const item of items ?? []) {
    const key = (item?.key ?? "").trim();
    if (!key) continue;
    const dedupe = `${item.type}:${key}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    if (item.type === "city") {
      cities.push({
        key,
        ...(cityScope === "radius" ? {
          radius: clampRadiusKm(item.radiusKm ?? defaultRadiusKm),
          distance_unit: "kilometer",
        } : {}),
      });
    } else if (item.type === "region") {
      regions.push({ key });
    } else if (item.type === "country") {
      countries.push(key);
    }
  }
  const geo: GeoTargeting = {};
  if (cities.length) geo.cities = cities;
  if (regions.length) geo.regions = regions;
  if (countries.length) geo.countries = countries;
  return geo;
}

/** True when a targeting spec has at least one place. */
export function hasGeo(geo: GeoTargeting | undefined): boolean {
  return !!(geo?.cities?.length || geo?.regions?.length || geo?.countries?.length);
}

/**
 * Meta Marketing API wrapper (Graph, version in graph-version.ts). Creates Advantage+ lead campaigns in
 * PAUSED state (no spend until activated) and reads insights. Validated against
 * a live ad account.
 */
export class MetaClient {
  private pageAccessToken: Promise<string> | null = null;

  constructor(private readonly creds: MetaCredentials, private readonly executionSignal?: AbortSignal) {}

  private async graph<T>(
    path: string,
    opts: {
      method?: string;
      token?: string;
      form?: Record<string, string>;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const method = opts.method ?? "GET";
    try {
      return await this.graphOnce<T>(path, method, opts);
    } catch (error) {
      // #1199: a read is safe to repeat, so one failed GET (network, 5xx) gets one more try. Writes never repeat
      // (they may have been done), nor does a call the caller or the route's budget stopped. A timeout already
      // spent 15 s, so it repeats only under a job deadline (the launch worker); a 60 s route without one could be
      // killed mid-write (Reviewer on #1204).
      const stopped = Boolean(opts.signal?.aborted || this.executionSignal?.aborted);
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      if (method !== "GET" || stopped || !transientReadFailure(error) || (timedOut && !this.executionSignal)) throw error;
      await new Promise((resolve) => setTimeout(resolve, GET_RETRY_DELAY_MS));
      return this.graphOnce<T>(path, method, opts);
    }
  }

  private async graphOnce<T>(
    path: string,
    method: string,
    opts: { token?: string; form?: Record<string, string>; signal?: AbortSignal },
  ): Promise<T> {
    const token = opts.token ?? this.creds.accessToken;
    const signal = AbortSignal.any([
      AbortSignal.timeout(15_000),
      ...(opts.signal ? [opts.signal] : []),
      ...(this.executionSignal ? [this.executionSignal] : []),
    ]);
    signal.throwIfAborted();

    const started = performance.now();
    let reply: { status: number; body: unknown };
    try {
      reply = await this.send(path, method, token, opts.form, signal);
    } catch (error) {
      this.recordCall(path, method, started, error instanceof MetaError ? error.status : undefined, error);
      throw error;
    }
    this.recordCall(path, method, started, reply.status, null);
    return reply.body as T;
  }

  /** #451 L2: one product event per Graph call; endpoint template, status, Meta code and latency only. */
  private recordCall(path: string, method: string, started: number, status: number | undefined, error: unknown) {
    try {
      const endpoint = graphEndpoint(path);
      recordProductEvent({
        kind: "system", name: "meta.graph", outcome: graphOutcome(error), durationMs: Math.round(performance.now() - started),
        attributes: {
          route: endpoint, method: method as "GET" | "POST" | "DELETE", entityType: graphEntity(endpoint),
          ...(status !== undefined && status >= 100 && status <= 599 ? { status } : {}),
          ...(error ? { errorCode: graphErrorCode(error) } : {}),
        },
      });
    } catch {}
  }

  private async send(path: string, method: string, token: string, form: Record<string, string> | undefined, signal: AbortSignal) {
    let res: Response;
    if (method === "POST") {
      const body = new URLSearchParams({
        ...(form ?? {}),
        access_token: token,
      });
      res = await fetch(`${GRAPH}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal,
      });
    } else {
      const sep = path.includes("?") ? "&" : "?";
      res = await fetch(
        `${GRAPH}/${path}${sep}access_token=${encodeURIComponent(token)}`,
        { method, signal, cache: "no-store" },
      );
    }

    const json = await res.json().catch(() => ({}));
    if (!res.ok || (json as { error?: unknown }).error) {
      const err = (json as { error?: GraphErrorBody }).error;
      throw new MetaError(metaErrorMessage(err, res.status), res.status, err?.code, err?.error_subcode,
        { userTitle: err?.error_user_title, fbtraceId: err?.fbtrace_id, path: graphEndpoint(path) });
    }
    return { status: res.status, body: json as unknown };
  }

  getPageAccessToken(): Promise<string> {
    if (!this.pageAccessToken) {
      this.pageAccessToken = this.graph<{ access_token?: string }>(
        `${this.creds.pageId}?fields=access_token`,
      ).then(data => {
        if (!data.access_token) throw new MetaError("Could not retrieve page access token.");
        return data.access_token;
      }).catch(error => {
        this.pageAccessToken = null;
        throw error;
      });
    }
    return this.pageAccessToken;
  }

  /**
   * The Instagram account that speaks for the Page: its linked business account, else the
   * Page-backed one. Placement creatives must name it, or Meta refuses the ad (#333).
   */
  async getPageInstagramId(): Promise<string | null> {
    const token = await this.getPageAccessToken();
    const page = await this.graph<{ instagram_business_account?: { id?: string }; page_backed_instagram_accounts?: { data?: { id?: string }[] } }>(
      `${this.creds.pageId}?fields=instagram_business_account,page_backed_instagram_accounts`,
      { token },
    );
    return page.instagram_business_account?.id ?? page.page_backed_instagram_accounts?.data?.[0]?.id ?? null;
  }

  /**
   * The verified WhatsApp number for click-to-WhatsApp ads: the Page's linked number, or a
   * requested number on a WhatsApp Business Account owned by the ad account's own business
   * (Meta accepts those for the Page even when the Page fields are empty, #157) that is also
   * **bound to this AdBrain business** (#253): businesses can share one Meta business, so being
   * on its WABAs alone doesn't make a number theirs. A request may name the number by its mask
   * ("+91 ••••• 4842", #235); it must match exactly one of those.
   */
  async getWhatsAppNumber(requested: string | null | undefined, bound: readonly string[] = []): Promise<string | null> {
    if (requested && maskedWhatsAppNumberPattern.test(requested)) {
      // #366: the Page and the business lookups are independent; together they save ~1 s of Prepare.
      const [pageNumber, businessNumbers] = await Promise.all([this.pageWhatsAppNumber(), this.boundBusinessNumbers(bound)]);
      const matches = [...new Set([...(pageNumber ? [pageNumber] : []), ...businessNumbers])]
        .filter((number) => maskWhatsAppNumber(number) === requested);
      return matches.length === 1 ? matches[0] : null;
    }
    const pageNumber = await this.pageWhatsAppNumber();
    const wanted = requested ? normalizeWhatsAppNumber(requested) : null;
    if (!wanted || wanted === pageNumber) return pageNumber;
    return (await this.boundBusinessNumbers(bound)).includes(wanted) ? wanted : null;
  }

  /** The ad account business's WhatsApp numbers that are bound to this AdBrain business (#253). */
  private async boundBusinessNumbers(bound: readonly string[]): Promise<string[]> {
    const mine = new Set(bound.map((number) => normalizeWhatsAppNumber(number)).filter((number): number is string => number !== null));
    if (mine.size === 0) return [];
    return (await this.businessWhatsAppNumbers()).filter((number) => mine.has(number));
  }

  /** WhatsApp numbers usable for this Page's ads: the Page's own, and those on the ad account business's WABAs (#235). */
  /**
   * #1016: the read-only reads behind Settings' setup checklist: the ad account's portfolio, currency,
   * status and payment method; whether this login lists the Page; whether ads have a WhatsApp number.
   */
  async setupReads(): Promise<SetupReads> {
    const [account, pages, whatsapp] = await Promise.all([
      this.graph<{ account_status?: number; currency?: string; business?: { id?: string; name?: string }; funding_source_details?: { id?: string } | null }>(
        `${this.creds.adAccountId}?fields=account_status,currency,business{id,name},funding_source_details`,
      ),
      this.graph<{ data?: { id?: string }[] }>("me/accounts?fields=id&limit=200"),
      this.whatsappNumbers(),
    ]);
    return {
      portfolio: account.business?.id ? { id: account.business.id, name: account.business.name ?? null } : null,
      accountActive: account.account_status === 1,
      currency: account.currency ?? null,
      paymentMethod: Boolean(account.funding_source_details?.id),
      pageListed: Boolean(pages.data?.some((page) => page.id === this.creds.pageId)),
      whatsapp: Boolean(whatsapp.page || whatsapp.business.length),
    };
  }

  async whatsappNumbers(): Promise<{ page: string | null; business: string[] }> {
    const [page, business] = await Promise.all([this.pageWhatsAppNumber(), this.businessWhatsAppNumbers()]);
    return { page, business: business.filter((number) => number !== page) };
  }

  private async pageWhatsAppNumber(): Promise<string | null> {
    const token = await this.getPageAccessToken();
    const page = await this.graph<{ id?: string; has_whatsapp_business_number?: boolean; whatsapp_number?: string }>(
      `${this.creds.pageId}?fields=id,has_whatsapp_business_number,whatsapp_number`,
      { token },
    );
    return page.id === this.creds.pageId && page.has_whatsapp_business_number === true && typeof page.whatsapp_number === "string"
      ? normalizeWhatsAppNumber(page.whatsapp_number) : null;
  }

  private async businessWhatsAppNumbers(): Promise<string[]> {
    const account = await this.graph<{ id?: string; business?: { id?: string } }>(`${this.creds.adAccountId}?fields=id,business{id}`);
    const businessId = account.business?.id;
    if (!businessId || !/^\d+$/.test(businessId)) return [];
    const wabas = await this.graph<{ data?: { phone_numbers?: { data?: { display_phone_number?: string }[] } }[]; paging?: { next?: string } }>(
      `${businessId}/owned_whatsapp_business_accounts?fields=phone_numbers{display_phone_number}&limit=100`,
    ).catch((error: unknown) => {
      // #615: a token without WhatsApp access on this business gets 403 code 200 (or 10); that means
      // "no business numbers we can use", not a failed Meta read. Every other error still throws.
      if (error instanceof MetaError && error.status === 403 && (error.code === 200 || error.code === 10)) return { data: [] };
      throw error;
    });
    return [...new Set((wabas.data ?? []).flatMap((waba) => waba.phone_numbers?.data ?? [])
      .map((phone) => normalizeWhatsAppNumber(phone.display_phone_number ?? ""))
      .filter((number): number is string => number !== null))];
  }

  /** Active instant lead forms on the page. */
  async listLeadForms(): Promise<LeadForm[]> {
    const forms = await collectLeadPages(after => this.listLeadFormsPage({ after }));
    return forms.filter(form => form.status === "ACTIVE");
  }

  /** One active lead form on the connected Page, or null if it is archived, elsewhere or unreadable. */
  async readActiveLeadForm(formId: string): Promise<LeadForm | null> {
    if (!/^\d+$/.test(formId)) return null;
    const pageToken = await this.getPageAccessToken();
    let form: { id?: string; name?: string; status?: string; page?: { id?: string } };
    try {
      form = await this.graph(`${formId}?fields=id,name,status,page`, { token: pageToken });
    } catch (error) {
      if (error instanceof MetaError && error.code === 100) return null;
      throw error;
    }
    return form.id === formId && form.page?.id === this.creds.pageId && form.status === "ACTIVE"
      ? { id: form.id, name: form.name ?? "", status: form.status } : null;
  }

  async listLeadFormsPage(opts: { after?: string | null } = {}): Promise<MetaLeadPage<LeadForm>> {
    const pageToken = await this.getPageAccessToken();
    const params = new URLSearchParams({ fields: "id,name,status", limit: "200" });
    if (opts.after) params.set("after", opts.after);
    const data = await this.graph<unknown>(
      `${encodeURIComponent(this.creds.pageId)}/leadgen_forms?${params}`,
      { token: pageToken },
    );
    return parseLeadPage(data, formPageSchema, opts.after);
  }

  /** Instant-form leads for a given lead form (newest first). */
  async listLeadsForForm(
    formId: string,
    opts: { limit?: number } = {},
  ): Promise<MetaLead[]> {
    return collectLeadPages(after => this.listLeadsForFormPage(formId, { ...opts, after }));
  }

  async listLeadsForFormPage(formId: string, opts: { limit?: number; after?: string | null } = {}): Promise<MetaLeadPage<MetaLead>> {
    const pageToken = await this.getPageAccessToken();
    const params = new URLSearchParams({ fields: "id,created_time,field_data,campaign_id", limit: String(Math.min(200, Math.max(1, opts.limit ?? 200))) });
    if (opts.after) params.set("after", opts.after);
    const data = await this.graph<unknown>(
      `${encodeURIComponent(formId)}/leads?${params}`,
      { token: pageToken },
    );
    return parseLeadPage(data, leadPageSchema, opts.after);
  }

  /** Search Meta's location database for a place name. */
  async searchGeoLocations(
    query: string,
    opts: { types?: string[]; limit?: number; signal?: AbortSignal } = {},
  ): Promise<GeoSearchResult[]> {
    const types = opts.types ?? ["city", "region", "country"];
    const params = new URLSearchParams({
      type: "adgeolocation",
      q: query,
      location_types: JSON.stringify(types),
      limit: String(opts.limit ?? 10),
    });
    const data = await this.graph<{ data: GeoSearchResult[] }>(
      `search?${params.toString()}`,
      { signal: opts.signal },
    );
    return data.data ?? [];
  }

  /**
   * #741: the out-of-area exclusions for an ad set's included places. Reads each place's region and
   * country from Meta by key; null for a country-wide or non-Indian area. Refuses (rather than
   * launching without exclusions) when Meta can't describe an Indian place.
   */
  async serviceAreaExclusionsFor(location: GeoTargeting | undefined): Promise<GeoTargeting | null> {
    if (!location || location.countries?.length) return null;
    const cities = location.cities ?? [];
    const regions = location.regions ?? [];
    if (!cities.length && !regions.length) return null;
    const params = new URLSearchParams({ type: "adgeolocationmeta", locale: "en_US" });
    if (cities.length) params.set("cities", JSON.stringify(cities.map((city) => city.key)));
    if (regions.length) params.set("regions", JSON.stringify(regions.map((region) => region.key)));
    type Meta = { key: string; region_id?: number | string; country_code?: string };
    const data = await this.graph<{ data?: { cities?: Record<string, Meta>; regions?: Record<string, Meta> } }>(`search?${params}`)
      .catch(() => { throw new TargetingExclusionsMissingError("Meta couldn't confirm the service area's states, so the out-of-area exclusions can't be set. Try again."); });
    const radiusKm = (city: NonNullable<GeoTargeting["cities"]>[number]) =>
      city.radius === undefined ? 0 : city.distance_unit === "mile" ? city.radius * 1.609 : city.radius;
    const places: IncludedPlace[] = [
      ...cities.map((city): IncludedPlace => {
        const meta = data.data?.cities?.[city.key];
        return { key: city.key, type: "city", regionKey: meta?.region_id === undefined ? null : String(meta.region_id), countryCode: meta?.country_code ?? null, radiusKm: radiusKm(city) };
      }),
      ...regions.map((region): IncludedPlace => {
        const meta = data.data?.regions?.[region.key];
        return { key: region.key, type: "region", regionKey: region.key, countryCode: meta?.country_code ?? null };
      }),
    ];
    const exclusions = serviceAreaExclusions(places);
    if (!exclusions && places.some((place) => place.countryCode === "IN")) throw new TargetingExclusionsMissingError();
    return exclusions;
  }

  /**
   * Resolve human place names (e.g. "Jaipur", "Rajasthan") into a Meta geo
   * targeting spec. Cities get a search radius; regions/countries are exact.
   * Names that don't resolve are reported in `unresolved` and skipped.
   */
  async resolveGeoTargeting(
    names: string[],
    opts: { radiusKm?: number; preferCountry?: string; cityScope?: "city_only" | "radius" } = {},
  ): Promise<ResolvedGeo> {
    const radius = clampRadiusKm(opts.radiusKm ?? 25);
    const preferCountry = opts.preferCountry ?? "";
    const cities: NonNullable<GeoTargeting["cities"]> = [];
    const regions: NonNullable<GeoTargeting["regions"]> = [];
    const countries: string[] = [];
    const matched: MatchedGeo[] = [];
    const unresolved: string[] = [];
    const seen = new Set<string>();
    // #271: independent searches run together; results are applied in the given order.
    const searches = await Promise.all(names.map(async raw => {
      const name = (raw ?? "").trim();
      if (!name) return null;
      return { name, results: await this.searchGeoLocations(name).catch(() => null) };
    }));

    for (const search of searches) {
      if (!search) continue;
      const { name, results } = search;
      if (!results) {
        unresolved.push(name);
        continue;
      }
      const best = pickBestGeoMatch(results, name, preferCountry);
      if (!best) {
        unresolved.push(name);
        continue;
      }
      const dedupe = `${best.type}:${best.key}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      if (best.type === "city") {
        cities.push({ key: best.key, ...(opts.cityScope === "city_only" ? {} : { radius, distance_unit: "kilometer" }) });
      } else if (best.type === "region") {
        regions.push({ key: best.key });
      } else if (best.type === "country" && best.country_code) {
        countries.push(best.country_code);
      } else {
        unresolved.push(name);
        continue;
      }
      matched.push({
        name,
        type: best.type,
        key: best.key,
        label: geoLabel(best),
      });
    }

    const targeting: GeoTargeting = {};
    if (cities.length) targeting.cities = cities;
    if (regions.length) targeting.regions = regions;
    if (countries.length) targeting.countries = countries;
    return { targeting, matched, unresolved };
  }

  /** Upload an image to the ad account and return its hash. */
  async uploadAdImage(imageUrl: string): Promise<string> {
    let parsed: URL;
    try {
      parsed = new URL(imageUrl);
    } catch {
      throw new MetaError("Creative image URL is invalid.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new MetaError("Creative image URL must use HTTP or HTTPS.");
    }
    let imgRes: Response;
    try {
      imgRes = await fetchPublicUrl(parsed.toString(), { timeoutMs: 30_000, signal: this.executionSignal });
    } catch {
      throw new MetaError("Could not fetch the creative image.");
    }
    if (!imgRes.ok) {
      throw new MetaError(`Could not fetch creative image (${imgRes.status}).`);
    }
    return this.uploadAdImageBytes(await readBoundedResponse(imgRes));
  }

  async uploadAdImageBytes(bytes: Uint8Array): Promise<string> {
    const b64 = Buffer.from(bytes).toString("base64");
    const data = await this.graph<{ images: Record<string, { hash: string }> }>(
      `${this.creds.adAccountId}/adimages`,
      { method: "POST", form: { bytes: b64 } },
    );
    const first = Object.values(data.images ?? {})[0];
    if (!first?.hash) throw new MetaError("Image upload returned no hash.");
    return first.hash;
  }

  /**
   * Create a PAUSED Advantage+ lead campaign: campaign → ad set → (creative →
   * ad) per creative. Nothing spends until you set it ACTIVE in Meta.
   */
  async resolveAudienceInterests(names: string[]): Promise<{ interests: AudienceInterest[]; unresolved: string[] }> {
    const interests: AudienceInterest[] = [];
    const unresolved: string[] = [];
    if (names.length > 5) throw new MetaError("Choose at most five audience interests.");
    const matches = await Promise.all([...new Set(names)].map(async (name) => {
      const params = new URLSearchParams({ type: "adinterest", q: name, limit: "25", locale: "en_US" });
      const response = await this.graph<{ data?: AudienceInterest[] }>(`search?${params}`);
      const match = response.data?.find((candidate) =>
        typeof candidate.id === "string" && /^\d+$/.test(candidate.id) &&
        typeof candidate.name === "string" && candidate.name.trim().toLowerCase() === name.trim().toLowerCase(),
      );
      return { name, match };
    }));
    const ids = [...new Set(matches.flatMap(({ match }) => match ? [match.id] : []))];
    const statuses = ids.length ? await this.graph<{ data?: { id: string; current_status: string }[] }>(`search?${new URLSearchParams({ type: "targetingoptionstatus", targeting_option_list: JSON.stringify(ids) })}`) : { data: [] };
    for (const { name, match } of matches) {
      if (!match || !statuses.data?.some((status) => String(status.id) === match.id && status.current_status === "NORMAL")) unresolved.push(name);
      else if (!interests.some((interest) => interest.id === match.id)) interests.push({ id: match.id, name: match.name });
    }
    return { interests, unresolved };
  }

  async createLeadCampaign(params: {
    name: string;
    dailyBudgetRupees: number;
    leadFormId?: string;
    link: string;
    creatives: CreativeInput[];
    ageMin?: number;
    ageMax?: number;
    interests?: AudienceInterest[];
    gender?: "all" | "men" | "women";
    location?: GeoTargeting;
    excludedLocation?: GeoTargeting;
    destination?: AdDestination;
    whatsappNumber?: string;
    /** Numbers bound to this AdBrain business (#253); a non-Page number must be one of them. */
    boundWhatsAppNumbers?: readonly string[];
    whatsappGreeting?: WhatsAppOpening;
    phone?: string;
    variants?: AdSetVariant[];
    onCheckpoint?: (checkpoint: CampaignMutationCheckpoint) => void | Promise<void>;
    /** A 9:16 couldn't be used and the ad fell back to the single 4:5 image (#333). */
    onStoryFallback?: (stage: "instagram" | "upload" | "creative" | "ad", errorCode: string) => void;
    /** #419: the ad set forms sent and, per ad, the creative form it runs on, for the plan check. */
    onPlanned?: (plan: { adSets: Record<string, string>[]; creatives: Record<string, string>[] }) => void;
  }): Promise<CreateCampaignResult> {
    const locations = params.variants?.length
      ? params.variants.map((variant) => variant.location ?? params.location)
      : [params.location];
    if (locations.some((location) => !hasGeo(location))) {
      throw new MetaError("Choose a resolved campaign location before creating ads.");
    }
    const excludedLocations = params.variants?.length
      ? params.variants.map((variant) => variant.excludedLocation ?? params.excludedLocation)
      : [params.excludedLocation];
    if ([...locations, ...excludedLocations].some((location) => location?.cities?.some((city) =>
      city.radius !== undefined && (!Number.isFinite(city.radius) || city.radius < (city.distance_unit === "mile" ? 10 : 17) || city.radius > (city.distance_unit === "mile" ? 50 : 80)),
    ))) throw new MetaError("Meta city targeting requires a radius of 17-80 km (10-50 miles). Review the location radius.");
    const ageRanges = params.variants?.length ? params.variants : [params];
    if (ageRanges.some((range) => {
      const min = range.ageMin ?? params.ageMin;
      const max = range.ageMax ?? params.ageMax;
      return min === undefined || max === undefined || !Number.isInteger(min) || !Number.isInteger(max) || min < 18 || max > 65 || min > max;
    })) throw new MetaError("Review an explicit age range between 18 and 65+ before creating ads.");
    if ((params.interests?.length ?? 0) > 5 || params.interests?.some((interest) => !/^\d+$/.test(interest.id))) {
      throw new MetaError("Review valid Meta audience interests before creating ads.");
    }
    const acct = this.creds.adAccountId;
    if (params.gender !== undefined && !["all", "men", "women"].includes(params.gender)) {
      throw new MetaError("Choose a supported gender demographic before creating ads.");
    }
    const requested = params.destination ?? "instant_form";
    if (requested === "instant_form" && !params.leadFormId) throw new MetaError("Choose an active lead form before creating ads.");
    if (requested === "whatsapp") {
      if (!params.whatsappNumber || !/^\+[1-9]\d{6,14}$/.test(params.whatsappNumber)) throw new MetaError("Review the Page-linked WhatsApp Business number before creating ads.");
      if (await this.getWhatsAppNumber(params.whatsappNumber, params.boundWhatsAppNumbers ?? []) !== params.whatsappNumber) throw new MetaError("The Page-linked WhatsApp number changed. Review the campaign again.");
    }

    // Call ads need a phone number — fetch the page's if none was passed.
    let phone = params.phone;
    if (requested === "call" && !phone) {
      try {
        const p = await this.graph<{ phone?: string }>(
          `${this.creds.pageId}?fields=phone`,
        );
        phone = p.phone;
      } catch {
        // Ignore — fallback logic handles a missing phone.
      }
    }

    // #741: work out every ad set's out-of-area exclusions before anything is created.
    const areaExclusions = new Map<GeoTargeting | undefined, GeoTargeting | null>();
    for (const location of new Set([params.location, ...(params.variants ?? []).map((variant) => variant.location ?? params.location)])) {
      areaExclusions.set(location, await this.serviceAreaExclusionsFor(location));
    }

    const campaign = await this.graph<{ id: string }>(`${acct}/campaigns`, {
      method: "POST",
      form: {
        name: params.name,
        objective: requested === "whatsapp" ? "OUTCOME_ENGAGEMENT" : "OUTCOME_LEADS",
        status: "PAUSED",
        special_ad_categories: "[]",
        is_adset_budget_sharing_enabled: "false",
      },
    });
    await params.onCheckpoint?.({ phase: "campaign", externalId: campaign.id });
    // #735: a failure before the first ad set would leave an empty PAUSED campaign sync can't import.
    // Delete it; if Meta confirms, nothing is left. If the delete fails, the original error stands
    // and the operation is reconciled as before.
    const rollBack = async (error: unknown): Promise<never> => {
      try {
        await this.graph(encodeURIComponent(campaign.id), { method: "DELETE" });
      } catch {
        throw error;
      }
      throw new MetaCreateRolledBackError(campaign.id, error);
    };

    // Upload each creative image once and reuse the hash across all ad sets.
    const prepared: { input: CreativeInput; imageHash: string; storyHash: string | null }[] = [];
    // Placement creatives must name the Page's Instagram account; without one, skip the 9:16 (#333).
    let instagramUserId: string | null = null;
    try {
      if (hasPlacementCreative(requested) && params.creatives.some((creative) => creative.storyImage)) {
        instagramUserId = await this.getPageInstagramId().catch((error: unknown) => {
          params.onStoryFallback?.("instagram", metaErrorCode(error));
          return null;
        });
        if (!instagramUserId) params.onStoryFallback?.("instagram", "none");
      }
      for (let creativeIndex = 0; creativeIndex < params.creatives.length; creativeIndex++) {
        const c = params.creatives[creativeIndex];
        const imageHash = await this.uploadAdImage(c.imageUrl);
        await params.onCheckpoint?.({
          phase: "creative",
          externalId: imageHash,
          creativeIndex,
        });
        // Placement images are proven for WhatsApp and lead-form ads that name the Page's Instagram (story-validate.json, leadform-placements-validate.json).
        let storyHash: string | null = null;
        const storyImage = instagramUserId ? await c.storyImage : null;
        if (storyImage) {
          storyHash = await this.uploadAdImageBytes(storyImage).catch((error: unknown) => {
            params.onStoryFallback?.("upload", metaErrorCode(error));
            return null;
          });
        }
        prepared.push({
          input: c,
          imageHash,
          storyHash,
        });
      }
    } catch (error) {
      await rollBack(error);
    }

    // One ad set per variant; the default is a single ad set from the params.
    const variants: AdSetVariant[] = params.variants?.length
      ? params.variants
      : [
          {
            ageMin: params.ageMin,
            ageMax: params.ageMax,
            location: params.location,
            excludedLocation: params.excludedLocation,
          },
        ];

    // Ages are validated above, so both bounds are set here.
    const targetingFor = (v: AdSetVariant, dest: AdDestination) => JSON.stringify((hasPlacementCreative(dest) ? withoutAudienceNetwork : (t: Record<string, unknown>) => t)(adSetTargeting({
      location: v.location ?? params.location,
      excludedLocation: mergeExclusions(v.excludedLocation ?? params.excludedLocation, areaExclusions.get(v.location ?? params.location) ?? null),
      ageMin: (v.ageMin ?? params.ageMin)!,
      ageMax: (v.ageMax ?? params.ageMax)!,
      gender: params.gender,
      interests: params.interests,
    })));

    const plannedAdSets: Record<string, string>[] = [];
    const plannedCreatives: Record<string, string>[] = [];
    const creativeForms = new Map<string, Record<string, string>>();
    const makeAdSet = async (dest: AdDestination, v: AdSetVariant, i: number) => {
      const dp = destinationPlan(dest);
      const suffix =
        v.label ?? (variants.length > 1 ? `Ad set ${i + 1}` : "Ad set");
      const form = {
        name: `${params.name} — ${suffix}`,
        campaign_id: campaign.id,
        status: "PAUSED",
        daily_budget: String(Math.round(params.dailyBudgetRupees * 100)),
        billing_event: "IMPRESSIONS",
        optimization_goal: dp.optimizationGoal,
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        destination_type: dp.destinationType,
        promoted_object: JSON.stringify({ page_id: this.creds.pageId, ...(dest === "whatsapp" ? { whatsapp_phone_number: params.whatsappNumber } : {}) }),
        targeting: targetingFor(v, dest),
      };
      const created = await this.graph<{ id: string }>(`${acct}/adsets`, { method: "POST", form });
      plannedAdSets.push(form);
      return created;
    };

    const destination = requested;
    const adSetIds: string[] = [];
    const adIds: string[] = [];
    const creativeIds: string[] = [];

    for (let i = 0; i < variants.length; i++) {
      let adSet: { id: string };
      if (i === 0) {
        try {
          adSet = await makeAdSet(requested, variants[i], i);
        } catch (err) {
          if (requested === "instant_form") return rollBack(err);
          return rollBack(new MetaError(
            requested === "whatsapp"
              ? "WhatsApp is not available for this Meta Page. Connect WhatsApp or choose an instant lead form."
              : "Call ads are not available for this Meta Page. Add a phone number or choose an instant lead form.",
            err instanceof MetaError ? err.status : undefined,
          ));
        }
      } else {
        adSet = await makeAdSet(destination, variants[i], i);
      }
      adSetIds.push(adSet.id);
      await params.onCheckpoint?.({ phase: "adset", externalId: adSet.id, variantIndex: i });

      for (let creativeIndex = 0; creativeIndex < prepared.length; creativeIndex++) {
        const { input: c, imageHash, storyHash } = prepared[creativeIndex];
        const placement = storyHash && instagramUserId && hasPlacementCreative(destination)
          ? placementCreativeSpec({
            pageId: this.creds.pageId, instagramUserId, feedHash: imageHash, storyHash, headline: c.headline, message: c.message,
            description: c.description ?? undefined, link: destination === "whatsapp" ? `https://wa.me/${params.whatsappNumber!.slice(1)}` : params.link,
            destination, whatsappNumber: params.whatsappNumber, whatsappGreeting: params.whatsappGreeting, leadFormId: params.leadFormId,
          })
          : null;
        const singleImageForm = {
          name: c.headline.slice(0, 90) || "AdBrain creative",
          object_story_spec: JSON.stringify({
            page_id: this.creds.pageId,
            link_data: {
              image_hash: imageHash,
              message: c.message,
              name: c.headline,
              ...(c.description?.trim() ? { description: c.description.trim() } : {}),
              link: destination === "whatsapp" ? `https://wa.me/${params.whatsappNumber!.slice(1)}` : params.link,
              ...(destination === "whatsapp" && params.whatsappGreeting
                ? { page_welcome_message: whatsappWelcomeMessage(params.whatsappGreeting) }
                : {}),
              call_to_action: destinationCTA(destination, {
                leadFormId: params.leadFormId,
                phone: destination === "whatsapp" ? params.whatsappNumber : phone,
                ctaLabel: c.cta,
              }),
            },
          }),
        };
        const postCreative = async (form: Record<string, string>) => {
          const created = await this.graph<{ id: string }>(`${acct}/adcreatives`, { method: "POST", form });
          creativeForms.set(created.id, form);
          return created;
        };
        // A placement creative Meta refuses must not fail the campaign: fall back to the single image.
        const creative = placement
          ? await postCreative({
            name: singleImageForm.name,
            object_story_spec: JSON.stringify(placement.object_story_spec),
            asset_feed_spec: JSON.stringify(placement.asset_feed_spec),
          }).catch((error: unknown) => {
            params.onStoryFallback?.("creative", metaErrorCode(error));
            return postCreative(singleImageForm);
          })
          : await postCreative(singleImageForm);
        await params.onCheckpoint?.({
          phase: "creative",
          externalId: creative.id,
          variantIndex: i,
          creativeIndex,
        });

        const postAd = async (creativeId: string) => {
          const created = await this.graph<{ id: string }>(`${acct}/ads`, {
            method: "POST",
            form: {
              name: c.headline.slice(0, 90) || "AdBrain ad",
              adset_id: adSet.id,
              status: "PAUSED",
              creative: JSON.stringify({ creative_id: creativeId }),
            },
          });
          const runsOn = creativeForms.get(creativeId);
          if (runsOn) plannedCreatives.push(runsOn);
          creativeIds.push(creativeId);
          return created;
        };
        // If Meta still refuses the ad on a placement creative, make it with the single image instead.
        const ad = placement
          ? await postAd(creative.id).catch(async (error: unknown) => {
            if (!isMetaRefusal(error)) throw error;
            params.onStoryFallback?.("ad", metaErrorCode(error));
            const single = await postCreative(singleImageForm);
            await params.onCheckpoint?.({ phase: "creative", externalId: single.id, variantIndex: i, creativeIndex });
            return postAd(single.id);
          })
          : await postAd(creative.id);
        adIds.push(ad.id);
        await params.onCheckpoint?.({
          phase: "ad",
          externalId: ad.id,
          variantIndex: i,
          creativeIndex,
        });
      }
    }

    // An observer only: a failing plan check never fails the launch.
    try { params.onPlanned?.({ adSets: plannedAdSets, creatives: plannedCreatives }); } catch { /* ignored */ }
    return {
      campaignId: campaign.id,
      adSetId: adSetIds[0],
      adSetIds,
      adIds,
      destination,
      creativeIds,
    };
  }

  /**
   * #775: put edited words on a launched ad. A new creative is made from the current one (Meta
   * keeps the old creative, so the change can be rolled back by swapping it back), then the ad is
   * pointed at it. Each step is validated by Meta first; the ad goes back to Meta review.
   */
  async replaceAdCreative(adId: string, edit: AdCopyEdit, hooks: {
    /** Runs after Meta validated the new creative, right before the first real write. */
    beforeWrite?: (stored: { previousCreativeId: string }) => Promise<void>;
    /** The new creative exists on Meta (so a failed swap can be reconciled). */
    onCreative?: (creativeId: string) => Promise<void>;
  } = {}): Promise<{ adId: string; previousCreativeId: string; creativeId: string }> {
    const acct = this.creds.adAccountId;
    const ad = await this.graph<{ id: string; account_id?: string; creative?: StoredCreative & { id?: string } }>(
      `${encodeURIComponent(adId)}?fields=id,account_id,creative{id,name,object_story_spec,asset_feed_spec}`,
    );
    if (ad.account_id !== acct.replace(/^act_/, "") || !ad.creative?.id) throw new MetaError("This ad isn't in the connected ad account.");
    const form = editedCreativeForm(ad.creative, edit);
    const validate = JSON.stringify(["validate_only"]);
    await this.graph(`${acct}/adcreatives`, { method: "POST", form: { ...form, execution_options: validate } });
    await hooks.beforeWrite?.({ previousCreativeId: ad.creative.id });
    const created = await this.graph<{ id: string }>(`${acct}/adcreatives`, { method: "POST", form });
    await hooks.onCreative?.(created.id);
    const swap = { creative: JSON.stringify({ creative_id: created.id }) };
    await this.graph(encodeURIComponent(adId), { method: "POST", form: { ...swap, execution_options: validate } });
    await this.graph(encodeURIComponent(adId), { method: "POST", form: swap });
    const after = await this.graph<{ creative?: { id?: string } }>(`${encodeURIComponent(adId)}?fields=creative{id}`);
    if (after.creative?.id !== created.id) throw new MetaError("Meta didn't confirm the new ad text. Refresh and check the ad before trying again.");
    return { adId, previousCreativeId: ad.creative.id, creativeId: created.id };
  }

  async listCampaigns(limit = 200): Promise<MetaCampaignSummary[]> {
    const data = await this.graph<{ data: MetaCampaignSummary[] }>(
      `${this.creds.adAccountId}/campaigns?fields=id,name,status,objective,daily_budget,effective_status,created_time&limit=${limit}`,
    );
    return data.data ?? [];
  }

  async listCampaignsPage(after?: string) {
    const query = new URLSearchParams({ fields: "id,name,status,objective,daily_budget,lifetime_budget,account_id", limit: "20" });
    if (after) query.set("after", after);
    const result = await this.graph<{ data?: Array<MetaCampaignSummary & { account_id: string; lifetime_budget?: string }>; paging?: { next?: string; cursors?: { after?: string } } }>(`${this.creds.adAccountId}/campaigns?${query}`);
    if (!Array.isArray(result.data) || (result.paging?.next && !result.paging.cursors?.after)) throw new MetaError("Campaign listing is incomplete.");
    return { campaigns: result.data, nextCursor: result.paging?.next ? result.paging.cursors!.after! : null };
  }

  /** The campaign's daily-budget binding to this account and Page, or why sync must leave it unchanged (#671). */
  async readBoundCampaign(campaign: MetaCampaignSummary & { account_id: string; lifetime_budget?: string }, cappedAdSetIds: readonly string[] = []): Promise<{ dailyBudgetRupees: number; adSetId: string; destination: CampaignDestination } | { skip: CampaignSkipReason }> {
    if (campaign.account_id !== this.creds.adAccountId.replace(/^act_/, "")) return { skip: "other_account" };
    if (!["ACTIVE", "PAUSED"].includes(campaign.status)) return { skip: "not_running" };
    if (Number(campaign.lifetime_budget ?? 0) !== 0) return { skip: "lifetime_budget" };
    const response = await this.graph<{ data?: Array<{ id: string; status: string; destination_type?: string; daily_budget?: string; lifetime_budget?: string; promoted_object?: { page_id?: string } }>; paging?: { next?: string } }>(
      `${campaign.id}/adsets?fields=id,status,daily_budget,lifetime_budget,promoted_object,destination_type&limit=100`,
    );
    if (!response.data?.length || response.paging?.next) return { skip: "unsupported" };
    const daily = response.data.filter(adSet => !cappedAdSetIds.includes(adSet.id));
    if (!daily.length) return { skip: "capped" };
    let adSetBudget = 0;
    for (const adSet of response.data) {
      if (adSet.promoted_object?.page_id !== this.creds.pageId) return { skip: "other_page" };
      if (!["ACTIVE", "PAUSED"].includes(adSet.status)
        || !/^\d+$/.test(adSet.daily_budget ?? "0") || !/^\d+$/.test(adSet.lifetime_budget ?? "0")) return { skip: "unsupported" };
      const capped = cappedAdSetIds.includes(adSet.id);
      if (capped ? Number(adSet.daily_budget ?? 0) !== 0 || Number(adSet.lifetime_budget ?? 0) <= 0 : Number(adSet.lifetime_budget ?? 0) !== 0) {
        return { skip: capped ? "unsupported" : "lifetime_budget" };
      }
      if (!capped) adSetBudget += Number(adSet.daily_budget ?? 0);
    }
    if (!/^\d+$/.test(campaign.daily_budget ?? "0")) return { skip: "unsupported" };
    const campaignBudget = Number(campaign.daily_budget ?? 0);
    const total = campaignBudget > 0 && adSetBudget === 0 ? campaignBudget : campaignBudget === 0 ? adSetBudget : Number.NaN;
    if (!Number.isSafeInteger(total) || total <= 0) return { skip: "unsupported" };
    return { dailyBudgetRupees: total / 100, adSetId: daily[0].id, destination: destinationFromAdSets(daily) };
  }

  private async verifyCampaignBinding(campaignId: string): Promise<CampaignDestination> {
    const node = encodeURIComponent(campaignId);
    const campaign = await this.graph<{ id?: string; account_id?: string }>(`${node}?fields=id,account_id`);
    if (campaign.id !== campaignId || campaign.account_id !== this.creds.adAccountId.replace(/^act_/, "")) {
      throw new MetaError("Campaign does not match the connected ad account.");
    }
    const adSets = await this.graph<{ data?: Array<{ destination_type?: string; promoted_object?: { page_id?: string } }>; paging?: { next?: string } }>(
      `${node}/adsets?fields=promoted_object,destination_type&limit=100`,
    );
    if (Array.isArray(adSets.data) && !adSets.data.length && !adSets.paging?.next) {
      // #721: a campaign deleted in Meta still answers, but lists no ad sets; its own status says why.
      // Best effort: if Meta can't say, the binding error below still blocks the read or write.
      const state = await this.graph<{ status?: string; effective_status?: string }>(`${node}?fields=id,account_id,name,status,effective_status,configured_status`).catch(() => ({} as { status?: string; effective_status?: string }));
      const gone = [state.effective_status, state.status].find((value) => value === "DELETED" || value === "ARCHIVED");
      if (gone === "DELETED" || gone === "ARCHIVED") throw new CampaignGoneError(gone);
    }
    if (!Array.isArray(adSets.data) || !adSets.data.length || adSets.paging?.next
      || adSets.data.some(adSet => adSet.promoted_object?.page_id !== this.creds.pageId)) {
      throw new MetaError("Campaign Page binding could not be verified. Review the campaign in Meta.");
    }
    return destinationFromAdSets(adSets.data);
  }

  async getCampaignInsights(campaignId: string, options?: { weekly?: boolean }): Promise<CampaignInsights> {
    const destination = await this.verifyCampaignBinding(campaignId);
    // #404: without a preset Meta reads last_30d, which leaves out today, so a new campaign read ₹0. Results are lifetime.
    const data = await this.graph<unknown>(`${encodeURIComponent(campaignId)}/insights?fields=impressions,clicks,spend,actions,date_start,date_stop&date_preset=${options?.weekly ? "this_week_mon_today" : "maximum"}`);
    return decodeCampaignInsights(data, destination, { requireSpend: options?.weekly });
  }

  /**
   * #783: each ad's lifetime results; ads Meta hasn't delivered are listed with zeros (#789). Read-only.
   * #1022: `day` (YYYY-MM-DD, the ad account's own calendar day) reads that one day instead.
   */
  async getAdResults(campaignId: string, options?: { day?: string }): Promise<AdResult[]> {
    if (options?.day !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(options.day)) throw new MetaError("Invalid results day.");
    const destination = await this.verifyCampaignBinding(campaignId);
    const node = encodeURIComponent(campaignId);
    const period = options?.day ? `time_range=${encodeURIComponent(JSON.stringify({ since: options.day, until: options.day }))}` : "date_preset=maximum";
    const [ads, insights] = await Promise.all([
      // Meta's default listing leaves out ARCHIVED ads (an audience rebuild archives them) and refuses DELETED (1815001).
      this.graph<unknown>(`${node}/ads?fields=id,name,effective_status,creative{id}&limit=100&effective_status=${encodeURIComponent(JSON.stringify(LISTED_AD_STATUSES))}`),
      this.graph<unknown>(`${node}/insights?level=ad&fields=ad_id,impressions,clicks,spend,actions&${period}&limit=100`),
    ]);
    return decodeAdResults(ads, insights, destination);
  }

  /** Read-only lifetime spend (account currency, exact paise) for customer cost evidence (#216). */
  async readLifetimeSpendPaise(campaignId: string): Promise<number> {
    const node = encodeURIComponent(campaignId);
    const campaign = await this.graph<{ id?: string; account_id?: string }>(`${node}?fields=id,account_id`);
    if (campaign.id !== campaignId || campaign.account_id !== this.creds.adAccountId.replace(/^act_/, "")) {
      throw new MetaError("Campaign does not match the connected ad account.");
    }
    return decodeLifetimeSpendPaise(await this.graph<unknown>(`${node}/insights?fields=spend&date_preset=maximum`));
  }

  /** Live ad account funding (#245): Meta's account spending limit and amount spent, both media paise excluding GST. */
  async readAccountFunding(): Promise<AccountFunding> {
    const account = await this.graph<{ id?: string; currency?: string; spend_cap?: string; amount_spent?: string; is_prepay_account?: boolean }>(
      `${encodeURIComponent(this.creds.adAccountId)}?fields=id,spend_cap,amount_spent,is_prepay_account,currency`,
    );
    const paise = /^\d{1,15}$/;
    if (account.id !== this.creds.adAccountId || account.currency !== "INR"
      || !paise.test(account.spend_cap ?? "0") || !paise.test(account.amount_spent ?? "")) {
      throw new MetaError("Meta ad account funding could not be verified.");
    }
    const spendCapPaise = Number(account.spend_cap ?? 0);
    const amountSpentPaise = Number(account.amount_spent);
    return { spendCapPaise, amountSpentPaise, roomPaise: Math.max(0, spendCapPaise - amountSpentPaise), prepay: account.is_prepay_account === true };
  }

  /**
   * #1058: the lifetime budget still to spend on this ad account's running capped runs. Meta's account
   * room counts only what was spent, so each ACTIVE lifetime-budget ad set's `budget_remaining` is already
   * promised. #1094: `exclude` leaves out the ad sets being edited, and daily-budget ad sets are reported
   * (not counted: they have no total). Ad sets Meta is still processing or flags keep their budget, so they
   * count too (QA on #1083). Read-only; an incomplete or unreadable listing fails closed.
   */
  async readLiveCappedRuns(exclude: string[] = []): Promise<{ runs: number; remainingPaise: number; uncapped: { adSets: number; dailyPaise: number } }> {
    const listing = await this.graph<{ data?: Array<{ id?: string; effective_status?: string; lifetime_budget?: string; budget_remaining?: string; daily_budget?: string }>; paging?: { next?: string } }>(
      `${encodeURIComponent(this.creds.adAccountId)}/adsets?fields=id,effective_status,lifetime_budget,budget_remaining,daily_budget&limit=100&effective_status=${encodeURIComponent(JSON.stringify(SPENDING_AD_SET_STATUSES))}`,
    );
    const paise = /^\d{1,15}$/;
    if (!Array.isArray(listing.data) || listing.paging?.next || listing.data.some(adSet => !adSet.id
      || !paise.test(adSet.lifetime_budget ?? "0") || !paise.test(adSet.budget_remaining ?? "0") || !paise.test(adSet.daily_budget ?? "0"))) {
      throw new MetaError("Meta ad account funding could not be verified.");
    }
    const others = listing.data.filter(adSet => !exclude.includes(adSet.id!) && SPENDING_AD_SET_STATUSES.includes(adSet.effective_status ?? ""));
    const capped = others.filter(adSet => Number(adSet.lifetime_budget ?? 0) > 0);
    const daily = others.filter(adSet => Number(adSet.lifetime_budget ?? 0) <= 0 && Number(adSet.daily_budget ?? 0) > 0);
    return {
      runs: capped.length,
      remainingPaise: capped.reduce((sum, adSet) => sum + Number(adSet.budget_remaining ?? 0), 0),
      uncapped: { adSets: daily.length, dailyPaise: daily.reduce((sum, adSet) => sum + Number(adSet.daily_budget ?? 0), 0) },
    };
  }

  /**
   * Sets the ad account's spending limit (#522, managed child accounts) and reads it back. Meta takes
   * the limit in rupees and reports it in paise; 0 would mean no limit, so it is refused, and no
   * `spend_cap_action` (reset or delete) is ever sent. If writing the limit restarted Meta's spent
   * counter, the room read back exceeds `maxRoomPaise` and this fails closed (new spend only shrinks it).
   */
  async setAccountSpendCap(capPaise: number, maxRoomPaise: number): Promise<AccountFunding> {
    if (!Number.isSafeInteger(capPaise) || capPaise <= 0 || !Number.isSafeInteger(maxRoomPaise) || maxRoomPaise < 0) {
      throw new MetaError("Invalid ad account spending limit.");
    }
    const updated = await this.graph<{ success?: boolean }>(encodeURIComponent(this.creds.adAccountId), {
      method: "POST", form: { spend_cap: (capPaise / 100).toFixed(2) },
    });
    if (updated.success !== true) throw new MetaError("Ad account spending limit is unconfirmed. Keep its campaigns paused.");
    const funding = await this.readAccountFunding();
    if (funding.spendCapPaise !== capPaise) throw new MetaError("Ad account spending limit changed. Keep its campaigns paused.");
    if (funding.roomPaise > maxRoomPaise) {
      throw new MetaError("Meta allows more than the customer has left on this ad account. Keep its campaigns paused.");
    }
    return funding;
  }

  /**
   * Read-only: true only when Meta reads the campaign back PAUSED and every ad set and ad as
   * PAUSED, either set directly or inherited from a paused campaign or ad set (#221).
   */
  async readCampaignStopped(campaignId: string): Promise<boolean> {
    type Node = { id: string; status?: string; effective_status?: string };
    const node = encodeURIComponent(campaignId);
    const [campaign, adSets, ads] = await Promise.all([
      this.graph<Node & { account_id?: string }>(`${node}?fields=id,account_id,status,effective_status`),
      this.graph<{ data?: Node[]; paging?: { next?: string } }>(`${node}/adsets?fields=id,status,effective_status&limit=100`),
      this.graph<{ data?: Node[]; paging?: { next?: string } }>(`${node}/ads?fields=id,status,effective_status&limit=100`),
    ]);
    if (campaign.id !== campaignId || campaign.account_id !== this.creds.adAccountId.replace(/^act_/, "")) {
      throw new MetaError("Campaign does not match the connected ad account.");
    }
    if (!Array.isArray(adSets.data) || !Array.isArray(ads.data) || adSets.paging?.next || ads.paging?.next) {
      throw new MetaError("Campaign delivery could not be read completely.");
    }
    const paused = (item: Node) => ["PAUSED", "ARCHIVED", "DELETED"].includes(item.status ?? "")
      || ["CAMPAIGN_PAUSED", "ADSET_PAUSED"].includes(item.effective_status ?? "");
    return campaign.status === "PAUSED" && campaign.effective_status === "PAUSED"
      && adSets.data.every(paused) && ads.data.every(paused);
  }

  async deleteObject(id: string): Promise<void> {
    await this.verifyCampaignBinding(id);
    await this.graph(encodeURIComponent(id), { method: "DELETE" });
  }

  async readCampaignDelivery(
    campaignId: string,
    expected: { dailyBudgetRupees: number; status: string; adSetIds: string[]; adIds: string[]; cappedAdSetIds?: string[] },
  ): Promise<CampaignDeliverySnapshot> {
    const [campaign, adSets, ads] = await Promise.all([
      this.graph<{ id: string; account_id: string; status: string; effective_status?: string; daily_budget?: string; lifetime_budget?: string }>(
        `${campaignId}?fields=id,account_id,status,effective_status,daily_budget,lifetime_budget`,
      ),
      this.graph<{ data?: Array<{ id: string; status: string; effective_status?: string; daily_budget?: string; lifetime_budget?: string; promoted_object?: { page_id?: string }; destination_type?: string; targeting?: unknown }>; paging?: { next?: string } }>(
        `${campaignId}/adsets?fields=id,status,effective_status,daily_budget,lifetime_budget,promoted_object,destination_type,targeting&limit=100`,
      ),
      this.graph<{ data?: Array<{ id: string; status: string; effective_status?: string; adset_id: string; creative?: { id?: string } }>; paging?: { next?: string } }>(
        `${campaignId}/ads?fields=id,status,effective_status,adset_id,creative{id}&limit=100`,
      ),
    ]);
    const minorUnits = (value: string | undefined): number => {
      if (value === undefined) return 0;
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) return Number.NaN;
      return Number(value);
    };
    if (campaign.id !== campaignId || campaign.account_id !== this.creds.adAccountId.replace(/^act_/, "")
      || campaign.status !== expected.status.toUpperCase() || minorUnits(campaign.lifetime_budget) !== 0
      || !Array.isArray(adSets.data) || !Array.isArray(ads.data) || adSets.paging?.next || ads.paging?.next
      || !expected.adSetIds.length || !expected.adIds.length
      || new Set(expected.adSetIds).size !== expected.adSetIds.length || new Set(expected.adIds).size !== expected.adIds.length
      || adSets.data.length !== expected.adSetIds.length || ads.data.length !== expected.adIds.length
      || adSets.data.some(adSet => !expected.adSetIds.includes(adSet.id))
      || ads.data.some(ad => !expected.adIds.includes(ad.id) || !expected.adSetIds.includes(ad.adset_id))) {
      throw new CampaignDeliveryError("Campaign children changed or could not be verified. Reconcile the intended ads in Meta before reviewing again.");
    }
    const cappedAdSetIds = expected.cappedAdSetIds ?? [];
    let adSetBudget = 0;
    for (const adSet of adSets.data) {
      const capped = cappedAdSetIds.includes(adSet.id);
      if (!["ACTIVE", "PAUSED"].includes(adSet.status) || adSet.promoted_object?.page_id !== this.creds.pageId || !adSet.targeting
        || (capped ? minorUnits(adSet.daily_budget) !== 0 || !(minorUnits(adSet.lifetime_budget) > 0) : minorUnits(adSet.lifetime_budget) !== 0)) {
        throw new CampaignDeliveryError("Campaign Page or ad-set delivery settings changed. Review the intended children in Meta before activation.");
      }
      if (!capped) adSetBudget += minorUnits(adSet.daily_budget);
    }
    if (ads.data.some(ad => !["ACTIVE", "PAUSED"].includes(ad.status) || !ad.creative?.id)) {
      throw new CampaignDeliveryError("An intended ad has missing or changed delivery settings. Review it in Meta before activation.");
    }
    const campaignBudget = minorUnits(campaign.daily_budget);
    const total = campaignBudget > 0 && adSetBudget === 0 ? campaignBudget : campaignBudget === 0 ? adSetBudget : Number.NaN;
    if (!Number.isSafeInteger(total) || total <= 0 || total !== Math.round(expected.dailyBudgetRupees * 100)) {
      throw new CampaignDeliveryError("Campaign budget changed in Meta. Refresh and review the budget before activation.");
    }
    return {
      campaign: { id: campaign.id, status: campaign.status, effectiveStatus: campaign.effective_status ?? null },
      adSets: adSets.data.map(adSet => ({
        id: adSet.id, status: adSet.status, effectiveStatus: adSet.effective_status ?? null,
        dailyBudgetPaise: minorUnits(adSet.daily_budget), pageId: adSet.promoted_object!.page_id!,
        destinationType: adSet.destination_type ?? null, targeting: adSet.targeting ?? null,
      })).sort((left, right) => left.id.localeCompare(right.id)),
      ads: ads.data.map(ad => ({
        id: ad.id, status: ad.status, effectiveStatus: ad.effective_status ?? null,
        adSetId: ad.adset_id, creativeId: ad.creative!.id!,
      })).sort((left, right) => left.id.localeCompare(right.id)),
    };
  }

  async verifyCampaignActivation(
    campaignId: string,
    expected: { dailyBudgetRupees: number; status: string; adSetIds: string[]; adIds: string[]; cappedAdSetIds?: string[]; keepPaused?: string[] },
  ): Promise<CampaignDeliverySnapshot> {
    const { keepPaused = [], ...tree } = expected;
    const snapshot = await this.readCampaignDelivery(campaignId, tree);
    // #1055: an ad the owner paused from the card stays paused; every other intended ad must be ACTIVE.
    if (snapshot.adSets.some(adSet => adSet.status !== "ACTIVE") || snapshot.ads.some(ad => ad.status !== "ACTIVE" && !keepPaused.includes(ad.id))) {
      throw new CampaignDeliveryError("An intended ad set or ad is paused. Activate only the intended children in Meta and review this campaign again.");
    }
    return snapshot;
  }

  async enforceCampaignSpendCap(campaignId: string, maximumPaise: number): Promise<void> {
    if (!Number.isSafeInteger(maximumPaise) || maximumPaise <= 0) throw new MetaError("Invalid customer media allowance.");
    await this.verifyCampaignBinding(campaignId);
    const current = await this.graph<{ id: string; account_id: string; can_use_spend_cap?: boolean; spend_cap?: string }>(
      `${encodeURIComponent(campaignId)}?fields=id,account_id,can_use_spend_cap,spend_cap`,
    );
    if (current.id !== campaignId || current.account_id !== this.creds.adAccountId.replace(/^act_/, "") || current.can_use_spend_cap !== true
      || !/^\d+$/.test(current.spend_cap ?? "0") || !Number.isSafeInteger(Number(current.spend_cap ?? 0))) {
      throw new MetaError("Meta cannot verify a finite campaign spending limit. Keep the campaign paused.");
    }
    const existing = Number(current.spend_cap ?? 0);
    const target = existing > 0 ? Math.min(existing, maximumPaise) : maximumPaise;
    if (existing !== target) {
      const updated = await this.graph<{ success?: boolean }>(encodeURIComponent(campaignId), { method: "POST", form: { spend_cap: String(target) } });
      if (updated.success !== true) throw new MetaError("Campaign spending limit is unconfirmed. Reconcile before activation.");
    }
    const confirmed = await this.graph<{ id: string; account_id: string; spend_cap?: string }>(
      `${encodeURIComponent(campaignId)}?fields=id,account_id,spend_cap`,
    );
    if (confirmed.id !== campaignId || confirmed.account_id !== current.account_id || !/^\d+$/.test(confirmed.spend_cap ?? "")
      || Number(confirmed.spend_cap) !== target) throw new MetaError("Campaign spending limit changed. Keep the campaign paused.");
  }

  /**
   * Caps total spend on Meta's side when the amount is below the campaign spend-cap
   * minimum (₹5,000 for INR): a new PAUSED ad set with lifetime_budget = the approved
   * amount and an end date, holding PAUSED copies of the reviewed ads. Everything is
   * read back; on any difference the new ad set is removed and nothing is returned.
   * Never writes anything but PAUSED.
   */
  async createCappedAdSet(
    campaignId: string,
    input: { sourceAdSetId: string; sourceAdIds: string[]; lifetimeBudgetPaise: number; endTime: Date },
  ): Promise<CappedAdSet> {
    const { sourceAdSetId, sourceAdIds, lifetimeBudgetPaise, endTime } = input;
    if (!Number.isSafeInteger(lifetimeBudgetPaise) || lifetimeBudgetPaise <= 0 || !sourceAdIds.length
      || new Set(sourceAdIds).size !== sourceAdIds.length || !(endTime.getTime() > Date.now())) {
      throw new MetaError("Invalid approved spending limit.");
    }
    await this.verifyCampaignBinding(campaignId);
    const source = await this.graph<{
      id?: string; campaign_id?: string; billing_event?: string; optimization_goal?: string; bid_strategy?: string;
      destination_type?: string; promoted_object?: { page_id?: string }; targeting?: unknown;
    }>(`${encodeURIComponent(sourceAdSetId)}?fields=id,campaign_id,billing_event,optimization_goal,bid_strategy,destination_type,promoted_object,targeting`);
    if (source.id !== sourceAdSetId || source.campaign_id !== campaignId || source.promoted_object?.page_id !== this.creds.pageId
      || !source.billing_event || !source.optimization_goal || !source.targeting) {
      throw new CampaignDeliveryError("The reviewed ad set could not be verified. Keep the campaign paused.");
    }
    const endSeconds = Math.floor(endTime.getTime() / 1000);
    const created = await this.graph<{ id?: string }>(`${this.creds.adAccountId}/adsets`, {
      method: "POST",
      form: {
        name: `AdBrain capped ${(lifetimeBudgetPaise / 100).toFixed(2)} until ${new Date(endSeconds * 1000).toISOString().slice(0, 10)}`,
        campaign_id: campaignId,
        status: "PAUSED",
        lifetime_budget: String(lifetimeBudgetPaise),
        end_time: new Date(endSeconds * 1000).toISOString(),
        billing_event: source.billing_event,
        optimization_goal: source.optimization_goal,
        bid_strategy: source.bid_strategy ?? "LOWEST_COST_WITHOUT_CAP",
        ...(source.destination_type ? { destination_type: source.destination_type } : {}),
        promoted_object: JSON.stringify(source.promoted_object),
        targeting: JSON.stringify(source.targeting),
      },
    });
    if (typeof created.id !== "string" || !created.id) throw new CampaignDeliveryError("Meta did not create the capped ad set. Keep the campaign paused.");
    const adSetId = created.id;
    try {
      const adIds: string[] = [];
      for (const adId of sourceAdIds) {
        const copy = await this.graph<{ copied_ad_id?: string }>(`${encodeURIComponent(adId)}/copies`, {
          method: "POST",
          form: { adset_id: adSetId, status_option: "PAUSED" },
        });
        if (typeof copy.copied_ad_id !== "string" || !copy.copied_ad_id) throw new CampaignDeliveryError("Meta did not copy a reviewed ad.");
        adIds.push(copy.copied_ad_id);
      }
      const node = encodeURIComponent(adSetId);
      const [adSet, ads] = await Promise.all([
        this.graph<{ id?: string; campaign_id?: string; status?: string; daily_budget?: string; lifetime_budget?: string; budget_remaining?: string; end_time?: string }>(
          `${node}?fields=id,campaign_id,status,daily_budget,lifetime_budget,budget_remaining,end_time`,
        ),
        this.graph<{ data?: Array<{ id: string; status?: string; adset_id?: string }>; paging?: { next?: string } }>(
          `${node}/ads?fields=id,status,adset_id&limit=100`,
        ),
      ]);
      const paise = String(lifetimeBudgetPaise);
      if (adSet.id !== adSetId || adSet.campaign_id !== campaignId || adSet.status !== "PAUSED"
        || Number(adSet.daily_budget ?? 0) !== 0 || adSet.lifetime_budget !== paise || adSet.budget_remaining !== paise
        || Math.floor(Date.parse(adSet.end_time ?? "") / 1000) !== endSeconds
        || !Array.isArray(ads.data) || ads.paging?.next || ads.data.length !== adIds.length
        || ads.data.some(ad => !adIds.includes(ad.id) || ad.status !== "PAUSED" || ad.adset_id !== adSetId)) {
        throw new CampaignDeliveryError("Meta did not confirm the approved spending limit.");
      }
      return { adSetId, adIds, lifetimeBudgetPaise, endTime: new Date(endSeconds * 1000).toISOString() };
    } catch (error) {
      await this.graph(encodeURIComponent(adSetId), { method: "DELETE" }).catch(() => undefined);
      throw error instanceof CampaignDeliveryError
        ? new CampaignDeliveryError(`${error.message} The campaign stays paused.`)
        : error;
    }
  }

  /**
   * #773: change a launched, PAUSED ad set's audience. Meta refuses targeting updates on an Advantage+
   * ad set with interests (100/1359202), so one with interests is rebuilt: a new PAUSED ad set with the
   * same budget, bid and promoted object and the new targeting, the ads copied onto it PAUSED, read back,
   * then the old ad set archived. One without interests is patched in place and read back. Only the
   * audience fields change; interests and Advantage+ settings are kept. `validateOnly` changes nothing.
   */
  async editAdSetTargeting(
    campaignId: string,
    input: { adSetId: string; adIds: string[]; changes: AudienceChanges },
    options: { validateOnly?: boolean; copyOnly?: boolean } = {},
  ): Promise<AudienceEdit> {
    const { adSetId, adIds, changes } = input;
    const validAge = !changes.age || (Number.isInteger(changes.age.min) && Number.isInteger(changes.age.max)
      && changes.age.min >= 18 && changes.age.max <= 65 && changes.age.min <= changes.age.max);
    const validLanguages = !changes.languages || (changes.languages.length <= AD_LANGUAGE_KEYS.size
      && new Set(changes.languages).size === changes.languages.length && changes.languages.every(key => AD_LANGUAGE_KEYS.has(key)));
    if (!(changes.location || changes.excludedLocation || changes.age || changes.gender || changes.languages) || !validAge || !validLanguages
      || !adIds.length || new Set(adIds).size !== adIds.length) {
      throw new MetaError("Invalid audience change.");
    }
    await this.verifyCampaignBinding(campaignId);
    const source = await this.graph<{
      id?: string; campaign_id?: string; status?: string; billing_event?: string; optimization_goal?: string; bid_strategy?: string;
      destination_type?: string; promoted_object?: { page_id?: string }; targeting?: Record<string, unknown>;
      daily_budget?: string; lifetime_budget?: string; budget_remaining?: string; end_time?: string;
    }>(`${encodeURIComponent(adSetId)}?fields=id,campaign_id,status,billing_event,optimization_goal,bid_strategy,destination_type,promoted_object,targeting,daily_budget,lifetime_budget,budget_remaining,end_time`);
    if (source.id !== adSetId || source.campaign_id !== campaignId || source.promoted_object?.page_id !== this.creds.pageId
      || !source.billing_event || !source.optimization_goal || !source.targeting || typeof source.targeting !== "object") {
      throw new CampaignDeliveryError("The ad set could not be verified. Keep the campaign paused.");
    }
    if (source.status !== "PAUSED" && source.status !== "ACTIVE") throw new CampaignDeliveryError("Pause the ad set before changing its audience.");
    // #741 (QA on #828): a new area must arrive with its own out-of-area exclusions ({} when it has none),
    // so the old area's are replaced, and the result may never exclude a place it includes.
    if (changes.location && !changes.excludedLocation) throw new TargetingExclusionsMissingError();
    // #906: an edited WhatsApp ad set leaves Audience Network out, as a new one does.
    const edited = editedTargeting(source.targeting, changes);
    const targeting = source.destination_type === "WHATSAPP" ? withoutAudienceNetwork(edited) : edited;
    if (excludesIncludedPlace(targeting)) {
      throw new TargetingExclusionsMissingError("The new area is also excluded, so the ads would reach no one. Nothing changed.");
    }
    const rebuild = needsRebuild(source);
    // #765: a running ad set is only changed in place; a rebuild would leave the old one delivering, unless it
    // builds a PAUSED copy for the owner to switch to (copyOnly: the old ad set is left exactly as it is).
    if (rebuild && source.status !== "PAUSED" && !options.copyOnly) throw new CampaignDeliveryError("Pause the ad set before changing its audience.");
    if (options.copyOnly && !rebuild) throw new MetaError("Only an ad set Meta can't change in place is copied.");
    const validate: Record<string, string> = options.validateOnly ? { execution_options: JSON.stringify(["validate_only"]) } : {};
    if (!rebuild) {
      const patched = await this.graph<{ success?: boolean }>(encodeURIComponent(adSetId), {
        method: "POST", form: { targeting: JSON.stringify(targeting), ...validate },
      });
      if (patched.success !== true) throw new CampaignDeliveryError("Meta did not accept the new audience. Nothing changed.");
      if (options.validateOnly) return { mode: "patch", validated: true, adSetId, adIds, retiredAdSetId: null };
      const after = await this.graph<{ id?: string; status?: string; targeting?: Record<string, unknown> }>(`${encodeURIComponent(adSetId)}?fields=id,status,targeting`);
      if (after.id !== adSetId || after.status !== source.status || !sameAudience(after.targeting, targeting, changes)) {
        throw new CampaignDeliveryError(source.status === "PAUSED" ? "Meta did not confirm the new audience. Keep the campaign paused." : "Meta did not confirm the new audience. Check the campaign in Meta.");
      }
      return { mode: "patch", validated: false, adSetId, adIds, retiredAdSetId: null };
    }
    const capped = Number(source.lifetime_budget ?? 0) > 0;
    // A capped run keeps only what is left of its cap, never the whole cap again.
    const budget: Record<string, string> = capped
      ? { lifetime_budget: source.budget_remaining ?? "", end_time: source.end_time ?? "" }
      : { daily_budget: source.daily_budget ?? "" };
    if (!/^[1-9]\d*$/.test(capped ? budget.lifetime_budget : budget.daily_budget)) {
      throw new CampaignDeliveryError(capped && source.budget_remaining === "0"
        ? "This capped run has spent its total. Start a new run instead."
        : "The ad set's budget could not be verified. Keep the campaign paused.");
    }
    if (capped && !(Date.parse(budget.end_time) > Date.now())) throw new CampaignDeliveryError("This capped run has ended. Start a new run instead.");
    const created = await this.graph<{ id?: string; success?: boolean }>(`${this.creds.adAccountId}/adsets`, {
      method: "POST",
      form: {
        name: `AdBrain audience ${new Date().toISOString().slice(0, 10)}`,
        campaign_id: campaignId, status: "PAUSED", ...budget,
        billing_event: source.billing_event, optimization_goal: source.optimization_goal,
        bid_strategy: source.bid_strategy ?? "LOWEST_COST_WITHOUT_CAP",
        ...(source.destination_type ? { destination_type: source.destination_type } : {}),
        promoted_object: JSON.stringify(source.promoted_object), targeting: JSON.stringify(targeting), ...validate,
      },
    });
    if (options.validateOnly) {
      if (created.success !== true) throw new CampaignDeliveryError("Meta did not accept the new audience. Nothing changed.");
      return { mode: "rebuild", validated: true, adSetId, adIds, retiredAdSetId: null };
    }
    if (typeof created.id !== "string" || !created.id) throw new CampaignDeliveryError("Meta did not create the new ad set. Keep the campaign paused.");
    const newAdSetId = created.id;
    try {
      const copied: string[] = [];
      for (const adId of adIds) {
        const copy = await this.graph<{ copied_ad_id?: string }>(`${encodeURIComponent(adId)}/copies`, {
          method: "POST", form: { adset_id: newAdSetId, status_option: "PAUSED" },
        });
        if (typeof copy.copied_ad_id !== "string" || !copy.copied_ad_id) throw new CampaignDeliveryError("Meta did not copy an ad.");
        copied.push(copy.copied_ad_id);
      }
      const node = encodeURIComponent(newAdSetId);
      const [adSet, ads] = await Promise.all([
        this.graph<{ id?: string; campaign_id?: string; status?: string; targeting?: Record<string, unknown> }>(`${node}?fields=id,campaign_id,status,targeting`),
        this.graph<{ data?: Array<{ id: string; status?: string; adset_id?: string }>; paging?: { next?: string } }>(`${node}/ads?fields=id,status,adset_id&limit=100`),
      ]);
      if (adSet.id !== newAdSetId || adSet.campaign_id !== campaignId || adSet.status !== "PAUSED" || !sameAudience(adSet.targeting, targeting, changes)
        || !Array.isArray(ads.data) || ads.paging?.next || ads.data.length !== copied.length
        || ads.data.some(ad => !copied.includes(ad.id) || ad.status !== "PAUSED" || ad.adset_id !== newAdSetId)) {
        throw new CampaignDeliveryError("Meta did not confirm the new ad set.");
      }
      if (options.copyOnly) return { mode: "rebuild", validated: false, adSetId: newAdSetId, adIds: copied, retiredAdSetId: null };
      await this.writeStatus(adSetId, "ARCHIVED");
      return { mode: "rebuild", validated: false, adSetId: newAdSetId, adIds: copied, retiredAdSetId: adSetId };
    } catch (error) {
      await this.graph(encodeURIComponent(newAdSetId), { method: "DELETE" }).catch(() => undefined);
      const unchanged = source.status === "PAUSED" ? "The old ad set is unchanged and the campaign stays paused." : "The old ad set is unchanged and keeps running.";
      throw error instanceof CampaignDeliveryError ? new CampaignDeliveryError(`${error.message} ${unchanged}`) : error;
    }
  }

  /**
   * #765 (b): turns a running ad set's PAUSED copy on in its place. Never two ACTIVE: Meta first checks the
   * copy's activation (validate_only), then the old ad set is paused, a capped copy's total is cut to what the
   * old one has left, the copy's ads and then the copy go ACTIVE, and both are read back. If anything fails
   * after the pause, the copy is paused again and the old ad set resumed. The old ad set is archived last.
   * `running` is the campaign's intended state: on a paused campaign nothing is turned on, the copy just takes
   * the old ad set's place. Safe to retry: a switch Meta already finished is completed, and one cut off after
   * the pause carries on from where it stopped.
   */
  async switchAdSet(campaignId: string, input: { fromAdSetId: string; toAdSetId: string; toAdIds: string[]; running: boolean }): Promise<AdSetSwitch> {
    const { fromAdSetId, toAdSetId, toAdIds, running } = input;
    if (fromAdSetId === toAdSetId || !toAdIds.length || new Set(toAdIds).size !== toAdIds.length) throw new MetaError("Invalid ad set switch.");
    type AdSetRead = { id?: string; campaign_id?: string; status?: string; lifetime_budget?: string; budget_remaining?: string };
    const read = (id: string) => this.graph<AdSetRead>(`${encodeURIComponent(id)}?fields=id,campaign_id,status,lifetime_budget,budget_remaining`);
    const readAds = (id: string) => this.graph<{ data?: Array<{ id: string; status?: string; adset_id?: string }>; paging?: { next?: string } }>(`${encodeURIComponent(id)}/ads?fields=id,status,adset_id&limit=100`);
    const [from, to, ads] = await Promise.all([read(fromAdSetId), read(toAdSetId), readAds(toAdSetId)]);
    const sameAds = (list: typeof ads) => Array.isArray(list.data) && !list.paging?.next && list.data.length === toAdIds.length
      && list.data.every(ad => toAdIds.includes(ad.id) && ad.adset_id === toAdSetId);
    if (from.id !== fromAdSetId || from.campaign_id !== campaignId || to.id !== toAdSetId || to.campaign_id !== campaignId || !sameAds(ads)) {
      throw new CampaignDeliveryError("The new audience's ad set could not be verified. Nothing changed.");
    }
    const done = { fromAdSetId, adSetId: toAdSetId, adIds: toAdIds };
    const oldStopped = from.status === "PAUSED" || from.status === "ARCHIVED";
    // A retry after Meta finished: the copy delivers (or, on a paused campaign, has taken the old one's place).
    if (running && to.status === "ACTIVE" && ads.data!.every(ad => ad.status === "ACTIVE") && oldStopped) {
      if (from.status === "PAUSED") await this.writeStatus(fromAdSetId, "ARCHIVED").catch(() => undefined);
      return done;
    }
    if (!running && to.status === "PAUSED" && from.status === "ARCHIVED") return done;
    if (to.status !== "PAUSED" || !["ACTIVE", "PAUSED", "ARCHIVED"].includes(from.status ?? "")) {
      throw new CampaignDeliveryError("The old ad set or the new one is in an unexpected state. Nothing changed; check the campaign in Meta.");
    }
    const capped = Number(from.lifetime_budget ?? 0) > 0;
    const cutCap = async () => {
      // The old ad set kept spending while the copy waited; the copy may spend only what is left now.
      const left = await read(fromAdSetId);
      if (left.status === "ACTIVE" || !/^[1-9]\d*$/.test(left.budget_remaining ?? "")) throw new CampaignDeliveryError("This capped run has spent its total. Start a new run instead.");
      if (to.lifetime_budget === left.budget_remaining) return;
      await this.graph(encodeURIComponent(toAdSetId), { method: "POST", form: { lifetime_budget: left.budget_remaining! } });
      const cut = await read(toAdSetId);
      if (cut.lifetime_budget !== left.budget_remaining) throw new CampaignDeliveryError("Meta did not confirm the new ad set's total.");
    };
    if (!running) {
      if (from.status === "ACTIVE") await this.writeStatus(fromAdSetId, "PAUSED");
      if (capped) await cutCap();
      await this.writeStatus(fromAdSetId, "ARCHIVED");
      return done;
    }
    const activation = await this.graph<{ success?: boolean }>(encodeURIComponent(toAdSetId), {
      method: "POST", form: { status: "ACTIVE", execution_options: JSON.stringify(["validate_only"]) },
    });
    if (activation.success !== true) throw new CampaignDeliveryError("Meta would not turn the new audience on. Nothing changed.");

    // An attempt cut off after the pause (old PAUSED) or after the archive carries on from here.
    if (from.status === "ACTIVE") await this.writeStatus(fromAdSetId, "PAUSED");
    try {
      if (capped) await cutCap();
      for (const adId of toAdIds) await this.writeStatus(adId, "ACTIVE");
      await this.writeStatus(toAdSetId, "ACTIVE");
      const [oldAfter, newAfter, adsAfter] = await Promise.all([read(fromAdSetId), read(toAdSetId), readAds(toAdSetId)]);
      if (oldAfter.status === "ACTIVE" || newAfter.status !== "ACTIVE" || !sameAds(adsAfter) || adsAfter.data!.some(ad => ad.status !== "ACTIVE")) {
        throw new CampaignDeliveryError("Meta did not confirm the switch.");
      }
    } catch (error) {
      const message = error instanceof MetaError ? error.message.replace(/\.?$/, ".") : "Meta refused the switch.";
      const restored = await this.writeStatus(toAdSetId, "PAUSED")
        .then(() => from.status === "ARCHIVED" ? false : this.writeStatus(fromAdSetId, "ACTIVE").then(() => true))
        .catch(() => false);
      if (!restored) throw new AdSetSwitchStuckError(`${message} The old audience could not be turned back on. Try again, or check the campaign in Meta.`);
      throw new CampaignDeliveryError(`${message} The old audience is running again.`);
    }
    // Delivery has moved; a failed archive only leaves a PAUSED ad set behind, finished on a retry.
    if (from.status !== "ARCHIVED") await this.writeStatus(fromAdSetId, "ARCHIVED").catch(() => undefined);
    return done;
  }

  /** #765 (b): deletes a PAUSED copy that was never switched on. Only that ad set is written. */
  async deleteAdSetCopy(campaignId: string, adSetId: string, options: { runningAdSetId?: string } = {}): Promise<void> {
    const node = encodeURIComponent(adSetId);
    // On a running campaign, a switch cut off after its pause leaves the old ad set paused: deleting the copy then
    // would leave nothing delivering. That ad set is only read here, never written.
    if (options.runningAdSetId) {
      const running = await this.graph<{ id?: string; campaign_id?: string; status?: string }>(`${encodeURIComponent(options.runningAdSetId)}?fields=id,campaign_id,status`);
      if (running.id !== options.runningAdSetId || running.campaign_id !== campaignId || running.status !== "ACTIVE") {
        throw new CampaignDeliveryError("The current audience isn't running, so the new one can't be cancelled. Turn the new audience on to finish.");
      }
    }
    const copy = await this.graph<{ id?: string; campaign_id?: string; status?: string }>(`${node}?fields=id,campaign_id,status`);
    // A retry after Meta already deleted it.
    if (copy.id === adSetId && copy.campaign_id === campaignId && copy.status === "DELETED") return;
    if (copy.id !== adSetId || copy.campaign_id !== campaignId || copy.status !== "PAUSED") {
      throw new CampaignDeliveryError("The new audience's ad set isn't a paused copy in this campaign. Nothing was deleted.");
    }
    const deleted = await this.graph<{ success?: boolean }>(node, { method: "DELETE" });
    if (deleted.success !== true) throw new CampaignDeliveryError("Meta did not delete the copy. Try again.");
  }

  /** #774: an ad set's budget and end time, verified to belong to the campaign and the bound Page. */
  async readAdSetBudget(campaignId: string, adSetId: string): Promise<AdSetBudget> {
    const adSet = await this.graph<{
      id?: string; campaign_id?: string; status?: string; promoted_object?: { page_id?: string };
      daily_budget?: string; lifetime_budget?: string; budget_remaining?: string; end_time?: string;
    }>(`${encodeURIComponent(adSetId)}?fields=id,campaign_id,status,promoted_object,daily_budget,lifetime_budget,budget_remaining,end_time`);
    const paise = (value: string | undefined) => value === undefined ? 0 : /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : Number.NaN;
    const budget = {
      adSetId, status: adSet.status ?? "", dailyBudgetPaise: paise(adSet.daily_budget), lifetimeBudgetPaise: paise(adSet.lifetime_budget),
      remainingPaise: paise(adSet.budget_remaining), endTime: adSet.end_time && Number.isFinite(Date.parse(adSet.end_time)) ? new Date(Date.parse(adSet.end_time)).toISOString() : null,
    };
    // Exactly one of a daily or a lifetime budget; a lifetime budget always has an end time.
    if (adSet.id !== adSetId || adSet.campaign_id !== campaignId || adSet.promoted_object?.page_id !== this.creds.pageId
      || !["ACTIVE", "PAUSED"].includes(budget.status) || ![budget.dailyBudgetPaise, budget.lifetimeBudgetPaise, budget.remainingPaise].every(Number.isSafeInteger)
      || (budget.dailyBudgetPaise > 0) === (budget.lifetimeBudgetPaise > 0) || (budget.lifetimeBudgetPaise > 0 && !budget.endTime)) {
      throw new CampaignDeliveryError("The ad set's budget could not be verified. Refresh the campaign and try again.");
    }
    return budget;
  }

  /**
   * #774: change a launched ad set's daily budget, lifetime budget (a capped run's total) or end time in
   * place. Meta doesn't send budget or schedule edits back to review, so this never rebuilds and never
   * changes status. `validateOnly` changes nothing; otherwise the ad set is read back and must match.
   */
  async editAdSetBudget(campaignId: string, adSetId: string, change: AdSetBudgetChange, options: { validateOnly?: boolean } = {}): Promise<AdSetBudget> {
    const positive = (value: number | undefined) => value === undefined || (Number.isSafeInteger(value) && value > 0);
    const endSeconds = change.endTime === undefined ? undefined : Math.floor(Date.parse(change.endTime) / 1000);
    if ((change.dailyBudgetPaise === undefined && change.lifetimeBudgetPaise === undefined && change.endTime === undefined)
      || !positive(change.dailyBudgetPaise) || !positive(change.lifetimeBudgetPaise)
      || (change.dailyBudgetPaise !== undefined && change.lifetimeBudgetPaise !== undefined)
      || (endSeconds !== undefined && !(endSeconds * 1000 > Date.now()))) {
      throw new MetaError("Invalid budget change.");
    }
    await this.verifyCampaignBinding(campaignId);
    const before = await this.readAdSetBudget(campaignId, adSetId);
    if ((change.dailyBudgetPaise !== undefined && !before.dailyBudgetPaise) || (change.lifetimeBudgetPaise !== undefined && !before.lifetimeBudgetPaise)) {
      throw new CampaignDeliveryError("This ad set's budget type changed in Meta. Refresh the campaign and try again.");
    }
    const form: Record<string, string> = {
      ...(change.dailyBudgetPaise !== undefined ? { daily_budget: String(change.dailyBudgetPaise) } : {}),
      ...(change.lifetimeBudgetPaise !== undefined ? { lifetime_budget: String(change.lifetimeBudgetPaise) } : {}),
      ...(endSeconds !== undefined ? { end_time: new Date(endSeconds * 1000).toISOString() } : {}),
      ...(options.validateOnly ? { execution_options: JSON.stringify(["validate_only"]) } : {}),
    };
    const written = await this.graph<{ success?: boolean }>(encodeURIComponent(adSetId), { method: "POST", form });
    if (written.success !== true) throw new CampaignDeliveryError("Meta did not accept the new budget. Nothing changed.");
    if (options.validateOnly) return before;
    // Meta accepted the write: a failed read-back must never look like "nothing was sent".
    const after = await this.readAdSetBudget(campaignId, adSetId).catch((error: unknown) => {
      throw error instanceof CampaignDeliveryError ? error : new CampaignDeliveryError("Meta did not confirm the new budget. Check the campaign in Meta before changing it again.");
    });
    if (after.status !== before.status
      || after.dailyBudgetPaise !== (change.dailyBudgetPaise ?? before.dailyBudgetPaise)
      || after.lifetimeBudgetPaise !== (change.lifetimeBudgetPaise ?? before.lifetimeBudgetPaise)
      || (endSeconds !== undefined && Math.floor(Date.parse(after.endTime ?? "") / 1000) !== endSeconds)) {
      throw new CampaignDeliveryError("Meta did not confirm the new budget. Check the campaign in Meta before changing it again.");
    }
    return after;
  }

  /** Pause or resume a campaign after verifying its account and Page. */
  async updateCampaignStatus(
    campaignId: string,
    status: "ACTIVE" | "PAUSED",
  ): Promise<void> {
    await this.verifyCampaignBinding(campaignId);
    await this.graph(encodeURIComponent(campaignId), {
      method: "POST",
      form: { status },
    });
  }

  /**
   * Emergency stop: pauses the campaign, then its intended ad sets and ads, and
   * reads all three levels back. Never writes anything but PAUSED.
   */
  async pauseCampaignTree(campaignId: string, children: { adSetIds: string[]; adIds: string[] }): Promise<PausedCampaignTree> {
    await this.verifyCampaignBinding(campaignId);
    for (const id of [campaignId, ...children.adSetIds, ...children.adIds]) await this.writeStatus(id, "PAUSED");

    type Node = { id: string; status: string; effective_status?: string };
    const node = encodeURIComponent(campaignId);
    const [campaign, adSets, ads] = await Promise.all([
      this.graph<Node>(`${node}?fields=id,status,effective_status`),
      this.graph<{ data?: Node[]; paging?: { next?: string } }>(`${node}/adsets?fields=id,status,effective_status&limit=100`),
      this.graph<{ data?: Node[]; paging?: { next?: string } }>(`${node}/ads?fields=id,status,effective_status&limit=100`),
    ]);
    const objects: PausedCampaignTree["objects"] = [
      { id: campaign.id, level: "campaign", status: campaign.status, effectiveStatus: campaign.effective_status ?? null },
      ...(adSets.data ?? []).map(item => ({ id: item.id, level: "adset" as const, status: item.status, effectiveStatus: item.effective_status ?? null })),
      ...(ads.data ?? []).map(item => ({ id: item.id, level: "ad" as const, status: item.status, effectiveStatus: item.effective_status ?? null })),
    ];
    const paused = (id: string) => objects.some(object => object.id === id && object.status === "PAUSED");
    const confirmed = campaign.id === campaignId && [campaignId, ...children.adSetIds, ...children.adIds].every(paused);
    return { confirmed, objects };
  }

  /**
   * #1045: turns one ad of a verified campaign off (or back on, to undo AdBrain's own pause) and reads
   * it back. Nothing else changes: no ad set, budget or campaign write. `validateOnly` asks Meta to
   * check the write without making it.
   */
  async setAdStatus(campaignId: string, adId: string, status: "PAUSED" | "ACTIVE", options: { validateOnly?: boolean } = {}): Promise<AdStatus> {
    await this.verifyCampaignBinding(campaignId);
    type AdNode = { id?: string; campaign_id?: string; status?: string; effective_status?: string };
    const read = () => this.graph<AdNode>(`${encodeURIComponent(adId)}?fields=id,campaign_id,status,effective_status`);
    const before = await read();
    if (before.id !== adId || before.campaign_id !== campaignId) throw new MetaError("That ad isn't part of this campaign.");
    // Already so (e.g. the owner paused it in Meta after the last refresh): write nothing, so AdBrain
    // never records a pause it didn't make and can't later "undo" the owner's own decision.
    if (before.status === status) return { id: adId, status, effectiveStatus: before.effective_status ?? null, changed: false };
    if (options.validateOnly) {
      await this.graph(encodeURIComponent(adId), { method: "POST", form: { status, execution_options: JSON.stringify(["validate_only"]) } });
      return { id: adId, status: before.status ?? null, effectiveStatus: before.effective_status ?? null, changed: false };
    }
    await this.writeStatus(adId, status);
    const after = await read();
    return { id: adId, status: after.status ?? null, effectiveStatus: after.effective_status ?? null, changed: true };
  }

  /**
   * #1055: the original ad each given ad was copied from (a capped run's copy → its reviewed source ad);
   * an original maps to itself. Read-only.
   */
  async adSources(adIds: string[]): Promise<Record<string, string>> {
    const sources: Record<string, string> = {};
    for (const adId of adIds) {
      const ad = await this.graph<{ id?: string; source_ad_id?: string }>(`${encodeURIComponent(adId)}?fields=id,source_ad_id`);
      if (ad.id !== adId) throw new MetaError("An ad could not be read back from Meta.");
      sources[adId] = ad.source_ad_id && /^[1-9]\d*$/.test(ad.source_ad_id) ? ad.source_ad_id : adId;
    }
    return sources;
  }

  /** Status write with one retry after Meta's 613 (one status change per object per 30 s). */
  private async writeStatus(id: string, status: "ACTIVE" | "PAUSED" | "ARCHIVED") {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.graph(encodeURIComponent(id), { method: "POST", form: { status } });
        return;
      } catch (error) {
        if (!(error instanceof MetaError) || error.code !== 613 || attempt >= 1) throw error;
        await new Promise(resolve => setTimeout(resolve, STATUS_RATE_LIMIT_WAIT_MS));
      }
    }
  }

  /**
   * Turns on only the capped ad set from createCappedAdSet, its ad copies and the
   * campaign, after re-reading that Meta still holds the approved lifetime cap.
   */
  async activateCappedTree(campaignId: string, capped: CappedAdSet): Promise<CappedActivation> {
    await this.verifyCampaignBinding(campaignId);
    type Node = { id: string; status?: string; effective_status?: string };
    const read = async () => {
      const [campaign, adSet, ads] = await Promise.all([
        this.graph<Node>(`${encodeURIComponent(campaignId)}?fields=id,status,effective_status`),
        this.graph<Node & { campaign_id?: string; daily_budget?: string; lifetime_budget?: string; budget_remaining?: string; end_time?: string }>(
          `${encodeURIComponent(capped.adSetId)}?fields=id,campaign_id,status,effective_status,daily_budget,lifetime_budget,budget_remaining,end_time`,
        ),
        this.graph<{ data?: Array<Node & { adset_id?: string }>; paging?: { next?: string } }>(
          `${encodeURIComponent(capped.adSetId)}/ads?fields=id,status,effective_status,adset_id&limit=100`,
        ),
      ]);
      const capHolds = campaign.id === campaignId && adSet.id === capped.adSetId && adSet.campaign_id === campaignId
        && Number(adSet.daily_budget ?? 0) === 0 && adSet.lifetime_budget === String(capped.lifetimeBudgetPaise)
        && Math.floor(Date.parse(adSet.end_time ?? "") / 1000) === Math.floor(Date.parse(capped.endTime) / 1000)
        && Array.isArray(ads.data) && !ads.paging?.next && ads.data.length === capped.adIds.length
        && ads.data.every(ad => capped.adIds.includes(ad.id) && ad.adset_id === capped.adSetId);
      return { campaign, adSet, ads: ads.data ?? [], capHolds };
    };
    const before = await read();
    if (!before.capHolds) throw new CampaignDeliveryError("The approved spending limit changed in Meta. Nothing was activated.");
    for (const id of [...capped.adIds, capped.adSetId, campaignId]) await this.writeStatus(id, "ACTIVE");
    const after = await read();
    if (!after.capHolds || after.campaign.status !== "ACTIVE" || after.adSet.status !== "ACTIVE" || after.ads.some(ad => ad.status !== "ACTIVE")) {
      throw new CampaignDeliveryError("Meta did not confirm the capped activation.");
    }
    return {
      campaign: { id: campaignId, status: "ACTIVE", effectiveStatus: after.campaign.effective_status ?? null },
      adSet: {
        id: capped.adSetId, status: "ACTIVE", effectiveStatus: after.adSet.effective_status ?? null,
        lifetimeBudgetPaise: capped.lifetimeBudgetPaise, budgetRemainingPaise: Number(after.adSet.budget_remaining ?? Number.NaN), endTime: capped.endTime,
      },
      ads: after.ads.map(ad => ({ id: ad.id, status: "ACTIVE", effectiveStatus: ad.effective_status ?? null })),
    };
  }

  /** Meta's review state for every ad in the campaign, with its reasons in English. */
  async readAdReview(campaignId: string): Promise<AdReview[]> {
    await this.verifyCampaignBinding(campaignId);
    // ad_review_feedback follows the token user's Facebook language unless a locale is given (#635).
    const ads = await this.graph<{ data?: Array<{ id: string; effective_status?: string; ad_review_feedback?: unknown; issues_info?: unknown }>; paging?: { next?: string } }>(
      `${encodeURIComponent(campaignId)}/ads?fields=id,status,effective_status,configured_status,ad_review_feedback,issues_info&limit=100&locale=en_US`,
    );
    if (!Array.isArray(ads.data) || ads.paging?.next) throw new MetaError("Ad review status could not be read completely.");
    return ads.data.map(adReviewState);
  }
}
