import { getEnv } from "@/lib/env";
import { z } from "zod";
import { fetchPublicUrl } from "@/lib/security/ssrf";
import { readBoundedResponse } from "@/lib/imageGen/raster";
import { destinationFromAdSets, type CampaignDestination } from "@/lib/campaign/outcomes";
import { decodeCampaignInsights, decodeLifetimeSpendPaise, type CampaignInsights } from "./insights";
import { maskWhatsAppNumber, maskedWhatsAppNumberPattern } from "./whatsapp-status-shared";
import { graphEndpoint, graphEntity, graphErrorCode, graphOutcome } from "./graph-event";
import { recordProductEvent } from "@/lib/observability/logger";
export type { CampaignInsights } from "./insights";

const GRAPH = "https://graph.facebook.com/v21.0";

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
  /** The same ad at 9:16 for Stories and Reels (#333); without it every placement gets the 4:5 image. */
  storyImage?: Uint8Array | null;
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

export class MetaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number,
    readonly subcode?: number,
  ) {
    super(message);
    this.name = "MetaError";
  }
}

type GraphErrorBody = { message?: string; error_user_msg?: string; code?: number; error_subcode?: number };

const META_SUBCODE_MESSAGES: Record<number, (userMessage: string) => string> = {
  2446307: userMessage =>
    `Meta's minimum campaign spending limit for this currency is ${userMessage.match(/₹\s?[\d,]+(?:\.\d+)?/)?.[0] ?? "higher than this amount"}.`,
  1885257: () => "Meta does not allow changing a daily budget ad set to a lifetime budget.",
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
export type AccountFunding = { spendCapPaise: number; amountSpentPaise: number; roomPaise: number; prepay: boolean };
export type CappedActivation = {
  campaign: { id: string; status: "ACTIVE"; effectiveStatus: string | null };
  adSet: { id: string; status: "ACTIVE"; effectiveStatus: string | null; lifetimeBudgetPaise: number; budgetRemainingPaise: number; endTime: string };
  ads: Array<{ id: string; status: "ACTIVE"; effectiveStatus: string | null }>;
};

export type AdReviewState = "in_review" | "approved" | "rejected" | "issues" | "unknown";
export type AdReview = { adId: string; state: AdReviewState; effectiveStatus: string | null; reasons: string[] };

/** Meta's review outcome for one ad, from `effective_status`, `ad_review_feedback` and `issues_info`. */
export function adReviewState(ad: { id: string; effective_status?: string; ad_review_feedback?: unknown; issues_info?: unknown }): AdReview {
  const status = ad.effective_status ?? null;
  const feedback = ad.ad_review_feedback && typeof ad.ad_review_feedback === "object"
    ? Object.values(ad.ad_review_feedback as Record<string, unknown>).flatMap(group =>
      group && typeof group === "object" ? Object.values(group as Record<string, unknown>) : [group])
      .filter((reason): reason is string => typeof reason === "string").map(reason => reason.trim()).filter(Boolean)
    : [];
  const issues = Array.isArray(ad.issues_info)
    ? ad.issues_info.map(issue => (issue as { error_message?: unknown }).error_message)
      .filter((reason): reason is string => typeof reason === "string" && reason.trim() !== "")
    : [];
  const state: AdReviewState = status === "DISAPPROVED" ? "rejected"
    : status === "WITH_ISSUES" ? "issues"
    : status === "IN_PROCESS" || status === "PENDING_REVIEW" ? "in_review"
    : status && ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "PREAPPROVED"].includes(status) ? "approved"
    : "unknown";
  return { adId: ad.id, state, effectiveStatus: status, reasons: [...feedback, ...issues] };
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

/** Meta's click-to-WhatsApp `page_welcome_message`: a greeting plus a message pre-typed for the customer. */
export function whatsappWelcomeMessage(texts: { autofill: string; greeting: string }): string {
  return JSON.stringify({
    type: "VISUAL_EDITOR",
    version: 2,
    landing_screen_type: "welcome_message",
    media_type: "text",
    text_format: {
      customer_action_type: "autofill_message",
      message: { autofill_message: { content: texts.autofill }, text: texts.greeting },
    },
  });
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
export const ADVANTAGE_AUDIENCE_MAX_HARD_AGE_MIN = 25;

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
    targeting_automation: { advantage_audience: 1 },
  };
}

