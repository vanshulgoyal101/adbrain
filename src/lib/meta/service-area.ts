import type { GeoTargeting } from "./client";

/**
 * #741 (owner, Oct 26): every ad set excludes everything outside the service area, because Meta
 * otherwise serves well beyond the targeted cities. Pure: the client resolves the included places'
 * regions from Meta (by key) and passes them in.
 */

/** India's 36 state/UT keys from Meta's Targeting Search (`locale=en_US`, recorded in tests/core/fixtures/meta/geo-exclusions.json). */
export const INDIA_REGION_KEYS = [
  "1723", "1724", "1725", "1726", "1727", "1728", "1729", "1730", "1731", "1732", "1733", "1734",
  "1735", "1736", "1737", "1738", "1739", "1740", "1741", "1742", "1743", "1744", "1745", "1746",
  "1747", "1748", "1749", "1750", "1751", "1752", "1753", "1754", "1755", "1756", "1757", "4100",
] as const;

type KnownCity = { key: string; name: string; region: string; lat: number; lng: number };

/** Places whose position we know, so a service radius can be measured (keys from Meta's Targeting Search). */
const SERVICE_CITIES: KnownCity[] = [
  { key: "1021145", name: "Chandigarh", region: "1726", lat: 30.7333, lng: 76.7794 },
  { key: "1035473", name: "Mohali", region: "1742", lat: 30.7046, lng: 76.7179 },
  { key: "2676092", name: "Panchkula", region: "1730", lat: 30.6942, lng: 76.8606 },
];

/** Larger Punjab and Haryana cities to exclude when they lie outside the service area. */
export const EXCLUDABLE_CITIES: KnownCity[] = [
  { key: "1033379", name: "Ludhiana", region: "1742", lat: 30.9, lng: 75.85 },
  { key: "1016294", name: "Amritsar", region: "1742", lat: 31.63, lng: 74.87 },
  { key: "1027716", name: "Jalandhar", region: "1742", lat: 31.33, lng: 75.58 },
  { key: "1038870", name: "Patiala", region: "1742", lat: 30.34, lng: 76.39 },
  { key: "2674292", name: "Bathinda", region: "1742", lat: 30.21, lng: 74.95 },
  { key: "1016128", name: "Ambala", region: "1730", lat: 30.38, lng: 76.78 },
  { key: "1047439", name: "Yamunanagar", region: "1730", lat: 30.13, lng: 77.29 },
  { key: "2676079", name: "Kurukshetra", region: "1730", lat: 29.97, lng: 76.88 },
  { key: "1029837", name: "Karnal", region: "1730", lat: 29.69, lng: 76.99 },
  { key: "1038394", name: "Panipat", region: "1730", lat: 29.39, lng: 76.97 },
  { key: "1027034", name: "Hisar", region: "1730", lat: 29.15, lng: 75.72 },
  { key: "1041296", name: "Rohtak", region: "1730", lat: 28.9, lng: 76.61 },
  { key: "1026297", name: "Gurugram", region: "1730", lat: 28.46, lng: 77.03 },
  { key: "1024627", name: "Faridabad", region: "1730", lat: 28.41, lng: 77.32 },
  { key: "1044013", name: "Sonipat", region: "1730", lat: 28.99, lng: 77.02 },
  { key: "1035456", name: "Moga", region: "1742", lat: 30.82, lng: 75.17 },
  { key: "1027125", name: "Hoshiarpur", region: "1742", lat: 31.53, lng: 75.91 },
  { key: "1038824", name: "Pathankot", region: "1742", lat: 32.27, lng: 75.65 },
  { key: "1024719", name: "Firozpur", region: "1742", lat: 30.93, lng: 74.61 },
  { key: "1042093", name: "Sangrur", region: "1742", lat: 30.25, lng: 75.84 },
  { key: "1018444", name: "Barnala", region: "1742", lat: 30.38, lng: 75.55 },
  { key: "1029615", name: "Kapurthala", region: "1742", lat: 31.38, lng: 75.38 },
  { key: "1039228", name: "Phagwara", region: "1742", lat: 31.22, lng: 75.77 },
  { key: "1035873", name: "Muktsar", region: "1742", lat: 30.47, lng: 74.52 },
  { key: "1024700", name: "Fazilka", region: "1742", lat: 30.4, lng: 74.03 },
  { key: "1034654", name: "Mansa", region: "1742", lat: 29.99, lng: 75.4 },
  { key: "1024628", name: "Faridkot", region: "1742", lat: 30.67, lng: 74.76 },
  { key: "1026295", name: "Gurdaspur", region: "1742", lat: 32.04, lng: 75.4 },
  { key: "1018671", name: "Batala", region: "1742", lat: 31.82, lng: 75.2 },
  { key: "1043687", name: "Sirsa", region: "1730", lat: 29.53, lng: 75.03 },
  { key: "1019700", name: "Bhiwani", region: "1730", lat: 28.79, lng: 76.13 },
  { key: "1028355", name: "Jind", region: "1730", lat: 29.32, lng: 76.31 },
  { key: "1028764", name: "Kaithal", region: "1730", lat: 29.8, lng: 76.4 },
  { key: "1041183", name: "Rewari", region: "1730", lat: 28.2, lng: 76.62 },
  { key: "1028177", name: "Jhajjar", region: "1730", lat: 28.61, lng: 76.66 },
  { key: "1024645", name: "Fatehabad", region: "1730", lat: 29.52, lng: 75.45 },
  { key: "1038220", name: "Palwal", region: "1730", lat: 28.14, lng: 77.33 },
  { key: "1036842", name: "Narnaul", region: "1730", lat: 28.04, lng: 76.11 },
  { key: "1017312", name: "Bahadurgarh", region: "1730", lat: 28.69, lng: 76.94 },
  { key: "1015543", name: "Abohar", region: "1742", lat: 30.14, lng: 74.2 },
  { key: "1034076", name: "Malerkotla", region: "1742", lat: 30.53, lng: 75.88 },
  { key: "1036173", name: "Nabha", region: "1742", lat: 30.37, lng: 76.15 },
];

