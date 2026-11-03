import { adPolicyHits, isHealthPromise } from "@/lib/campaign/ad-policy";
import type { GeoTargeting } from "@/lib/meta/client";
import { describeServiceArea } from "@/lib/meta/service-area";
import { effectiveDailyBudget } from "@/lib/campaign/spend";
import type { DraftInput, ReviewDTO } from "@/lib/campaign/connect-contracts";
import type { ReviewBlockerReason, SelectedAssets } from "@/lib/meta/connect-contracts";
import { askMismatchWarning, QUOTED_ASK_WITH_QUESTIONS, reviewWarnings, WHATSAPP_PICTURE_ON_FORM, WHATSAPP_PICTURE_ON_WEBSITE, type ReviewDestination } from "@/lib/campaign/plan-check";
import { quotedAsk, sameWords } from "@/lib/campaign/whatsapp-greeting";
import { batchProofWarning } from "@/lib/creative/proof-line";
import type { ResolvedWhatsAppMessage } from "@/lib/campaign/whatsapp-template";
import { translator, type AppLocale } from "@/i18n/locale";
import type { WebsiteReach } from "@/lib/campaign/website-reach";
import { isAdvertiserWebsite, websiteAdLink, websiteBlocker } from "@/lib/campaign/website-review";
import { creativesBlockerMessage, named, trackingBlockerWords, websiteBlockerWords } from "@/lib/campaign/review-blocker-words";
import { conversionGoal, goalWordsMismatch, trackingBlocker, type ReviewTracking } from "@/lib/campaign/website-tracking";

/** #1799: Meta's minimum daily budget per impression-billed ad set in INR (₹95.46, Oct 29), rounded up. */
export const META_MIN_DAILY_BUDGET_RUPEES = 96;

export interface PreflightCreative {
  id: string;
  businessId: string;
  approved: boolean;
  imageUrl: string | null;
  headline: string | null;
  primaryText?: string | null;
  description?: string | null;
  cta?: string | null;
  /** Its saved design can be laid out at 9:16 for Stories and Reels (#333). */
  storyReady?: boolean;
  /** Its picture asks for a WhatsApp message (#1147's contact bar), so a form campaign contradicts it (#1177). */
  asksWhatsApp?: boolean;
  /** The phone its picture prints, from the saved design; null when it prints none (#2274). */
  printedPhone?: string | null;
  /** #784: its picture is the owner's own upload (`creatives.media_asset_id`), so launch needs their rights confirmation. */
  ownMedia?: boolean;
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
  /** #741: the out-of-area exclusions launch will add; null when none apply. */
  areaExclusions?: GeoTargeting | null;
}

export interface PreflightInput {
  draft: DraftInput;
  draftId: string;
  draftVersion: number;
  connection: PreflightConnection | null;
  creatives: PreflightCreative[];
  form: PreflightForm | null;
  whatsappNumber?: string | null;
  /** #840: the WhatsApp message launch will send, and why it can't (claims, links) if so. */
  whatsappMessage?: ResolvedWhatsAppMessage | null;
  whatsappMessageProblem?: string | null;
  /** The business's industry, for the health claim rules (#739). */
  vertical?: string | null;
  /** #418 rule 5: the Brand's facts, for the proof-line warning; none means no warning. */
  brandFacts?: string[];
  /** Business website; undefined when the caller does not check it. */
  website?: string | null;
  /** #2599: whether a website ad's link opens the advertiser's own site; a website ad without it is blocked. */
  websiteReach?: WebsiteReach;
  /** #2714: the Brand's chosen tracking and what Meta reported, for a signup or sales goal; absent = not read. */
  tracking?: ReviewTracking;
  geo: PreflightGeo;
  hash: (payload: string) => string;
  /** The business's own cost per chat or lead for this kind of campaign (#419 2b); unknown when absent. */
  costPerResultRupees?: number | null;
  /** #2274: what Prepare changed on the pictures (the chat number), shown first among the notes. */
  pictureNotice?: string | null;
  /** #2333: the owner's app language for the blocker sentences; English when absent. */
  locale?: AppLocale;
  /** #784: the owner confirmed the current rights terms; undefined when no ad uses their own photos. */
  mediaConsent?: boolean;
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
  whatsappLanguage?: "en" | "hi" | "hinglish" | "pa";
  whatsappOpening?: ResolvedWhatsAppMessage["opening"];
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
  destination: ReviewDestination;
  whatsappNumber: string | null;
  websiteUrl?: string | null;
  websiteGoal?: Exclude<DraftInput["websiteGoal"], "visits">;
  pixelId?: string | null;
  dailyBudgetRupees: number;
  abTest: boolean;
  excludeFacebookReels?: true;
  targeting: DraftInput["targeting"];
  resolvedAreaLabel: string | null;
  audienceInterests?: ReviewDTO["audienceInterests"];
}

