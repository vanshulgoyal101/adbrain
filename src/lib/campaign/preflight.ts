import { effectiveDailyBudget } from "@/lib/campaign/spend";
import type { DraftInput, ReviewDTO } from "@/lib/campaign/connect-contracts";
import type { SelectedAssets } from "@/lib/meta/connect-contracts";

export interface PreflightCreative {
  id: string;
  businessId: string;
  approved: boolean;
  imageUrl: string | null;
  headline: string | null;
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
  resolvedAreaLabel: string | null;
  unresolvedNames: string[];
  explicitlyNationwide: boolean;
}

export interface PreflightInput {
  draft: DraftInput;
  draftId: string;
  draftVersion: number;
  connection: PreflightConnection | null;
  creatives: PreflightCreative[];
  form: PreflightForm | null;
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
  businessId: string;
  draftId: string;
  draftVersion: number;
  connectionGeneration: number | null;
  selected: SelectedAssets | null;
  creativeIds: string[];
  leadFormId: string | null;
  dailyBudgetRupees: number;
  abTest: boolean;
  targeting: DraftInput["targeting"];
  resolvedAreaLabel: string | null;
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
    leadFormId: input.draft.leadFormId,
    dailyBudgetRupees: input.draft.dailyBudgetRupees,
    abTest: input.draft.abTest,
    targeting: input.draft.targeting,
    resolvedAreaLabel: input.geo.resolvedAreaLabel,
  };
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
  if (!draft.leadFormId || !input.form || input.form.id !== draft.leadFormId || input.form.businessId !== draft.businessId || !input.form.active) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "Choose an active lead form belonging to this business."));
  }
  if (draft.dailyBudgetRupees <= 0) {
    blockers.push(blocker("INVALID_INPUT", "Daily budget must be greater than zero before preparation."));
  }
  if (input.geo.unresolvedNames.length || (!input.geo.resolvedAreaLabel && !input.geo.explicitlyNationwide)) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "Resolve every selected service area or explicitly review nationwide targeting."));
  }

  const adSetCount = draft.abTest ? 2 : 1;
  const perAdSetDailyBudgetRupees = draft.dailyBudgetRupees;
  const totalDailyBudgetRupees = effectiveDailyBudget(perAdSetDailyBudgetRupees, adSetCount);
  const payload = buildCanonicalReviewPayload(input);
  const planHash = blockers.length ? null : input.hash(canonicalJson(payload));

  return {
    draftId: input.draftId,
    draftVersion: input.draftVersion,
    connectionGeneration: input.connection?.generation ?? 0,
    canCreatePaused: blockers.length === 0,
    blockers,
    planHash,
    currency: "INR",
    perAdSetDailyBudgetRupees,
    adSetCount,
    totalDailyBudgetRupees,
    resolvedAreaLabel: input.geo.resolvedAreaLabel,
    selected: input.connection?.selected ?? null,
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