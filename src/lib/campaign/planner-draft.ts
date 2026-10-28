import { z } from "zod";
import { draftInputSchema, type DraftInput, type TargetingInputDTO } from "@/lib/campaign/connect-contracts";
import { normalizeAgeRange } from "@/lib/campaign/targeting";

export const plannerPlanSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    daily_budget_rupees: z.number().finite().int().positive().max(10_000_000),
    lead_form_id: z.string().trim().min(1).max(128).nullable().default(null),
    creative_ids: z.array(z.string().uuid()).min(1).max(50),
    age_min: z.number().finite().int().min(18).max(65),
    age_max: z.number().finite().int().min(18).max(65),
    radius_km: z.number().finite().int().min(17).max(80).default(25),
    city_scope: z.enum(["city_only", "radius"]).default("city_only"),
    interests: z.array(z.string().trim().min(1).max(100)).min(1).max(5),
    special_ad_category: z.enum(["none", "housing", "employment", "financial_products_services", "issues_elections_politics", "unknown"]),
    locations: z.array(z.string().trim().min(1).max(200)).max(50),
    excluded_locations: z.array(z.string().trim().min(1).max(200)).max(50),
    destination: z.enum(["instant_form", "whatsapp", "call"]),
    rationale: z.string().trim().min(1).max(2_000),
  })
  .strict();

type PlannerPlanInput = z.infer<typeof plannerPlanSchema>;

export type PlannerDraftLocation = {
  key: string;
  name: string;
  type: "city" | "region" | "country";
  radiusKm?: number;
};

export type PlannerDraftResult =
  | { ok: true; draft: DraftInput }
  | { ok: false; error: string };

function locationKey(name: string): string {
  return name.trim().toLowerCase();
}

function selectLocations(
  names: string[],
  knownLocations: PlannerDraftLocation[],
): PlannerDraftLocation[] {
  const knownByName = new Map(knownLocations.map((location) => [locationKey(location.name), location]));
  const selected: PlannerDraftLocation[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const location = knownByName.get(locationKey(name));
    if (!location || seen.has(location.key)) continue;
    seen.add(location.key);
    selected.push(location);
  }
  return selected;
}

/** The planner's rationale describes the interests it asked for; once Meta drops some, state what is actually targeted. */
export function rationaleForMatchedInterests(rationale: string, kept: string[], dropped: string[]): string {
  if (!dropped.length) return rationale;
  const describesInterests = (sentence: string) =>
    /\binterest/i.test(sentence) || dropped.some((name) => sentence.toLowerCase().includes(name.toLowerCase()));
  const rest = (rationale.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !describesInterests(sentence))
    .join(" ");
  const targeted = kept.length
    ? `Interests targeted: ${kept.join(", ")}.`
    : "No interests are targeted, so this plan reaches everyone in the chosen areas and ages.";
  return `${rest} Meta couldn't match: ${dropped.join(", ")}. ${targeted}`.trim().slice(0, 2_000);
}

export const FALLBACK_AUDIENCE_RATIONALE = "AI audience planning was unavailable, so this plan uses your choices plus defaults: ages 25-55 unless you chose them, your saved service areas, and a broad audience without interest narrowing.";

/** Owner-chosen targeting plus fixed defaults, used when the AI planner fails. */
export function fallbackAudienceTargeting(draft: DraftInput): TargetingInputDTO {
  const location = draft.targeting.location ?? {};
  const cityScope = location.cityScope ?? "city_only";
  const { radiusKm, ...rest } = location;
  return {
    gender: draft.targeting.gender ?? "all",
    location: { ...rest, mode: location.mode ?? "ai", cityScope, ...(cityScope === "radius" ? { radiusKm: radiusKm ?? 25 } : {}) },
    age: draft.targeting.age?.mode === "manual" ? draft.targeting.age : { mode: "manual", min: 25, max: 55 },
    audience: { interestNames: [], rationale: FALLBACK_AUDIENCE_RATIONALE },
  };
}

/**
 * #1671 (Analyst #1514): Meta's credit and housing categories cover lenders' own offers and property, not a shop that
 * offers EMI on its kitchens or solar, and not interiors; education isn't employment. A planner label of housing,
 * financial or employment for such a business would block the whole launch, so it is read as none. A lender, an
 * insurer, a property seller or a recruiter keeps its category (and the block).
 */
