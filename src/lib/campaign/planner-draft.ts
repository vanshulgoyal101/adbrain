import { z } from "zod";
import { draftInputSchema, type DraftInput } from "@/lib/campaign/connect-contracts";
import { normalizeAgeRange } from "@/lib/campaign/targeting";

const plannerPlanSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    daily_budget_rupees: z.number().finite().int().positive().max(10_000_000),
    lead_form_id: z.string().trim().min(1).max(128).nullable().default(null),
    creative_ids: z.array(z.string().uuid()).min(1).max(50),
    age_min: z.number().finite().int().min(18).max(65),
    age_max: z.number().finite().int().min(18).max(65),
    locations: z.array(z.string().trim().min(1).max(200)).max(50),
    excluded_locations: z.array(z.string().trim().min(1).max(200)).max(50),
    destination: z.enum(["instant_form", "whatsapp", "call"]),
    rationale: z.string().trim().max(2_000),
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

export function plannerPlanToDraftInput(input: {
  businessId: string;
  goal: string;
  plan: unknown;
  approvedCreativeIds: string[];
  leadFormIds: string[];
  knownLocations?: PlannerDraftLocation[];
}): PlannerDraftResult {
  const parsed = plannerPlanSchema.safeParse(input.plan);
  if (!parsed.success) return { ok: false, error: "Planner returned an invalid campaign draft." };

  const plan: PlannerPlanInput = parsed.data;
  if (plan.destination !== "instant_form") return { ok: false, error: "This campaign editor supports instant lead forms. Choose an instant-form campaign." };
  const approved = new Set(input.approvedCreativeIds);
  const creativeIds = [...new Set(plan.creative_ids)];
  if (creativeIds.some((id) => !approved.has(id))) return { ok: false, error: "Planner did not choose an approved creative." };

  const leadForms = new Set(input.leadFormIds);
  if (plan.lead_form_id !== null && !leadForms.has(plan.lead_form_id)) {
    return { ok: false, error: "Planner chose a lead form that is not available." };
  }

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
    leadFormId: plan.lead_form_id,
    targeting: {
      location: {
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
    },
    abTest: false,
  };

  const checked = draftInputSchema.safeParse(draft);
  if (!checked.success) return { ok: false, error: "Planner draft did not match the campaign contract." };
  return { ok: true, draft: checked.data };
}