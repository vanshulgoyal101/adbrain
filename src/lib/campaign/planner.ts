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
  excluded_locations: string[];
  rationale: string;
}

export type PlannerQuestionType = "single" | "multi" | "text";

/** A structured question the UI renders as selectable options (Copilot-style). */
export interface PlannerQuestion {
  id: string;
  question: string;
  help?: string;
  type: PlannerQuestionType;
  options?: string[];
  allowText?: boolean;
}

export interface PlannerLLMResult {
  ready: boolean;
  questions?: PlannerQuestion[];
  plan?: CampaignPlan;
}

/** One answered question, sent back to continue the interview. */
export interface PlannerAnswer {
  question: string;
  answer: string;
}

export interface PlannerInput {
  brand: BrandContext;
  instructions?: string;
  approved: { id: string; angle: string | null; headline: string | null }[];
  leadForms: { id: string; name: string }[];
  goal: string;
  answers?: string;
  performance?: string;
}

/** Format structured answers into the transcript the planner reads. */
export function formatAnswers(answers: PlannerAnswer[]): string {
  return answers
    .filter((a) => a.answer.trim())
    .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
    .join("\n\n");
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
        "You are a senior Meta ads strategist for a solar company, interviewing a " +
        "non-technical business owner to plan a lead-generation campaign. Think like " +
        "a helpful assistant that asks ONE screen of clear multiple-choice questions " +
        "at a time. Rules: (1) Only use the creative IDs and lead form IDs provided — " +
        "NEVER invent IDs. (2) If you lack information for a good decision, set " +
        "ready=false and ask concise, CONCRETE questions with sensible options the " +
        "user can click — do not ask open-ended essays. Prefer 2–5 options each; add " +
        "\"allowText\": true when the user may want to type their own. Cover, when " +
        "unknown: which area(s) to TARGET, which nearby areas to EXCLUDE (so they " +
        "don't get out-of-area calls), daily budget, and which offer/angle to push. " +
        "(3) Never fabricate facts, prices, or guarantees. (4) Keep the audience " +
        "simple (a sensible age range). (5) LOCATION MATTERS for a local installer: " +
        "use the brand's Areas or an area named in the goal for `locations`, and put " +
        "nearby unwanted towns in `excluded_locations`. Ask instead of guessing when " +
        "it matters. Output ONLY valid JSON.",
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
${input.performance ? `\nPAST CAMPAIGNS & RESULTS (learn from these to improve — favour angles/areas that produced cheaper leads; you may adapt them, you don't have to reuse):\n${input.performance}\n` : ""}
USER GOAL: ${input.goal}
${input.answers ? `\nANSWERS SO FAR:\n${input.answers}\n` : ""}
If you have enough info, return:
{"ready": true, "plan": {"name": string, "daily_budget_rupees": number, "lead_form_id": string, "creative_ids": string[], "age_min": number, "age_max": number, "locations": string[], "excluded_locations": string[], "rationale": string}}
If you need more info, return:
{"ready": false, "questions": [{"id": string, "question": string, "help": string, "type": "single"|"multi"|"text", "options": string[], "allowText": boolean}]}`,
    },
  ];
}

export async function runPlanner(
  input: PlannerInput,
): Promise<PlannerLLMResult> {
  return completeJSON<PlannerLLMResult>(buildPlannerMessages(input), {
    temperature: 0.4,
    maxTokens: 1500,
  });
}
