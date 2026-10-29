import { adPolicyHits } from "@/lib/campaign/ad-policy";
import type { GeoTargeting } from "@/lib/meta/client";
import { describeServiceArea } from "@/lib/meta/service-area";
import { effectiveDailyBudget } from "@/lib/campaign/spend";
import type { DraftInput, ReviewDTO } from "@/lib/campaign/connect-contracts";
import type { ReviewBlockerReason, SelectedAssets } from "@/lib/meta/connect-contracts";
import { normalizeWebsite } from "@/lib/brand/validation";
import { askMismatchWarning, QUOTED_ASK_WITH_QUESTIONS, reviewWarnings, WHATSAPP_PICTURE_ON_FORM } from "@/lib/campaign/plan-check";
import { quotedAsk, sameWords } from "@/lib/campaign/whatsapp-greeting";
import { batchProofWarning } from "@/lib/creative/proof-line";
import type { ResolvedWhatsAppMessage } from "@/lib/campaign/whatsapp-template";

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
  geo: PreflightGeo;
  hash: (payload: string) => string;
  /** The business's own cost per chat or lead for this kind of campaign (#419 2b); unknown when absent. */
  costPerResultRupees?: number | null;
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
  destination: "instant_form" | "whatsapp";
  whatsappNumber: string | null;
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

function adName(creative: PreflightCreative): string {
  const headline = (creative.headline ?? "").trim();
  if (!headline) return "you chose";
  // Whole characters, so a Hindi matra or an emoji is never split.
  const graphemes = Array.from(new Intl.Segmenter("en", { granularity: "grapheme" }).segment(headline), (part) => part.segment);
  if (graphemes.length <= 40) return `"${headline}"`;
  const cut = graphemes.slice(0, 40).join("");
  return `"${(cut.lastIndexOf(" ") > 20 ? cut.slice(0, cut.lastIndexOf(" ")) : cut).trimEnd()}…"`;
}

/** #681: which chosen ad is wrong and what to do about it, not one sentence for every fault. */
function creativesBlockerMessage(draft: PreflightInput["draft"], creatives: PreflightCreative[]): string | null {
  if (draft.creativeIds.length === 0) return "Choose at least one ad to send to Meta.";
  const unique = new Set(draft.creativeIds).size === draft.creativeIds.length;
  const found = creatives.filter((creative) => creative.businessId === draft.businessId && draft.creativeIds.includes(creative.id));
  if (!unique || new Set(creatives.map((creative) => creative.id)).size !== creatives.length || found.length !== creatives.length || found.length !== draft.creativeIds.length) {
    return "One of the ads you chose isn't available any more. Choose your ads again.";
  }
  const problems = found.flatMap((creative) => {
    if (!creative.headline) return ["An ad you chose has no headline. Take it out of this campaign and choose another ad."];
    if (!creative.approved) return [`The ad ${adName(creative)} isn't approved yet. Approve it on the Review page, or take it out of this campaign.`];
    if (!creative.imageUrl) return [`The ad ${adName(creative)} has no picture yet. Take it out of this campaign and choose another ad.`];
    return [];
  });
  if (!problems.length) return null;
  const more = problems.length - 1;
  return more ? `${problems[0]} ${more} more ${more === 1 ? "ad needs" : "ads need"} fixing too.` : problems[0];
}

