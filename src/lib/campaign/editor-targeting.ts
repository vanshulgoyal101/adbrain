import { z } from "zod";
import { AD_LANGUAGE_KEYS } from "@/lib/meta/locales";
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
/** #773: the Manage → Edit audience form; blank fields keep what the campaign has. */
export interface AudienceEditForm {
  included: GeoPick[];
  excluded: GeoPick[];
  cityScope: "city_only" | "radius";
  radiusKm: number;
  ageMin: number | null;
  ageMax: number | null;
  gender: "keep" | "all" | "men" | "women";
  /** "keep" leaves the ad set's languages; "any" removes the limit; "only" targets `languages`. */
  languageMode: "keep" | "any" | "only";
  languages: number[];
  /** Add #741's out-of-area exclusions to the current area (campaigns built before the rule). */
  areaExclusions: boolean;
}

const placeSchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9]{1,64}$/), name: z.string().max(200), type: z.string().max(30), region: z.string().max(200).nullable().optional(),
}).strict();
/** #773: the form as the owner filled it (place names included), kept with a change saved for a running campaign's next run. */
export const audienceEditFormSchema: z.ZodType<AudienceEditForm> = z.object({
  included: z.array(placeSchema).max(50), excluded: z.array(placeSchema).max(50),
  cityScope: z.enum(["city_only", "radius"]), radiusKm: z.number().finite().min(1).max(80),
  ageMin: z.number().int().min(18).max(65).nullable(), ageMax: z.number().int().min(18).max(65).nullable(),
  gender: z.enum(["keep", "all", "men", "women"]), languageMode: z.enum(["keep", "any", "only"]),
  languages: z.array(z.number().int().refine(key => AD_LANGUAGE_KEYS.has(key))).max(AD_LANGUAGE_KEYS.size), areaExclusions: z.boolean(),
}).strict();

/** #773: the form of the change saved in `campaigns.raw.preparedAudience` for the next run, if any. */
export function preparedAudienceForm(raw: unknown): AudienceEditForm | null {
  const prepared = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { preparedAudience?: { form?: unknown } }).preparedAudience : undefined;
  const parsed = audienceEditFormSchema.safeParse(prepared && typeof prepared === "object" ? prepared.form : undefined);
  return parsed.success ? parsed.data : null;
}

type GeoSpec = {
  cities?: Array<{ key: string; radius?: number; distance_unit?: "kilometer" }>;
  regions?: Array<{ key: string }>;
  countries?: string[];
};

/** The body `POST /api/campaigns/[id]/audience` takes as `change`. */
export type AudienceChangeBody = {
  location?: GeoSpec;
  excludedLocation?: GeoSpec;
  age?: { min: number; max: number };
  gender?: "all" | "men" | "women";
  languages?: number[];
  areaExclusions?: true;
};

export const emptyAudienceEdit: AudienceEditForm = { included: [], excluded: [], cityScope: "radius", radiusKm: 25, ageMin: null, ageMax: null, gender: "keep", languageMode: "keep", languages: [], areaExclusions: false };

function geoSpec(places: GeoPick[], form: AudienceEditForm): GeoSpec | undefined {
  const radius = Math.min(80, Math.max(1, Math.round(form.radiusKm)));
  const seen = new Set<string>();
  const spec: GeoSpec = {};
  for (const place of places) {
    if (!/^[A-Za-z0-9]+$/.test(place.key) || seen.has(`${place.type}:${place.key}`)) continue;
    seen.add(`${place.type}:${place.key}`);
    if (place.type === "city") (spec.cities ??= []).push({ key: place.key, ...form.cityScope === "radius" ? { radius, distance_unit: "kilometer" as const } : {} });
    else if (place.type === "region") (spec.regions ??= []).push({ key: place.key });
    else if (place.type === "country") (spec.countries ??= []).push(place.key.toUpperCase());
  }
  return Object.keys(spec).length ? spec : undefined;
}

/** The change to send, or why it can't be sent yet. */
export function audienceChangeFromForm(form: AudienceEditForm): { change: AudienceChangeBody } | { error: string } {
  const change: AudienceChangeBody = {};
  const location = geoSpec(form.included, form);
  const excludedLocation = geoSpec(form.excluded, form);
  if (location) change.location = location;
  if (excludedLocation) change.excludedLocation = excludedLocation;
  if (form.ageMin !== null || form.ageMax !== null) {
    const { ageMin: min, ageMax: max } = form;
    if (min === null || max === null) return { error: "Enter both ages, or leave both blank to keep them." };
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 18 || max > 65 || min > max) return { error: "Ages go from 18 to 65, youngest first." };
    change.age = { min, max };
  }
  if (form.gender !== "keep") change.gender = form.gender;
  // A new area brings its own exclusions.
  if (form.areaExclusions && !location) change.areaExclusions = true;
  if (form.languageMode === "any") change.languages = [];
  if (form.languageMode === "only") {
    if (!form.languages.length) return { error: "Pick at least one language, or choose Any language." };
    change.languages = [...new Set(form.languages)];
  }
  return Object.keys(change).length ? { change } : { error: "Change the area, an exclusion, the ages, who sees the ads or the language." };
}
