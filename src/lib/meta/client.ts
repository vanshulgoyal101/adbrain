import { getEnv } from "@/lib/env";

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

export interface CreativeInput {
  imageUrl: string;
  headline: string;
  message: string;
  cta?: string | null;
}

/** A resolved Meta geo-targeting spec (subset of the targeting `geo_locations`). */
export interface GeoTargeting {
  countries?: string[];
  regions?: { key: string }[];
  cities?: { key: string; radius?: number; distance_unit?: string }[];
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
  adIds: string[];
  destination: AdDestination;
}

export interface CampaignInsights {
  impressions: number;
  clicks: number;
  leads: number;
  spend: number;
  cpl: number | null;
}

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
  ) {
    super(message);
    this.name = "MetaError";
  }
}

/** Human CTA label → Meta call_to_action enum. */
const CTA_MAP: Record<string, string> = {
  "Get Quote": "GET_QUOTE",
  "Learn More": "LEARN_MORE",
  "Contact Us": "CONTACT_US",
  "Sign Up": "SIGN_UP",
  "Get Offer": "GET_OFFER",
  "Book Now": "BOOK_NOW",
  "Call Now": "CALL_NOW",
};

function ctaType(label?: string | null): string {
  return (label && CTA_MAP[label]) || "LEARN_MORE";
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

/** The creative call-to-action for a lead destination. */
export function destinationCTA(
  dest: AdDestination,
  opts: { leadFormId?: string; phone?: string; ctaLabel?: string | null },
): { type: string; value: Record<string, unknown> } {
  if (dest === "call" && opts.phone) {
    return { type: "CALL_NOW", value: { link: `tel:${opts.phone}` } };
  }
  if (dest === "whatsapp") {
    return { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } };
  }
  return {
    type: ctaType(opts.ctaLabel),
    value: { lead_gen_form_id: opts.leadFormId },
  };
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
 * results already ranked by relevance/audience size, so we preserve that order
 * and only (1) prefer the requested country and (2) prefer a city, then a
 * region, then a country. This keeps the canonical "Jaipur" (Rajasthan) ahead
 * of same-named smaller towns.
 */
export function pickBestGeoMatch(
  matches: GeoSearchResult[],
  query: string,
  preferCountry = "IN",
): GeoSearchResult | null {
  void query;
  if (!matches.length) return null;
  const inCountry = preferCountry
    ? matches.filter((m) => !m.country_code || m.country_code === preferCountry)
    : matches;
  const pool = inCountry.length ? inCountry : matches;
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
        radius: clampRadiusKm(item.radiusKm ?? defaultRadiusKm),
        distance_unit: "kilometer",
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

/** Read Solaride's single-tenant credentials from the environment. */
export function getSolarideCredentialsFromEnv(): MetaCredentials | null {
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
  return getSolarideCredentialsFromEnv() !== null;
}

export function metaClientFromEnv(): MetaClient | null {
  const creds = getSolarideCredentialsFromEnv();
  return creds ? new MetaClient(creds) : null;
}

/**
 * Meta Marketing API wrapper (Graph v21). Creates Advantage+ lead campaigns in
 * PAUSED state (no spend until activated) and reads insights. Validated against
 * a live ad account.
 */
export class MetaClient {
  constructor(private readonly creds: MetaCredentials) {}

  private async graph<T>(
    path: string,
    opts: {
      method?: string;
      token?: string;
      form?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const method = opts.method ?? "GET";
    const token = opts.token ?? this.creds.accessToken;

    let res: Response;
    if (method === "POST") {
      const body = new URLSearchParams({
        ...(opts.form ?? {}),
        access_token: token,
      });
      res = await fetch(`${GRAPH}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    } else {
      const sep = path.includes("?") ? "&" : "?";
      res = await fetch(
        `${GRAPH}/${path}${sep}access_token=${encodeURIComponent(token)}`,
        { method },
      );
    }

    const json = await res.json().catch(() => ({}));
    if (!res.ok || (json as { error?: unknown }).error) {
      const err = (
        json as { error?: { message?: string; error_user_msg?: string } }
      ).error;
      throw new MetaError(
        err?.error_user_msg || err?.message || `Meta HTTP ${res.status}`,
        res.status,
      );
    }
    return json as T;
  }

  async getPageAccessToken(): Promise<string> {
    const data = await this.graph<{ access_token?: string }>(
      `${this.creds.pageId}?fields=access_token`,
    );
    if (!data.access_token) {
      throw new MetaError("Could not retrieve page access token.");
    }
    return data.access_token;
  }

  /** Active instant lead forms on the page. */
  async listLeadForms(): Promise<LeadForm[]> {
    const pageToken = await this.getPageAccessToken();
    const data = await this.graph<{ data: LeadForm[] }>(
      `${this.creds.pageId}/leadgen_forms?fields=id,name,status`,
      { token: pageToken },
    );
    return (data.data ?? []).filter((f) => f.status === "ACTIVE");
  }

  /** Instant-form leads for a given lead form (newest first). */
  async listLeadsForForm(
    formId: string,
    opts: { limit?: number } = {},
  ): Promise<MetaLead[]> {
    const pageToken = await this.getPageAccessToken();
    const data = await this.graph<{ data: MetaLead[] }>(
      `${formId}/leads?fields=id,created_time,field_data&limit=${opts.limit ?? 200}`,
      { token: pageToken },
    );
    return data.data ?? [];
  }

  /** Search Meta's location database for a place name. */
  async searchGeoLocations(
    query: string,
    opts: { types?: string[]; limit?: number } = {},
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
    opts: { radiusKm?: number; preferCountry?: string } = {},
  ): Promise<ResolvedGeo> {
    const radius = clampRadiusKm(opts.radiusKm ?? 25);
    const preferCountry = opts.preferCountry ?? "IN";
    const cities: NonNullable<GeoTargeting["cities"]> = [];
    const regions: NonNullable<GeoTargeting["regions"]> = [];
    const countries: string[] = [];
    const matched: MatchedGeo[] = [];
    const unresolved: string[] = [];
    const seen = new Set<string>();

    for (const raw of names) {
      const name = (raw ?? "").trim();
      if (!name) continue;
      let results: GeoSearchResult[] = [];
      try {
        results = await this.searchGeoLocations(name);
      } catch {
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
        cities.push({ key: best.key, radius, distance_unit: "kilometer" });
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
    const imgRes = await fetch(imageUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!imgRes.ok) {
      throw new MetaError(`Could not fetch creative image (${imgRes.status}).`);
    }
    const b64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
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
  async createLeadCampaign(params: {
    name: string;
    dailyBudgetRupees: number;
    leadFormId: string;
    link: string;
    creatives: CreativeInput[];
    ageMin?: number;
    ageMax?: number;
    location?: GeoTargeting;
    excludedLocation?: GeoTargeting;
    destination?: AdDestination;
    phone?: string;
  }): Promise<CreateCampaignResult> {
    const acct = this.creds.adAccountId;
    const requested = params.destination ?? "instant_form";

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
        objective: "OUTCOME_LEADS",
        status: "PAUSED",
        special_ad_categories: "[]",
        is_adset_budget_sharing_enabled: "false",
      },
    });

    const targeting = JSON.stringify({
      geo_locations: {
        ...buildGeoLocations(params.location, ["IN"]),
        // Residents only — not travellers/visitors — to avoid out-of-area leads.
        location_types: ["home"],
      },
      ...(hasGeo(params.excludedLocation)
        ? {
            excluded_geo_locations: buildGeoLocations(
              params.excludedLocation,
              [],
            ),
          }
        : {}),
      ...(params.ageMin ? { age_min: params.ageMin } : {}),
      ...(params.ageMax ? { age_max: params.ageMax } : {}),
      targeting_automation: { advantage_audience: 1 },
    });

    const makeAdSet = (dest: AdDestination) => {
      const dp = destinationPlan(dest);
      return this.graph<{ id: string }>(`${acct}/adsets`, {
        method: "POST",
        form: {
          name: `${params.name} — Ad set`,
          campaign_id: campaign.id,
          status: "PAUSED",
          daily_budget: String(Math.round(params.dailyBudgetRupees * 100)),
          billing_event: "IMPRESSIONS",
          optimization_goal: dp.optimizationGoal,
          bid_strategy: "LOWEST_COST_WITHOUT_CAP",
          destination_type: dp.destinationType,
          promoted_object: JSON.stringify({ page_id: this.creds.pageId }),
          targeting,
        },
      });
    };

    // Try the requested destination; fall back to an instant form if Meta
    // rejects it (e.g. WhatsApp not connected, or call ads not enabled).
    let destination = requested;
    let adSet: { id: string };
    try {
      adSet = await makeAdSet(requested);
    } catch (err) {
      if (requested === "instant_form") throw err;
      destination = "instant_form";
      adSet = await makeAdSet("instant_form");
    }

    const adIds: string[] = [];
    for (const c of params.creatives) {
      const imageHash = await this.uploadAdImage(c.imageUrl);
      const creative = await this.graph<{ id: string }>(
        `${acct}/adcreatives`,
        {
          method: "POST",
          form: {
            name: c.headline.slice(0, 90) || "AdBrain creative",
            object_story_spec: JSON.stringify({
              page_id: this.creds.pageId,
              link_data: {
                image_hash: imageHash,
                message: c.message,
                name: c.headline,
                link: params.link,
                call_to_action: destinationCTA(destination, {
                  leadFormId: params.leadFormId,
                  phone,
                  ctaLabel: c.cta,
                }),
              },
            }),
          },
        },
      );

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
    }

    return { campaignId: campaign.id, adSetId: adSet.id, adIds, destination };
  }

  async listCampaigns(limit = 200): Promise<MetaCampaignSummary[]> {
    const data = await this.graph<{ data: MetaCampaignSummary[] }>(
      `${this.creds.adAccountId}/campaigns?fields=id,name,status,objective,daily_budget,effective_status,created_time&limit=${limit}`,
    );
    return data.data ?? [];
  }

  async getCampaignInsights(campaignId: string): Promise<CampaignInsights> {
    const data = await this.graph<{
      data: Array<{
        impressions?: string;
        clicks?: string;
        spend?: string;
        actions?: Array<{ action_type: string; value: string }>;
      }>;
    }>(`${campaignId}/insights?fields=impressions,clicks,spend,actions`);

    const row = data.data?.[0];
    const impressions = Number(row?.impressions ?? 0);
    const clicks = Number(row?.clicks ?? 0);
    const spend = Number(row?.spend ?? 0);
    const leadAction = row?.actions?.find((a) =>
      a.action_type.includes("lead"),
    );
    const leads = Number(leadAction?.value ?? 0);
    const cpl = leads > 0 ? spend / leads : null;
    return { impressions, clicks, leads, spend, cpl };
  }

  async deleteObject(id: string): Promise<void> {
    await this.graph(`${id}`, { method: "DELETE" });
  }
}
