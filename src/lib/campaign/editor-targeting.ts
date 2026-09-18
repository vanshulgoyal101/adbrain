import type { TargetingInputDTO } from "./connect-contracts";

export interface GeoPick {
  key: string;
  name: string;
  type: string;
  region?: string | null;
}

export interface TargetingValue {
  gender?: TargetingInputDTO["gender"];
  locationMode: "ai" | "manual";
  included: GeoPick[];
  excluded: GeoPick[];
  radiusKm: number;
  cityScope?: "city_only" | "radius";
  ageMode: "ai" | "manual";
  ageMin: number;
  ageMax: number;
  audience?: TargetingInputDTO["audience"];
}

export const defaultTargeting: TargetingValue = {
  gender: "all", locationMode: "ai", included: [], excluded: [], radiusKm: 25, cityScope: "city_only",
  ageMode: "ai", ageMin: 25, ageMax: 55,
};

export function targetingToEditor(input: TargetingInputDTO): TargetingValue {
  return {
    gender: input.gender ?? "all",
    locationMode: input.location?.mode ?? defaultTargeting.locationMode,
    included: input.location?.included ?? [],
    excluded: input.location?.excluded ?? [],
    radiusKm: input.location?.radiusKm ?? defaultTargeting.radiusKm,
    cityScope: input.location?.cityScope ?? "radius",
    ageMode: input.age?.mode ?? defaultTargeting.ageMode,
    ageMin: input.age?.min ?? defaultTargeting.ageMin,
    ageMax: input.age?.max ?? defaultTargeting.ageMax,
    audience: input.audience,
  };
}

function draftLocation(place: GeoPick, radiusKm: number, cityScope: TargetingValue["cityScope"]) {
  if (place.type !== "city" && place.type !== "region" && place.type !== "country") return null;
  return { key: place.key, name: place.name, type: place.type, ...(cityScope === "city_only" ? {} : { radiusKm }) } as const;
}

export function targetingFromEditor(
  value: TargetingValue,
  includedNames: string[],
  excludedNames: string[],
): TargetingInputDTO {
  return {
    gender: value.gender ?? "all",
    location: {
      mode: value.locationMode,
      included: value.included.map(place => draftLocation(place, value.radiusKm, value.cityScope)).filter(place => place !== null),
      excluded: value.excluded.map(place => draftLocation(place, value.radiusKm, value.cityScope)).filter(place => place !== null),
      cityScope: value.cityScope ?? "radius",
      ...(value.cityScope === "city_only" ? {} : { radiusKm: value.radiusKm }),
      ...(includedNames.length ? { includedNames } : {}),
      ...(excludedNames.length ? { excludedNames } : {}),
    },
    age: { mode: value.ageMode, min: value.ageMin, max: value.ageMax },
    ...(value.audience ? { audience: {
      ...value.audience,
      interestNames: value.audience.interestNames.map(name => name.trim()).filter(Boolean),
    } } : {}),
  };
}