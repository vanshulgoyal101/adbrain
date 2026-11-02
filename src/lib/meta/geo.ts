/** Pure place helpers for Meta targeting (moved out of client.ts): match typed places, build `geo_locations`. */
import type { GeoItem, GeoSearchResult, GeoTargeting } from "./client";

/** Meta city-radius bounds (kilometers). */
const RADIUS_MIN_KM = 5;
const RADIUS_MAX_KM = 80;

export function clampRadiusKm(km: number): number {
  if (!Number.isFinite(km)) return 25;
  return Math.min(Math.max(Math.round(km), RADIUS_MIN_KM), RADIUS_MAX_KM);
}

/**
 * Pick the best adgeolocation match for a typed place name. Meta returns
 * Exact names and qualified city/region labels take precedence. Otherwise keep
 * Meta's relevance order within the requested country and preferred place type.
 * #1555: with a country, a place abroad counts only when the owner typed its
 * qualified label ("Austin, Texas"); a bare namesake ('Tricity' → Tri-City,
 * Oregon) is no match, so it comes back unresolved instead of spending abroad.
 */
export function pickBestGeoMatch(
  matches: GeoSearchResult[],
  query: string,
  preferCountry = "",
): GeoSearchResult | null {
  const normalizedQuery = query.trim().toLowerCase();
  const qualified = (match: GeoSearchResult) => Boolean(match.region) && geoLabel(match).trim().toLowerCase() === normalizedQuery;
  const exact = matches.filter((match) => match.name.trim().toLowerCase() === normalizedQuery || qualified(match));
  const byType = (pool: GeoSearchResult[]) => ["city", "region", "country"]
    .map((type) => pool.find((m) => m.type === type)).find(Boolean) ?? pool[0] ?? null;
  if (!preferCountry) return byType(exact.length ? exact : matches);
  const home = (match: GeoSearchResult) => !match.country_code || match.country_code === preferCountry;
  const homeExact = exact.filter(home);
  if (homeExact.length) return byType(homeExact);
  const namedAbroad = exact.filter(qualified);
  if (namedAbroad.length) return byType(namedAbroad);
  return byType(matches.filter(home));
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
export function geoLabel(m: GeoSearchResult): string {
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