const LENDER = /\b(?:loans?|lend(?:er|ing)|credit cards?|insurance|mutual funds?|nbfc|finance compan(?:y|ies)|financial services|bank(?:ing)?|mortgages?|invest(?:ment|ing)s?|stock ?brok|forex|crypto)\b/i;
const PROPERTY = /\b(?:real estate|propert(?:y|ies)|builders?|developers?|flats?|apartments?|plots?|villas?|rentals?|for rent|pg|hostels?|co-?living|housing)\b/i;
const RECRUITER = /\b(?:jobs?|recruit(?:er|ment|ing)?|placements?|hiring|staffing|manpower|work permits?)\b/i;
const EDUCATION = /ielts|pte|toefl|celpip|study abroad|overseas education|spoken english|coaching|tuition|classes|academy|institute/i;

export function effectiveSpecialCategory(category: PlannerPlanInput["special_ad_category"], business?: { vertical?: string | null; offers?: string[] | null }) {
  if (!business) return category;
  const about = [business.vertical, ...(business.offers ?? [])].filter(Boolean).join(" \n ");
  if (category === "financial_products_services" && !LENDER.test(about)) return "none";
  if (category === "housing" && !PROPERTY.test(about) && !LENDER.test(about)) return "none";
  if (category === "employment" && EDUCATION.test(about) && !RECRUITER.test(about)) return "none";
  return category;
}

export function plannerPlanToDraftInput(input: {
  businessId: string;
  /** #1671: what the business sells, to tell its own EMI offer from a lender's credit offer. */
  business?: { vertical?: string | null; offers?: string[] | null };
  goal: string;
  plan: unknown;
  approvedCreativeIds: string[];
  leadFormIds: string[];
  knownLocations?: PlannerDraftLocation[];
}): PlannerDraftResult {
  const parsed = plannerPlanSchema.safeParse(input.plan);
  if (!parsed.success) return { ok: false, error: "Planner returned an invalid campaign draft." };

  const plan: PlannerPlanInput = parsed.data;
  if (plan.destination === "call") return { ok: false, error: "Choose an instant lead form or WhatsApp campaign. Call campaigns are not supported." };
  const approved = new Set(input.approvedCreativeIds);
  const creativeIds = [...new Set(plan.creative_ids)];
  if (creativeIds.some((id) => !approved.has(id))) return { ok: false, error: "Planner did not choose an approved creative." };

  const leadForms = new Set(input.leadFormIds);
  if (plan.destination === "instant_form" && plan.lead_form_id !== null && !leadForms.has(plan.lead_form_id)) {
    return { ok: false, error: "Planner chose a lead form that is not available." };
  }

  if (effectiveSpecialCategory(plan.special_ad_category, input.business) !== "none") return { ok: false, error: "This offer needs a special-category review in Meta Ads Manager before demographic targeting can be prepared." };
  if (plan.age_min > plan.age_max) return { ok: false, error: "Planner returned an inverted age range." };
  const age = normalizeAgeRange(plan.age_min, plan.age_max);
  const knownLocations = input.knownLocations ?? [];
  const included = selectLocations(plan.locations, knownLocations);
  const excluded = selectLocations(plan.excluded_locations, knownLocations);
  const draft = {
    businessId: input.businessId,
    name: plan.name,
    goal: input.goal.trim() || plan.rationale || "Create a lead campaign",
    mode: "guided" as const,
    creativeIds,
    dailyBudgetRupees: plan.daily_budget_rupees,
    leadFormId: plan.destination === "whatsapp" ? null : plan.lead_form_id,
    destination: plan.destination,
    targeting: {
      location: {
        cityScope: plan.city_scope,
        ...(plan.city_scope === "radius" ? { radiusKm: plan.radius_km } : {}),
        mode: included.length ? "manual" as const : "ai" as const,
        included,
        excluded,
        includedNames: plan.locations.filter((name) => !included.some((location) => locationKey(location.name) === locationKey(name))),
        excludedNames: plan.excluded_locations.filter((name) => !excluded.some((location) => locationKey(location.name) === locationKey(name))),
      },
      age: {
        mode: "manual" as const,
        min: age.min,
        max: age.max,
      },
      audience: { interestNames: [...new Set(plan.interests)], rationale: plan.rationale },
    },
    abTest: false,
  };

  const checked = draftInputSchema.safeParse(draft);
  if (!checked.success) return { ok: false, error: "Planner draft did not match the campaign contract." };
  return { ok: true, draft: checked.data };
}