/** #740: name what Meta didn't recognise, so the owner knows which line to fix. */
function named(names: string[]): string {
  const shown = names.slice(0, 5).map((name) => `"${name}"`);
  const more = names.length > shown.length ? ` and ${names.length - shown.length} more` : "";
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}${more}` : `${shown[0]}${more}`;
}

function isAdvertiserWebsite(website: string | null): boolean {
  // Brands saved before #470 may hold a bare domain.
  const normalized = normalizeWebsite(website);
  if (!normalized) return false;
  const url = new URL(normalized);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  return (url.protocol === "https:" || url.protocol === "http:") &&
    !["facebook.com", "fb.com", "fb.me", "instagram.com", "m.me", "wa.me"].some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
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
    // #493: only when it changes what's sent, so plans reviewed before this field keep their hash.
    ...(input.draft.destination === "whatsapp" && input.draft.whatsappLanguage && input.draft.whatsappLanguage !== "ad"
      ? { whatsappLanguage: input.draft.whatsappLanguage } : {}),
    // #840: an edited or saved message is fixed text, so a change to it needs a new review. A
    // suggestion is derived from what's already here, so plans without one keep their hash.
    ...(input.draft.destination === "whatsapp" && input.whatsappMessage && input.whatsappMessage.source !== "suggested"
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

  if (!input.connection?.selected) {
    blockers.push(blocker("SETUP_REQUIRED", "REVIEW_NO_META_CONNECTION", "Connect Facebook and choose your Page and ad account."));
  } else if (input.connection.selected.currency !== "INR") {
    blockers.push(blocker("UNSUPPORTED_CURRENCY", "REVIEW_CURRENCY", "Choose an ad account that pays in Indian rupees (INR)."));
  }
  // No connection is one fix (connect), not two (#688).
  if (input.connection && !input.connection.canCreatePaused) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_META_ACCESS", "Meta hasn't confirmed AdBrain can create campaigns in this ad account. Connect Facebook again and allow every permission it asks for."));
  }

  const creativesProblem = creativesBlockerMessage(draft, input.creatives);
  if (creativesProblem) blockers.push(blocker("FORBIDDEN", "REVIEW_CREATIVES", creativesProblem));
  if (draft.destination === "whatsapp") {
    if (!input.whatsappNumber || !/^\+[1-9]\d{6,14}$/.test(input.whatsappNumber)) {
      blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_WHATSAPP_NOT_LINKED", "Connect a WhatsApp Business number to the selected Facebook Page and verify access before reviewing."));
    }
    if (input.whatsappMessageProblem) {
      blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_WHATSAPP_MESSAGE", `Your WhatsApp message: ${input.whatsappMessageProblem}`));
    }
  } else if (!draft.leadFormId || !input.form || input.form.id !== draft.leadFormId || input.form.businessId !== draft.businessId || !input.form.active) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_NO_LEAD_FORM", "Choose an active lead form from your Facebook Page in the Lead form field."));
  }
  if (draft.destination !== "whatsapp" && input.website !== undefined && !isAdvertiserWebsite(input.website)) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_NO_WEBSITE", "Add your business website on the Your business page. Meta lead ads must link to the advertiser's own website, not Facebook.", { kind: "open_brand" }));
  }
  const policyHit = adPolicyHits(input.creatives, input.vertical)[0];
  if (policyHit) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_AD_POLICY", `"${policyHit.term}" in the ad "${policyHit.headline ?? "without a headline"}" is a health promise Meta rejects. Edit the ad to describe the service instead.`));
  }
  if (draft.dailyBudgetRupees <= 0) {
    blockers.push(blocker("INVALID_INPUT", "REVIEW_BUDGET", "Set a daily budget above ₹0."));
  } else if (draft.dailyBudgetRupees < META_MIN_DAILY_BUDGET_RUPEES) {
    // #1799: Meta refuses an ad set under its INR minimum (₹95.46 a day for impression-billed WhatsApp and form
    // ad sets, read from the account on Oct 29). Each ad set gets the full daily budget, so this is the floor.
    blockers.push(blocker("INVALID_INPUT", "REVIEW_BUDGET", `Meta needs at least ₹${META_MIN_DAILY_BUDGET_RUPEES} a day. Set a daily budget of ₹${META_MIN_DAILY_BUDGET_RUPEES} or more.`));
  }
  const age = draft.targeting.age;
  if (age?.mode === "ai" || age?.min === undefined || age.max === undefined || age.min > age.max) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_NO_AGE_RANGE", "Choose an age range, or let AdBrain recommend one, before reviewing."));
  }
  const location = draft.targeting.location;
  const radii = [location?.radiusKm, ...(location?.included ?? []).filter((place) => place.type === "city").map((place) => place.radiusKm), ...(location?.excluded ?? []).filter((place) => place.type === "city").map((place) => place.radiusKm)];
  if (location?.cityScope !== "city_only" && radii.some((radius) => radius !== undefined && (radius < 17 || radius > 80))) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_RADIUS", "Set the city radius between 17 and 80 km; Meta allows nothing outside that range."));
  }
  if (location?.cityScope === "city_only" && [...(input.geo.location?.cities ?? []), ...(input.geo.excludedLocation?.cities ?? [])].some((city) => city.radius !== undefined || city.distance_unit !== undefined)) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_CITY_RADIUS", "\"City only\" came back from Meta with a radius. Choose the locations again."));
  }
  if (input.geo.unresolvedNames.length || (!input.geo.resolvedAreaLabel && !input.geo.explicitlyNationwide)) {
    const names = input.geo.unresolvedNames;
    blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_AREAS_UNRESOLVED", names.length
      ? `Meta didn't recognise the area${names.length === 1 ? "" : "s"} ${named(names)}. Fix or remove ${names.length === 1 ? "it" : "them"}, or choose nationwide targeting.`
      : "Meta didn't recognise some of your areas. Fix or remove them, or choose nationwide targeting."));
  }
  if (!draft.targeting.audience) {
    blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_NO_AUDIENCE", "Let AdBrain recommend the audience (Recommend audience) before reviewing."));
  } else if (draft.targeting.audience.interestNames.length && (input.geo.unresolvedInterests?.length || !input.geo.audienceInterests?.length)) {
    const names = input.geo.unresolvedInterests ?? [];
    blockers.push(blocker("PREFLIGHT_BLOCKED", "REVIEW_INTERESTS_UNRESOLVED", names.length
      ? `Meta didn't recognise the interest${names.length === 1 ? "" : "s"} ${named(names)}. Edit or remove ${names.length === 1 ? "it" : "them"}.`
      : "Meta didn't recognise some audience interests. Edit or remove them."));
  }

  const adSetCount = draft.abTest ? 2 : 1;
  const perAdSetDailyBudgetRupees = draft.dailyBudgetRupees;
  const totalDailyBudgetRupees = effectiveDailyBudget(perAdSetDailyBudgetRupees, adSetCount);
  const payload = buildCanonicalReviewPayload(input);
  const creativeHash = input.hash(JSON.stringify(buildCreativeReviewPayload(input.creatives)));
  const planHash = blockers.length ? null : input.hash(canonicalJson(payload));
  const planWarnings = reviewWarnings({
    destination: draft.destination ?? "instant_form",
    storyReady: input.creatives.length > 0 && input.creatives.every((creative) => creative.storyReady === true),
    perAdSetDailyBudgetRupees, costPerResultRupees: input.costPerResultRupees,
  });
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
  if ((draft.destination ?? "instant_form") !== "whatsapp" && input.creatives.some((creative) => creative.asksWhatsApp)) planWarnings.push(WHATSAPP_PICTURE_ON_FORM);

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