/** A short, loggable code for a failed Graph call: Meta's code/subcode, else the HTTP status. */
export function metaErrorCode(error: unknown): string {
  if (error instanceof MetaError) return error.code ? `${error.code}${error.subcode ? `.${error.subcode}` : ""}` : `http.${error.status ?? "unknown"}`;
  return error instanceof Error && error.name === "TimeoutError" ? "timeout" : "unknown";
}

/**
 * A creative with a 4:5 feed image and a 9:16 image that Meta uses for Stories and Reels (#333).
 * Placement asset customisation needs asset_feed_spec; object_story_spec then carries only the Page.
 */
export function placementCreativeSpec(p: {
  pageId: string;
  feedHash: string;
  storyHash: string;
  headline: string;
  message: string;
  description?: string;
  link: string;
  destination: AdDestination;
  whatsappNumber?: string;
  whatsappGreeting?: { autofill: string; greeting: string };
  leadFormId?: string;
}) {
  const cta = destinationCTA(p.destination, { leadFormId: p.leadFormId, phone: p.whatsappNumber });
  return {
    object_story_spec: { page_id: p.pageId },
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
      ...(p.destination === "whatsapp" && p.whatsappGreeting ? { additional_data: { page_welcome_message: whatsappWelcomeMessage(p.whatsappGreeting) } } : {}),
      ad_formats: ["SINGLE_IMAGE"],
      optimization_type: "PLACEMENT",
      asset_customization_rules: [
        { customization_spec: { publisher_platforms: ["facebook", "instagram"], facebook_positions: ["story", "facebook_reels"], instagram_positions: ["story", "reels"] }, image_label: { name: "adbrain_story" }, priority: 1 },
        { customization_spec: { publisher_platforms: ["facebook", "instagram", "audience_network", "messenger"] }, image_label: { name: "adbrain_feed" }, priority: 2 },
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

/** Read the single-tenant Meta credentials from the environment. */
export function getMetaCredentialsFromEnv(): MetaCredentials | null {
  const env = getEnv();
  if (
    !env.META_SYSTEM_USER_TOKEN ||
    !env.META_AD_ACCOUNT_ID ||
    !env.META_PAGE_ID
  ) {
    return null;
  }
  return {
    adAccountId: env.META_AD_ACCOUNT_ID,
    pageId: env.META_PAGE_ID,
    accessToken: env.META_SYSTEM_USER_TOKEN,
  };
}

export function isMetaConfigured(): boolean {
  return getMetaCredentialsFromEnv() !== null;
}

export function metaClientFromEnv(): MetaClient | null {
  const creds = getMetaCredentialsFromEnv();
  return creds ? new MetaClient(creds) : null;
}

/**
 * Meta Marketing API wrapper (Graph v21). Creates Advantage+ lead campaigns in
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
      throw new MetaError(metaErrorMessage(err, res.status), res.status, err?.code, err?.error_subcode);
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
   * The verified WhatsApp number for click-to-WhatsApp ads: the Page's linked number, or a
   * requested number on a WhatsApp Business Account owned by the ad account's own business
   * (Meta accepts those for the Page even when the Page fields are empty, #157). A request may
   * name the number by its mask ("+91 ••••• 4842", #235); it must match exactly one of those.
   */
  async getWhatsAppNumber(requested?: string | null): Promise<string | null> {
    const pageNumber = await this.pageWhatsAppNumber();
    if (requested && maskedWhatsAppNumberPattern.test(requested)) {
      const matches = [...new Set([...(pageNumber ? [pageNumber] : []), ...await this.businessWhatsAppNumbers()])]
        .filter((number) => maskWhatsAppNumber(number) === requested);
      return matches.length === 1 ? matches[0] : null;
    }
    const wanted = requested ? normalizeWhatsAppNumber(requested) : null;
    if (!wanted || wanted === pageNumber) return pageNumber;
    return (await this.businessWhatsAppNumbers()).includes(wanted) ? wanted : null;
  }

  /** WhatsApp numbers usable for this Page's ads: the Page's own, and those on the ad account business's WABAs (#235). */
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
    );
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
    const params = new URLSearchParams({ fields: "id,created_time,field_data", limit: String(Math.min(200, Math.max(1, opts.limit ?? 200))) });
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
    whatsappGreeting?: { autofill: string; greeting: string };
    phone?: string;
    variants?: AdSetVariant[];
    onCheckpoint?: (checkpoint: CampaignMutationCheckpoint) => void | Promise<void>;
    /** A 9:16 couldn't be used and the ad fell back to the single 4:5 image (#333). */
    onStoryFallback?: (stage: "upload" | "creative", errorCode: string) => void;
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
      if (await this.getWhatsAppNumber(params.whatsappNumber) !== params.whatsappNumber) throw new MetaError("The Page-linked WhatsApp number changed. Review the campaign again.");
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

    // Upload each creative image once and reuse the hash across all ad sets.
    const prepared: { input: CreativeInput; imageHash: string; storyHash: string | null }[] = [];
    for (let creativeIndex = 0; creativeIndex < params.creatives.length; creativeIndex++) {
      const c = params.creatives[creativeIndex];
      const imageHash = await this.uploadAdImage(c.imageUrl);
      await params.onCheckpoint?.({
        phase: "creative",
        externalId: imageHash,
        creativeIndex,
      });
      // Placement images are proven for WhatsApp ads only (tests/core/fixtures/meta/story-validate.json).
      let storyHash: string | null = null;
      if (c.storyImage && params.destination === "whatsapp") {
        storyHash = await this.uploadAdImageBytes(c.storyImage).catch((error: unknown) => {
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
    const targetingFor = (v: AdSetVariant) => JSON.stringify(adSetTargeting({
      location: v.location ?? params.location,
      excludedLocation: v.excludedLocation ?? params.excludedLocation,
      ageMin: (v.ageMin ?? params.ageMin)!,
      ageMax: (v.ageMax ?? params.ageMax)!,
      gender: params.gender,
      interests: params.interests,
    }));

    const makeAdSet = (dest: AdDestination, v: AdSetVariant, i: number) => {
      const dp = destinationPlan(dest);
      const suffix =
        v.label ?? (variants.length > 1 ? `Ad set ${i + 1}` : "Ad set");
      return this.graph<{ id: string }>(`${acct}/adsets`, {
        method: "POST",
        form: {
          name: `${params.name} — ${suffix}`,
          campaign_id: campaign.id,
          status: "PAUSED",
          daily_budget: String(Math.round(params.dailyBudgetRupees * 100)),
          billing_event: "IMPRESSIONS",
          optimization_goal: dp.optimizationGoal,
          bid_strategy: "LOWEST_COST_WITHOUT_CAP",
          destination_type: dp.destinationType,
          promoted_object: JSON.stringify({ page_id: this.creds.pageId, ...(dest === "whatsapp" ? { whatsapp_phone_number: params.whatsappNumber } : {}) }),
          targeting: targetingFor(v),
        },
      });
    };

    const destination = requested;
    const adSetIds: string[] = [];
    const adIds: string[] = [];

    for (let i = 0; i < variants.length; i++) {
      let adSet: { id: string };
      if (i === 0) {
        try {
          adSet = await makeAdSet(requested, variants[i], i);
        } catch (err) {
          if (requested === "instant_form") throw err;
          throw new MetaError(
            requested === "whatsapp"
              ? "WhatsApp is not available for this Meta Page. Connect WhatsApp or choose an instant lead form."
              : "Call ads are not available for this Meta Page. Add a phone number or choose an instant lead form.",
            err instanceof MetaError ? err.status : undefined,
          );
        }
      } else {
        adSet = await makeAdSet(destination, variants[i], i);
      }
      adSetIds.push(adSet.id);
      await params.onCheckpoint?.({ phase: "adset", externalId: adSet.id, variantIndex: i });

      for (let creativeIndex = 0; creativeIndex < prepared.length; creativeIndex++) {
        const { input: c, imageHash, storyHash } = prepared[creativeIndex];
        const placement = storyHash && destination === "whatsapp"
          ? placementCreativeSpec({
            pageId: this.creds.pageId, feedHash: imageHash, storyHash, headline: c.headline, message: c.message,
            description: c.description ?? undefined, link: `https://wa.me/${params.whatsappNumber!.slice(1)}`,
            destination, whatsappNumber: params.whatsappNumber, whatsappGreeting: params.whatsappGreeting,
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
        const postCreative = (form: Record<string, string>) => this.graph<{ id: string }>(`${acct}/adcreatives`, { method: "POST", form });
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

        const ad = await this.graph<{ id: string }>(`${acct}/ads`, {
          method: "POST",
          form: {
            name: c.headline.slice(0, 90) || "AdBrain ad",
            adset_id: adSet.id,
            status: "PAUSED",
            creative: JSON.stringify({ creative_id: creative.id }),
          },
        });
        adIds.push(ad.id);
        await params.onCheckpoint?.({
          phase: "ad",
          externalId: ad.id,
          variantIndex: i,
          creativeIndex,
        });
      }
    }

    return {
      campaignId: campaign.id,
      adSetId: adSetIds[0],
      adSetIds,
      adIds,
      destination,
    };
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

  async readBoundCampaign(campaign: MetaCampaignSummary & { account_id: string; lifetime_budget?: string }, cappedAdSetIds: readonly string[] = []) {
    if (campaign.account_id !== this.creds.adAccountId.replace(/^act_/, "") || Number(campaign.lifetime_budget ?? 0) !== 0
      || !["ACTIVE", "PAUSED"].includes(campaign.status)) return null;
    const response = await this.graph<{ data?: Array<{ id: string; status: string; destination_type?: string; daily_budget?: string; lifetime_budget?: string; promoted_object?: { page_id?: string } }>; paging?: { next?: string } }>(
      `${campaign.id}/adsets?fields=id,status,daily_budget,lifetime_budget,promoted_object,destination_type&limit=100`,
    );
    if (!response.data?.length || response.paging?.next) return null;
    const daily = response.data.filter(adSet => !cappedAdSetIds.includes(adSet.id));
    if (!daily.length) return null;
    let adSetBudget = 0;
    for (const adSet of response.data) {
      if (adSet.promoted_object?.page_id !== this.creds.pageId || !["ACTIVE", "PAUSED"].includes(adSet.status)
        || !/^\d+$/.test(adSet.daily_budget ?? "0") || !/^\d+$/.test(adSet.lifetime_budget ?? "0")) return null;
      const capped = cappedAdSetIds.includes(adSet.id);
      if (capped ? Number(adSet.daily_budget ?? 0) !== 0 || Number(adSet.lifetime_budget ?? 0) <= 0 : Number(adSet.lifetime_budget ?? 0) !== 0) return null;
      if (!capped) adSetBudget += Number(adSet.daily_budget ?? 0);
    }
    if (!/^\d+$/.test(campaign.daily_budget ?? "0")) return null;
    const campaignBudget = Number(campaign.daily_budget ?? 0);
    const total = campaignBudget > 0 && adSetBudget === 0 ? campaignBudget : campaignBudget === 0 ? adSetBudget : Number.NaN;
    if (!Number.isSafeInteger(total) || total <= 0) return null;
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
    expected: { dailyBudgetRupees: number; status: string; adSetIds: string[]; adIds: string[]; cappedAdSetIds?: string[] },
  ): Promise<CampaignDeliverySnapshot> {
    const snapshot = await this.readCampaignDelivery(campaignId, expected);
    if (snapshot.adSets.some(adSet => adSet.status !== "ACTIVE") || snapshot.ads.some(ad => ad.status !== "ACTIVE")) {
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

  /** Status write with one retry after Meta's 613 (one status change per object per 30 s). */
  private async writeStatus(id: string, status: "ACTIVE" | "PAUSED") {
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

  /** Meta's review state for every ad in the campaign. */
  async readAdReview(campaignId: string): Promise<AdReview[]> {
    await this.verifyCampaignBinding(campaignId);
    const ads = await this.graph<{ data?: Array<{ id: string; effective_status?: string; ad_review_feedback?: unknown; issues_info?: unknown }>; paging?: { next?: string } }>(
      `${encodeURIComponent(campaignId)}/ads?fields=id,status,effective_status,configured_status,ad_review_feedback,issues_info&limit=100`,
    );
    if (!Array.isArray(ads.data) || ads.paging?.next) throw new MetaError("Ad review status could not be read completely.");
    return ads.data.map(adReviewState);
  }
}
