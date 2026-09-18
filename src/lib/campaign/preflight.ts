import { effectiveDailyBudget } from "@/lib/campaign/spend";
import type { DraftInput, ReviewDTO } from "@/lib/campaign/connect-contracts";
import type { SelectedAssets } from "@/lib/meta/connect-contracts";

export interface PreflightCreative {
  id: string;
  businessId: string;
  approved: boolean;
  imageUrl: string | null;
  headline: string | null;
  primaryText?: string | null;
  description?: string | null;
  cta?: string | null;
}

export interface PreflightForm {
  id: string;
  businessId: string;
  active: boolean;
}

export interface PreflightConnection {
  generation: number;
  selected: SelectedAssets | null;
  canCreatePaused: boolean;
}

export interface PreflightGeo {
  location?: ReviewDTO["resolvedLocation"];
  excludedLocation?: ReviewDTO["resolvedExcludedLocation"];
  resolvedAreaLabel: string | null;
  unresolvedNames: string[];
  explicitlyNationwide: boolean;
  audienceInterests?: NonNullable<ReviewDTO["audienceInterests"]>;
  unresolvedInterests?: string[];
}

export interface PreflightInput {
  draft: DraftInput;
  draftId: string;
  draftVersion: number;
  connection: PreflightConnection | null;
  creatives: PreflightCreative[];
  form: PreflightForm | null;
  whatsappNumber?: string | null;
  geo: PreflightGeo;
  hash: (payload: string) => string;
}

export type ReviewFreshnessInput = {
  draftVersion: number;
  connectionGeneration: number;
  planHash: string;
};

export type ReviewFreshnessResult =
  | { fresh: true }
  | {
      fresh: false;
      reason: "DRAFT_CHANGED" | "CONNECTION_CHANGED" | "REVIEW_CHANGED" | "PREFLIGHT_BLOCKED";
    };

export interface CanonicalReviewPayload {
  resolvedLocation?: ReviewDTO["resolvedLocation"];
  resolvedExcludedLocation?: ReviewDTO["resolvedExcludedLocation"];
  businessId: string;
  draftId: string;
  draftVersion: number;
  connectionGeneration: number | null;
  selected: SelectedAssets | null;
  creativeIds: string[];
  creatives: ReturnType<typeof buildCreativeReviewPayload>;
  leadFormId: string | null;
  destination: "instant_form" | "whatsapp";
  whatsappNumber: string | null;
  dailyBudgetRupees: number;
  abTest: boolean;
  targeting: DraftInput["targeting"];
  resolvedAreaLabel: string | null;
  audienceInterests?: ReviewDTO["audienceInterests"];
}

