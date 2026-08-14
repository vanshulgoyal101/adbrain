import { completeJSON, type ChatMessage } from "@/lib/llm";
import { AD_LANGUAGES } from "@/lib/languages";
import { AD_ANGLES, brandIndustry, type BrandContext } from "@/lib/templates/ads";

/**
 * A single, tap-friendly question the Ad Assistant asks a non-technical user.
 * The UI renders `options` as chips, plus optional shortcuts:
 * - `allowText`   → the user can type their own answer
 * - `allowRandom` → a "Surprise me" button (the AI picks a fun on-brand option)
 * - `aiCanDecide` → a "Let AI decide" button, shown ONLY when the Brand Brain
 *                   already implies a sensible default so the user can skip.
 */
export interface InterviewQuestion {
  id: string;
  question: string;
  help?: string;
  options?: string[];
  allowText?: boolean;
  allowRandom?: boolean;
  aiCanDecide?: boolean;
}

/** One answered question, replayed to continue the interview. */
export interface InterviewAnswer {
  question: string;
  answer: string;
}

export interface InterviewResult {
  /** True when the assistant has enough to write the ad. */
  ready: boolean;
  /** The next single question (when not ready). */
  question?: InterviewQuestion;
  /** A vivid creative brief to generate from (when ready). */
  brief?: string;
  /** An AD_LANGUAGES id, if the user/brand implies a specific language. */
  language?: string;
  /** A preferred AD_ANGLES id, if one clearly fits. */
  angleId?: string;
}

export interface InterviewInput {
  brand: BrandContext;
  instructions?: string;
  goal: string;
  answers?: InterviewAnswer[];
}

/** Format answers into the transcript the interviewer reads. */
export function formatInterviewAnswers(answers: InterviewAnswer[]): string {
  return answers
    .filter((a) => a.answer.trim())
    .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
    .join("\n\n");
}

function brandLine(brand: BrandContext): string {
  const parts = [`${brand.name} (${brandIndustry(brand)})`];
  if (brand.description) parts.push(brand.description);
  if (brand.brand_voice) parts.push(`Voice: ${brand.brand_voice}`);
  if (brand.target_audience) parts.push(`Audience: ${brand.target_audience}`);
  if (brand.usps?.length) parts.push(`USPs: ${brand.usps.join("; ")}`);
  if (brand.offers?.length) parts.push(`Offers: ${brand.offers.join("; ")}`);
  if (brand.languages?.length) parts.push(`Languages: ${brand.languages.join(", ")}`);
  return parts.join(" | ");
}

export function buildInterviewMessages(input: InterviewInput): ChatMessage[] {
  const industry = brandIndustry(input.brand);
  const languageIds = AD_LANGUAGES.map((l) => `${l.id} (${l.label})`).join(", ");
  const angleIds = AD_ANGLES.map((a) => `${a.id} (${a.name})`).join(", ");
  const answers = input.answers?.length
    ? formatInterviewAnswers(input.answers)
    : "";

  return [
    {
      role: "system",
      content:
        `You are an expert ad creative director for a ${industry}, helping a ` +
        "COMPLETELY NON-TECHNICAL owner create ONE great ad with the least effort " +
        "possible. Interview them by asking the FEWEST questions you can, ONE at a " +
        "time. Rules: (1) Use the Brand Brain — never ask for something it already " +
        "tells you. (2) Ask 1–3 questions total — ALWAYS ask at least one so the user " +
        "feels in control — each concrete with 2–5 short, clickable options a " +
        "layperson understands. (3) Set " +
        '"allowText": true when a custom answer helps; set "allowRandom": true when ' +
        "a fun random pick is fine; set \"aiCanDecide\": true ONLY when the Brand " +
        "Brain already implies a sensible default (so the user can safely skip). " +
        "(4) When the answer is \"Surprise me\" or \"Let the AI decide\", choose a " +
        "sensible on-brand value yourself and move on — do NOT re-ask it. (5) Never " +
        "invent specific prices, discounts, or guarantees that weren't provided. " +
        "(6) Do NOT return ready=true on the very first turn: ask at least one " +
        "question first. Once you have asked at least one question AND can write a " +
        "compelling, on-brand ad, return ready=true with a vivid one-paragraph " +
        "creative brief describing what the image should show and the " +
        "hook/offer/mood of the copy. Output ONLY valid JSON.",
    },
    {
      role: "user",
      content: `BRAND BRAIN: ${brandLine(input.brand)}
${input.instructions ? `\nCUSTOMER INSTRUCTIONS (follow):\n${input.instructions.slice(0, 3000)}\n` : ""}
VALID LANGUAGE IDS: ${languageIds}
VALID ANGLE IDS: ${angleIds}

USER REQUEST: ${input.goal}
${answers ? `\nANSWERS SO FAR:\n${answers}\n` : ""}
If you still need info, return the SINGLE next question:
{"ready": false, "question": {"id": string, "question": string, "help": string, "options": string[], "allowText": boolean, "allowRandom": boolean, "aiCanDecide": boolean}}
If you have enough to write a great ad, return:
{"ready": true, "brief": string, "language": string (a valid language id, optional), "angleId": string (a valid angle id, optional)}`,
    },
  ];
}

export async function runInterview(
  input: InterviewInput,
): Promise<InterviewResult> {
  return completeJSON<InterviewResult>(buildInterviewMessages(input), {
    temperature: 0.5,
    maxTokens: 1200,
  });
}
