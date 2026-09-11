import type { DraftInput } from "./connect-contracts";
import { geoItemsToTargeting, type GeoTargeting, type MetaClient } from "@/lib/meta/client";

function mergeGeo(first: GeoTargeting, second: GeoTargeting): GeoTargeting {
  const countries = [...new Set([...(first.countries ?? []), ...(second.countries ?? [])])];
  const regions = [...new Map([...(first.regions ?? []), ...(second.regions ?? [])].map((region) => [region.key, region])).values()];
  const cities = [...new Map([...(first.cities ?? []), ...(second.cities ?? [])].map((city) => [city.key, city])).values()];
  return { ...(countries.length ? { countries } : {}), ...(regions.length ? { regions } : {}), ...(cities.length ? { cities } : {}) };
}

export async function resolveDraftTargeting(
  input: DraftInput,
  businessLocations: string[],
  resolve: MetaClient["resolveGeoTargeting"],
) {
  const location = input.targeting.location;
  const included = location?.mode === "manual" ? location.included ?? [] : [];
  const excluded = location?.excluded ?? [];
  const includedNames = location?.includedNames?.length ? location.includedNames : location?.mode === "manual" ? [] : businessLocations;
  const excludedNames = location?.excludedNames ?? [];
  const empty = { targeting: {}, matched: [], unresolved: [] };
  const [namedIncluded, namedExcluded] = await Promise.all([
    includedNames.length ? resolve(includedNames, { radiusKm: location?.radiusKm }) : empty,
    excludedNames.length ? resolve(excludedNames, { radiusKm: location?.radiusKm }) : empty,
  ]);
  const targeting = mergeGeo(geoItemsToTargeting(included, location?.radiusKm ?? 25), namedIncluded.targeting);
  const excludedTargeting = mergeGeo(geoItemsToTargeting(excluded, location?.radiusKm ?? 25), namedExcluded.targeting);
  const labels = [...included.map((place) => place.name), ...namedIncluded.matched.map((place) => place.label)];
  const unresolvedNames = [...namedIncluded.unresolved, ...namedExcluded.unresolved];
  if (includedNames.length && !namedIncluded.matched.length) unresolvedNames.push(...includedNames);
  if (excludedNames.length && !namedExcluded.matched.length) unresolvedNames.push(...excludedNames);
  return {
    location: targeting,
    excludedLocation: Object.keys(excludedTargeting).length ? excludedTargeting : undefined,
    resolvedAreaLabel: labels.length ? labels.join(", ") : null,
    unresolvedNames: [...new Set(unresolvedNames)],
    explicitlyNationwide: Boolean(targeting.countries?.length && !targeting.regions?.length && !targeting.cities?.length),
  };
}