function blocker(code: ReviewDTO["blockers"][number]["code"], message: string) {
  return { code, message, action: null } as const;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function canonicalJson(payload: CanonicalReviewPayload): string {
  return JSON.stringify(canonicalize(payload));
}

export function buildCanonicalReviewPayload(
  input: PreflightInput,
): CanonicalReviewPayload {
  return {
    businessId: input.draft.businessId,
    draftId: input.draftId,
    draftVersion: input.draftVersion,
    connectionGeneration: input.connection?.generation ?? null,
    selected: input.connection?.selected ?? null,
    creativeIds: [...input.draft.creativeIds].sort(),
    creatives: buildCreativeReviewPayload(input.creatives),
    leadFormId: input.draft.destination === "whatsapp" ? null : input.draft.leadFormId,
    destination: input.draft.destination ?? "instant_form",
    whatsappNumber: input.draft.destination === "whatsapp" ? input.whatsappNumber ?? null : null,
    dailyBudgetRupees: input.draft.dailyBudgetRupees,
    abTest: input.draft.abTest,
    targeting: input.draft.targeting,
    resolvedAreaLabel: input.geo.resolvedAreaLabel,
    ...(input.geo.location ? { resolvedLocation: input.geo.location } : {}),
    ...(input.geo.excludedLocation ? { resolvedExcludedLocation: input.geo.excludedLocation } : {}),
    ...(input.geo.audienceInterests ? { audienceInterests: [...input.geo.audienceInterests].sort((left, right) => left.id.localeCompare(right.id)) } : {}),
  };
}

export function buildCreativeReviewPayload(creatives: PreflightCreative[]) {
  return [...creatives].sort((left, right) => left.id.localeCompare(right.id)).map(creative => ({
    id: creative.id,
    imageUrl: creative.imageUrl,
    headline: creative.headline,
    primaryText: creative.primaryText ?? "",
    description: creative.description ?? null,
    cta: creative.cta ?? null,
  }));
}

export function runPreflight(input: PreflightInput): ReviewDTO {
  const blockers: ReviewDTO["blockers"] = [];
  const { draft } = input;

  if (!input.connection?.selected) {
    blockers.push(blocker("SETUP_REQUIRED", "Connect and select a Meta Page and ad account."));
  } else if (input.connection.selected.currency !== "INR") {
    blockers.push(blocker("UNSUPPORTED_CURRENCY", "This campaign requires an INR ad account."));
  }
  if (!input.connection?.canCreatePaused) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "Meta has not confirmed paused campaign creation access."));
  }

  if (
    draft.creativeIds.length === 0 ||
    new Set(draft.creativeIds).size !== draft.creativeIds.length ||
    new Set(input.creatives.map((creative) => creative.id)).size !== input.creatives.length ||
    input.creatives.length !== draft.creativeIds.length ||
    input.creatives.some(
      (creative) =>
        creative.businessId !== draft.businessId ||
        !creative.approved ||
        !creative.imageUrl ||
        !creative.headline ||
        !draft.creativeIds.includes(creative.id),
    )
  ) {
    blockers.push(blocker("FORBIDDEN", "Every selected creative must belong to this business and be approved with an image and headline."));
  }
  if (draft.destination === "whatsapp") {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "WhatsApp publishing is not yet available. You can save this draft or choose an instant form."));
    if (!input.whatsappNumber || !/^\+[1-9]\d{6,14}$/.test(input.whatsappNumber)) {
      blockers.push(blocker("PREFLIGHT_BLOCKED", "Connect a WhatsApp Business number to the selected Facebook Page and verify access before reviewing."));
    }
  } else if (!draft.leadFormId || !input.form || input.form.id !== draft.leadFormId || input.form.businessId !== draft.businessId || !input.form.active) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "Choose an active lead form belonging to this business."));
  }
  if (draft.dailyBudgetRupees <= 0) {
    blockers.push(blocker("INVALID_INPUT", "Daily budget must be greater than zero before preparation."));
  }
  const age = draft.targeting.age;
  if (age?.mode === "ai" || age?.min === undefined || age.max === undefined || age.min > age.max) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "Generate or choose an explicit age range before reviewing the campaign."));
  }
  const location = draft.targeting.location;
  const radii = [location?.radiusKm, ...(location?.included ?? []).filter((place) => place.type === "city").map((place) => place.radiusKm), ...(location?.excluded ?? []).filter((place) => place.type === "city").map((place) => place.radiusKm)];
  if (location?.cityScope !== "city_only" && radii.some((radius) => radius !== undefined && (radius < 17 || radius > 80))) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "Meta city targeting requires a 17-80 km radius. Review the saved radius."));
  }
  if (location?.cityScope === "city_only" && [...(input.geo.location?.cities ?? []), ...(input.geo.excludedLocation?.cities ?? [])].some((city) => city.radius !== undefined || city.distance_unit !== undefined)) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "City-only targeting unexpectedly includes a radius. Review the locations again."));
  }
  if (input.geo.unresolvedNames.length || (!input.geo.resolvedAreaLabel && !input.geo.explicitlyNationwide)) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "Resolve every selected service area or explicitly review nationwide targeting."));
  }
  if (!draft.targeting.audience?.interestNames.length) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "Generate AI detailed targeting before reviewing the campaign."));
  } else if (input.geo.unresolvedInterests?.length || !input.geo.audienceInterests?.length) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "Resolve every audience interest with Meta or edit the audience plan."));
  }

  const adSetCount = draft.abTest ? 2 : 1;
  const perAdSetDailyBudgetRupees = draft.dailyBudgetRupees;
  const totalDailyBudgetRupees = effectiveDailyBudget(perAdSetDailyBudgetRupees, adSetCount);
  const payload = buildCanonicalReviewPayload(input);
  const creativeHash = input.hash(JSON.stringify(buildCreativeReviewPayload(input.creatives)));
  const planHash = blockers.length ? null : input.hash(canonicalJson(payload));

  return {
    draftId: input.draftId,
    draftVersion: input.draftVersion,
    connectionGeneration: input.connection?.generation ?? 0,
    canCreatePaused: blockers.length === 0,
    blockers,
    planHash,
    creativeHash,
    destination: draft.destination ?? "instant_form",
    whatsappNumber: draft.destination === "whatsapp" ? input.whatsappNumber ?? null : null,
    currency: "INR",
    perAdSetDailyBudgetRupees,
    adSetCount,
    totalDailyBudgetRupees,
    resolvedAreaLabel: input.geo.resolvedAreaLabel,
    selected: input.connection?.selected ?? null,
    ...(input.geo.location ? { resolvedLocation: input.geo.location } : {}),
    ...(input.geo.excludedLocation ? { resolvedExcludedLocation: input.geo.excludedLocation } : {}),
    ...(input.geo.audienceInterests ? { audienceInterests: [...input.geo.audienceInterests].sort((left, right) => left.id.localeCompare(right.id)) } : {}),
  };
}

export function checkReviewFreshness(
  review: ReviewDTO,
  expected: ReviewFreshnessInput,
): ReviewFreshnessResult {
  if (!review.canCreatePaused || !review.planHash) {
    return { fresh: false, reason: "PREFLIGHT_BLOCKED" };
  }
  if (review.draftVersion !== expected.draftVersion) {
    return { fresh: false, reason: "DRAFT_CHANGED" };
  }
  if (review.connectionGeneration !== expected.connectionGeneration) {
    return { fresh: false, reason: "CONNECTION_CHANGED" };
  }
  if (review.planHash !== expected.planHash) {
    return { fresh: false, reason: "REVIEW_CHANGED" };
  }
  return { fresh: true };
}