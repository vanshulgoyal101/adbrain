import { completeJSON, type ChatMessage } from "@/lib/llm";
import type { BrandContext } from "@/lib/templates/solar";

export interface CampaignPlan {
  name: string;
  daily_budget_rupees: number;
  lead_form_id: string;
  creative_ids: string[];
  age_min: number;
  age_max: number;
  locations: string[];
  rationale: string;
}

export interface PlannerLLMResult {
  ready: boolean;
  questions?: string[];
  plan?: CampaignPlan;
}

export interface PlannerInput {
  brand: BrandContext;
  instructions?: string;
  approved: { id: string; angle: string | null; headline: string | null }[];
  leadForms: { id: string; name: string }[];
  goal: string;
  answers?: string;
}

function brandLine(brand: BrandContext): string {
  const parts = [brand.name];
  if (brand.description) parts.push(brand.description);
  if (brand.target_audience) parts.push(`Audience: ${brand.target_audience}`);
  if (brand.locations?.length) parts.push(`Areas: ${brand.locations.join(", ")}`);
  if (brand.offers?.length) parts.push(`Offers: ${brand.offers.join("; ")}`);
  return parts.join(" | ");
}

export function buildPlannerMessages(input: PlannerInput): ChatMessage[] {
  const creatives = input.approved
    .map((c) => `- ${c.id}: "${c.headline ?? ""}" (${c.angle ?? "ad"})`)
    .join("\n");
  const forms = input.leadForms
    .map((f) => `- ${f.id}: "${f.name}"`)
    .join("\n");

  return [
    {
      role: "system",
      content:
        "You are a senior Meta ads strategist for a solar company, planning a " +
        "lead-generation campaign. Rules: (1) Only use the creative IDs and lead " +
        "form IDs provided — NEVER invent IDs. (2) If you lack information needed " +
        "for a good decision (e.g. daily budget, which offer/area to push), set " +
        "ready=false and ask concise clarifying questions instead of guessing. " +
        "(3) Never fabricate facts, prices, or guarantees. (4) Meta Advantage+ " +
        "handles fine audience optimization, so keep the audience simple: a " +
        "sensible age range (18–65). (5) LOCATION MATTERS for a local solar " +
        "installer: target the specific cities/areas the business serves. Use the " +
        "brand's listed Areas, or an area the user names in the goal, as " +
        "`locations` (city or state names, e.g. [\"Jaipur\"]). If no area is " +
        "known and it matters, ask instead of guessing. Leave `locations` empty " +
        "ONLY for a deliberately nationwide campaign. Output ONLY valid JSON.",
    },
    {
      role: "user",
      content: `BRAND: ${brandLine(input.brand)}
${input.instructions ? `\nINSTRUCTIONS:\n${input.instructions.slice(0, 3000)}\n` : ""}
APPROVED CREATIVES (choose by ID):
${creatives}

LEAD FORMS (choose one by ID):
${forms}

CURRENCY: INR. Minimum sensible daily budget is ₹150.

USER GOAL: ${input.goal}
${input.answers ? `\nUSER ANSWERS TO YOUR QUESTIONS:\n${input.answers}\n` : ""}
Decide the campaign. If you have enough info, return:
{"ready": true, "plan": {"name": string, "daily_budget_rupees": number, "lead_form_id": string, "creative_ids": string[], "age_min": number, "age_max": number, "locations": string[], "rationale": string}}
If you need more info, return:
{"ready": false, "questions": string[]}`,
    },
  ];
}

export async function runPlanner(
  input: PlannerInput,
): Promise<PlannerLLMResult> {
  return completeJSON<PlannerLLMResult>(buildPlannerMessages(input), {
    temperature: 0.4,
    maxTokens: 1200,
  });
}