type ReviewBlocker = ReviewDTO["blockers"][number];

function blocker(code: ReviewBlocker["code"], reason: ReviewBlockerReason, message: string, action: ReviewBlocker["action"] = null): ReviewBlocker {
  return { code, reason, message, action };
}

function reviewedMessage({ source, opening, language }: ResolvedWhatsAppMessage): NonNullable<ReviewDTO["whatsappMessage"]> {
  return {
    source, language, greeting: opening.greeting, autofill: opening.autofill,
    ...(opening.callButton ? { callButton: true } : {}),
    ...(opening.iceBreakers?.length ? { iceBreakers: opening.iceBreakers } : {}),
  };
}

/** #2452: whether the message launch rebuilt from fresh reads is the one this review checked; launch refuses otherwise. */
export function isReviewedWhatsAppMessage(message: ResolvedWhatsAppMessage, review: Pick<ReviewDTO, "whatsappMessage">): boolean {
  return Boolean(review.whatsappMessage)
    && JSON.stringify(canonicalize(reviewedMessage(message))) === JSON.stringify(canonicalize(review.whatsappMessage));
}

/** The destination Review checks; a draft saved before destinations existed is a form campaign. */
function reviewDestination(draft: DraftInput): ReviewDestination {
  return draft.destination ?? "instant_form";
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
    leadFormId: reviewDestination(input.draft) === "instant_form" ? input.draft.leadFormId : null,
    destination: input.draft.destination ?? "instant_form",
    whatsappNumber: input.draft.destination === "whatsapp" ? input.whatsappNumber ?? null : null,
    // #2599: only for website ads, so other plans keep their hash; a Brand website edit after Review changes the plan.
    ...(reviewDestination(input.draft) === "website" ? { websiteUrl: websiteAdLink(input.website) } : {}),
    // #2710: visits keep the phase-1 hash; conversion goals must never review as traffic.
    ...(input.draft.destination === "website" && input.draft.websiteGoal && input.draft.websiteGoal !== "visits" ? { websiteGoal: input.draft.websiteGoal } : {}),
    // #2714: the tracking launch will optimise for; choosing another one on the Brand after Review changes the plan.
    ...(conversionGoal(input.draft.destination, input.draft.websiteGoal) ? { pixelId: input.tracking?.pixelId ?? null } : {}),
    // #493: only when it changes what's sent, so plans reviewed before this field keep their hash.
    ...(input.draft.destination === "whatsapp" && input.draft.whatsappLanguage && input.draft.whatsappLanguage !== "ad"
      ? { whatsappLanguage: input.draft.whatsappLanguage } : {}),
    // #840/#2452: the exact message launch will send, suggested ones too: a suggestion is rebuilt from the Brand's name,
    // offers and areas at launch, so a Brand edit after Review changes the plan and launch refuses it.
    ...(input.draft.destination === "whatsapp" && input.whatsappMessage
      ? { whatsappOpening: input.whatsappMessage.opening } : {}),
    dailyBudgetRupees: input.draft.dailyBudgetRupees,
    abTest: input.draft.abTest,
    // #2273: only when on, so plans reviewed before this field keep their hash.
    ...(input.draft.excludeFacebookReels ? { excludeFacebookReels: true as const } : {}),
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
  const say = translator(input.locale ?? "en", "review");
  const destination = reviewDestination(draft);

  if (!input.connection?.selected) {
    blockers.push(blocker("SETUP_REQUIRED", "REVIEW_NO_META_CONNECTION", say("noMetaConnection")));
  } else if (input.connection.selected.currency !== "INR") {
    blockers.push(blocker("UNSUPPORTED_CURRENCY", "REVIEW_CURRENCY", say("currency")));
  }
  // No connection is one fix (connect), not two (#688).
  if (input.connection && !input.connection.canCreatePaused) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_META_ACCESS", say("metaAccess")));
  }

  const creativesProblem = creativesBlockerMessage(draft, input.creatives, say);
  if (creativesProblem) blockers.push(blocker("FORBIDDEN", "REVIEW_CREATIVES", creativesProblem));
  if (draft.destination === "whatsapp") {
    // #681: without Meta access the number can't be read; the connection blocker above is the one fix.
    if (input.connection?.canCreatePaused && (!input.whatsappNumber || !/^\+[1-9]\d{6,14}$/.test(input.whatsappNumber))) {
      blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_WHATSAPP_NOT_LINKED", say("whatsappNotLinked")));
    }
    if (input.whatsappMessageProblem) {
      blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_WHATSAPP_MESSAGE", say("whatsappMessage", { problem: input.whatsappMessageProblem })));
    }
  } else if (destination === "instant_form" && (!draft.leadFormId || !input.form || input.form.id !== draft.leadFormId || input.form.businessId !== draft.businessId || !input.form.active)) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_NO_LEAD_FORM", say("noLeadForm")));
  }
  if (destination === "website") {
    const websiteProblem = websiteBlocker(input.website ?? null, input.websiteReach);
    if (websiteProblem) {
      const reason = websiteProblem.missing ? "REVIEW_NO_WEBSITE" : "REVIEW_WEBSITE_UNREACHABLE";
      blockers.push(blocker("PREFLIGHT_BLOCKED", reason, websiteBlockerWords(websiteProblem, say), { kind: "open_brand" }));
    }
    const goal = conversionGoal(draft.destination, draft.websiteGoal);
    // #2714: a signup or sales goal is measured by the Brand's chosen tracking; a connection blocker is the one fix first.
    const trackingProblem = goal && input.connection?.canCreatePaused ? trackingBlocker(goal, input.tracking) : null;
    if (goal && trackingProblem) {
      blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_TRACKING", trackingBlockerWords(trackingProblem, goal, say, input.locale ?? "en"), { kind: "open_brand" }));
    }
    const wrongWords = goal ? goalWordsMismatch(goal, input.creatives) : null;
    if (goal && wrongWords) {
      blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_GOAL_WORDS", say("goalWords", { goal, named: wrongWords.headline ? "yes" : "no", headline: wrongWords.headline ?? "" })));
    }
  } else if (destination !== "whatsapp" && input.website !== undefined && !isAdvertiserWebsite(input.website)) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_NO_WEBSITE", say("noWebsite"), { kind: "open_brand" }));
  }
  if (input.mediaConsent === false && input.creatives.some((creative) => creative.ownMedia)) blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_MEDIA_RIGHTS", say("mediaRights")));
  const policyHit = adPolicyHits(input.creatives, input.vertical)[0];
  if (policyHit) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_AD_POLICY", say("adPolicy", {
      term: policyHit.term, named: policyHit.headline == null ? "no" : "yes", headline: policyHit.headline ?? "",
      kind: isHealthPromise(policyHit.term, input.vertical) ? "health" : "other",
    })));
  }
  if (draft.dailyBudgetRupees <= 0) {
    blockers.push(blocker("INVALID_INPUT", "REVIEW_BUDGET", say("budgetZero")));
  } else if (draft.dailyBudgetRupees < META_MIN_DAILY_BUDGET_RUPEES) {
    // #1799: Meta refuses an ad set under its INR minimum (₹95.46 a day for impression-billed WhatsApp and form
    // ad sets, read from the account on Oct 29). Each ad set gets the full daily budget, so this is the floor.
    blockers.push(blocker("INVALID_INPUT", "REVIEW_BUDGET", say("budgetLow", { min: String(META_MIN_DAILY_BUDGET_RUPEES) })));
  }
  const age = draft.targeting.age;
  if (age?.mode === "ai" || age?.min === undefined || age.max === undefined || age.min > age.max) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_NO_AGE_RANGE", say("noAgeRange")));
  }
  const location = draft.targeting.location;
  const radii = [location?.radiusKm, ...(location?.included ?? []).filter((place) => place.type === "city").map((place) => place.radiusKm), ...(location?.excluded ?? []).filter((place) => place.type === "city").map((place) => place.radiusKm)];
  if (location?.cityScope !== "city_only" && radii.some((radius) => radius !== undefined && (radius < 17 || radius > 80))) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_RADIUS", say("radius")));
  }
  if (location?.cityScope === "city_only" && [...(input.geo.location?.cities ?? []), ...(input.geo.excludedLocation?.cities ?? [])].some((city) => city.radius !== undefined || city.distance_unit !== undefined)) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_CITY_RADIUS", say("cityRadius")));
  }
  if (input.geo.unresolvedNames.length || (!input.geo.resolvedAreaLabel && !input.geo.explicitlyNationwide)) {
    const names = input.geo.unresolvedNames;
    blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_AREAS_UNRESOLVED", names.length
      ? say("areasNamed", { count: names.length, names: named(names, say) })
      : say("areasUnnamed")));
  }
  if (!draft.targeting.audience) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_NO_AUDIENCE", say("noAudience")));
  } else if (draft.targeting.audience.interestNames.length && (input.geo.unresolvedInterests?.length || !input.geo.audienceInterests?.length)) {
    const names = input.geo.unresolvedInterests ?? [];
    blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_INTERESTS_UNRESOLVED", names.length
      ? say("interestsNamed", { count: names.length, names: named(names, say) })
      : say("interestsUnnamed")));
  }

  const adSetCount = draft.abTest ? 2 : 1;
  const perAdSetDailyBudgetRupees = draft.dailyBudgetRupees;
  const totalDailyBudgetRupees = effectiveDailyBudget(perAdSetDailyBudgetRupees, adSetCount);
  const payload = buildCanonicalReviewPayload(input);
  const creativeHash = input.hash(JSON.stringify(buildCreativeReviewPayload(input.creatives)));
  const planHash = blockers.length ? null : input.hash(canonicalJson(payload));
  const planWarnings = reviewWarnings({
    destination,
    storyReady: input.creatives.length > 0 && input.creatives.every((creative) => creative.storyReady === true),
    perAdSetDailyBudgetRupees, costPerResultRupees: input.costPerResultRupees,
    websiteGoal: payload.websiteGoal,
  });
  if (input.pictureNotice) planWarnings.unshift(input.pictureNotice);
  // #418 rule 7: an ad that tells customers what to send should match what WhatsApp pre-types. Never a blocker.
  // #1198: with Quick questions there is no ready message, so a quoted ask can't match anything.
  const opening = draft.destination === "whatsapp" ? input.whatsappMessage?.opening : undefined;
  const asks = input.creatives.map((creative) => quotedAsk(creative.primaryText));
  if (opening?.iceBreakers?.length) {
    if (asks.some(Boolean)) planWarnings.push(QUOTED_ASK_WITH_QUESTIONS);
  } else {
    const prefill = opening?.autofill?.trim();
    const mismatch = prefill ? asks.find((ask) => ask && !sameWords(ask, prefill)) : null;
    if (mismatch) planWarnings.push(askMismatchWarning(mismatch, prefill!));
  }
  // #418 rule 5: the Brand has proof (years, jobs, a credential, a warranty) but no chosen ad cites it.
  const proof = batchProofWarning(input.creatives.map((creative) => [creative.headline, creative.primaryText].filter(Boolean).join("\n")), input.brandFacts ?? []);
  if (proof) planWarnings.push(proof);
  // #1177: the picture says "Message us on WhatsApp" but the button opens a form. Never a blocker.
  if (destination !== "whatsapp" && input.creatives.some((creative) => creative.asksWhatsApp)) {
    planWarnings.push(destination === "website" ? WHATSAPP_PICTURE_ON_WEBSITE : WHATSAPP_PICTURE_ON_FORM);
  }

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
    ...(payload.websiteUrl !== undefined ? { websiteUrl: payload.websiteUrl } : {}),
    ...(payload.websiteGoal ? { websiteGoal: payload.websiteGoal } : {}),
    ...(payload.pixelId ? { pixelId: payload.pixelId } : {}),
    currency: "INR",
    perAdSetDailyBudgetRupees,
    adSetCount,
    totalDailyBudgetRupees,
    resolvedAreaLabel: input.geo.resolvedAreaLabel,
    selected: input.connection?.selected ?? null,
    ...(input.geo.location ? { resolvedLocation: input.geo.location } : {}),
    ...(input.geo.excludedLocation ? { resolvedExcludedLocation: input.geo.excludedLocation } : {}),
    ...(input.geo.audienceInterests ? { audienceInterests: [...input.geo.audienceInterests].sort((left, right) => left.id.localeCompare(right.id)) } : {}),
    ...(planWarnings.length ? { planWarnings } : {}),
    ...(draft.destination === "whatsapp" && input.whatsappMessage ? { whatsappMessage: reviewedMessage(input.whatsappMessage) } : {}),
    ...(input.geo.areaExclusions ? { serviceArea: describeServiceArea(input.geo.areaExclusions) } : {}),
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