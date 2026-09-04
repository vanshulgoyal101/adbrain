import type { GeoItem } from "@/lib/meta/client";

/** One place as sent from the UI (already carries a Meta key from search). */
export interface TargetingInputItem {
  key: string;
  name: string;
  type: string;
  radiusKm?: number;
}

/** Raw targeting payload posted by the campaign form. */
export interface TargetingInput {
  location?: {
    mode?: "ai" | "manual";
    included?: TargetingInputItem[];
    excluded?: TargetingInputItem[];
    radiusKm?: number;
  };
  age?: {
    mode?: "ai" | "manual";
    min?: number;
    max?: number;
  };
}

export interface NormalizedTargeting {
  locationMode: "ai" | "manual";
  included: GeoItem[];
  excluded: GeoItem[];
  radiusKm: number;
  ageMode: "ai" | "manual";
  ageMin?: number;
  ageMax?: number;
}

const RADIUS_MIN = 5;
const RADIUS_MAX = 80;
const AGE_MIN = 18;
const AGE_MAX = 65;
const VALID_TYPES = new Set(["city", "region", "country"]);

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(Math.max(Math.round(n), lo), hi);
}

/** Age bounds Meta accepts. */
export const AGE_BOUNDS = { min: AGE_MIN, max: AGE_MAX } as const;

/**
 * Settle an age range. Shared with the campaign form so the audience preview
 * can't promise a range the server would silently correct — an inverted range
 * collapses to the lower bound, matching what Meta is actually sent.
 */
export function normalizeAgeRange(
  min: number,
  max: number,
): { min: number; max: number } {
  const lo = clamp(min, AGE_MIN, AGE_MAX);
  return { min: lo, max: clamp(max, lo, AGE_MAX) };
}

function cleanItems(items: TargetingInputItem[] | undefined): GeoItem[] {
  const out: GeoItem[] = [];
  const seen = new Set<string>();
  for (const it of items ?? []) {
    const key = (it?.key ?? "").toString().trim();
    const type = (it?.type ?? "").toString().trim();
    const name = (it?.name ?? "").toString().trim();
    if (!key || !VALID_TYPES.has(type)) continue;
    const dedupe = `${type}:${key}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({
      key,
      name,
      type,
      ...(Number.isFinite(it?.radiusKm)
        ? { radiusKm: clamp(it!.radiusKm as number, RADIUS_MIN, RADIUS_MAX) }
        : {}),
    });
  }
  return out;
}

/**
 * Validate + clamp the campaign form's targeting payload. Pure — no network.
 * "ai" mode means "let AdBrain decide" (server fills from the Brand Brain /
 * sensible defaults); "manual" means honour the user's picks.
 */
export function normalizeTargetingInput(
  raw: TargetingInput | null | undefined,
): NormalizedTargeting {
  const loc = raw?.location ?? {};
  const age = raw?.age ?? {};

  const radiusKm = clamp(Number(loc.radiusKm ?? 25), RADIUS_MIN, RADIUS_MAX);
  const included = cleanItems(loc.included);
  const excluded = cleanItems(loc.excluded);
  const locationMode = loc.mode === "manual" ? "manual" : "ai";

  const ageMode = age.mode === "manual" ? "manual" : "ai";
  let ageMin: number | undefined;
  let ageMax: number | undefined;
  if (ageMode === "manual") {
    const settled = normalizeAgeRange(Number(age.min ?? 25), Number(age.max ?? 55));
    ageMin = settled.min;
    ageMax = settled.max;
  }

  return { locationMode, included, excluded, radiusKm, ageMode, ageMin, ageMax };
}

/** Human, plain-language description of who an ad will reach. */
export function describeAudience(t: {
  areaLabel: string;
  excluded: GeoItem[];
  ageMode: "ai" | "manual";
  ageMin?: number;
  ageMax?: number;
}): string {
  const parts: string[] = [`People in ${t.areaLabel}`];
  if (t.excluded.length) {
    parts.push(`excluding ${t.excluded.map((e) => e.name).join(", ")}`);
  }
  if (t.ageMode === "manual" && t.ageMin && t.ageMax) {
    parts.push(`ages ${t.ageMin}–${t.ageMax}`);
  } else {
    parts.push("ages chosen by Meta Advantage+");
  }
  return parts.join(", ") + ".";
}