/** A city further than its own radius plus this from every included place is outside the service area. */
export const SERVICE_BUFFER_KM = 30;

/** An included place as Meta describes it (region and country by key). */
export type IncludedPlace = { key: string; type: "city" | "region" | "country"; regionKey: string | null; countryCode: string | null; radiusKm?: number };

export class TargetingExclusionsMissingError extends Error {
  readonly code = "TARGETING_EXCLUSIONS_MISSING";
  constructor(message = "This campaign has no out-of-area exclusions, so Meta could show it far outside the service area. Review the campaign again.") {
    super(message);
    this.name = "TargetingExclusionsMissingError";
  }
}

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * The exclusions for an Indian service area: every state/UT with no included place, plus the known
 * cities in the kept states that lie outside every included place's radius + {@link SERVICE_BUFFER_KM}.
 * City exclusions need every included city's position; without one, only states are excluded.
 * Returns null when the rule doesn't apply: a country-wide or non-Indian area (QA #741 scope).
 */
export function serviceAreaExclusions(included: IncludedPlace[]): GeoTargeting | null {
  if (!included.length || included.some((place) => place.type === "country" || place.countryCode !== "IN" || !place.regionKey)) return null;
  const keptRegions = new Set(included.map((place) => place.regionKey!));
  const regions = INDIA_REGION_KEYS.filter((key) => !keptRegions.has(key)).map((key) => ({ key }));
  const centres = included.filter((place) => place.type === "city").map((place) => {
    const known = SERVICE_CITIES.find((city) => city.key === place.key) ?? EXCLUDABLE_CITIES.find((city) => city.key === place.key);
    return known ? { ...known, radiusKm: place.radiusKm ?? 0 } : null;
  });
  const includedKeys = new Set(included.map((place) => place.key));
  const cities = centres.some((centre) => !centre) ? [] : EXCLUDABLE_CITIES
    .filter((city) => keptRegions.has(city.region) && !includedKeys.has(city.key))
    .filter((city) => centres.every((centre) => km(centre!, city) >= centre!.radiusKm + SERVICE_BUFFER_KM))
    .map((city) => ({ key: city.key }));
  return { regions, ...(cities.length ? { cities } : {}) };
}

/** Adds the service-area exclusions to the owner's own (de-duplicated by key). */
export function mergeExclusions(owner: GeoTargeting | undefined, area: GeoTargeting | null): GeoTargeting | undefined {
  if (!area) return owner;
  const byKey = <T extends { key: string }>(lists: (T[] | undefined)[]) => {
    const seen = new Map<string, T>();
    for (const item of lists.flatMap((list) => list ?? [])) if (!seen.has(item.key)) seen.set(item.key, item);
    return [...seen.values()];
  };
  const regions = byKey([owner?.regions, area.regions]);
  const cities = byKey([owner?.cities, area.cities]);
  return { ...(owner?.countries?.length ? { countries: owner.countries } : {}), ...(regions.length ? { regions } : {}), ...(cities.length ? { cities } : {}) };
}

type TargetingLike = { geo_locations?: { cities?: { country?: string }[]; regions?: { country?: string }[]; countries?: string[] }; excluded_geo_locations?: { regions?: unknown[] } };

/** #741: an ad set that targets places in India but excludes no state was built before the rule. */
export function lacksAreaExclusions(targeting: unknown): boolean {
  const value = (targeting && typeof targeting === "object" ? targeting : {}) as TargetingLike;
  const geo = value.geo_locations ?? {};
  if (geo.countries?.length) return false;
  const indian = [...(geo.cities ?? []), ...(geo.regions ?? [])].some((place) => place.country === "IN");
  return indian && !(value.excluded_geo_locations?.regions?.length);
}
