/**
 * Records real Hindi and Hinglish Create replies for test:core (#290): a vague goal and the Solaride
 * factory goal, typed in Devanagari Hindi and in Hinglish, go through the interview (answering its
 * questions), then three concepts in the matching ad language. Image requests are refused, so only
 * text is paid. Reads the Brand read-only; writes no data.
 *
 *   LLM_BUDGET_PROVIDER_ORDER=groq,google GROQ_MODEL=qwen/qwen3.8-27b CREATIVE_PROVIDER_ORDER=openrouter \
 *   OPENROUTER_MODEL=anthropic/claude-haiku-5.5 \
 *     npx tsx --env-file=.env.local scripts/record-hindi-create-fixtures.ts <business-id>
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { conceptValidationRules, validateConcept, type ConceptInput } from "@/lib/creative/concept";
import { CreativeImageError, CreativeValidationError, generateVariants } from "@/lib/creative/generate";
import { runInterview, type InterviewAnswer } from "@/lib/creative/interview";
import { recentCreativeCopy } from "@/lib/creative/references";
import { languagePromptName } from "@/lib/languages";
import { parseJSON } from "@/lib/llm";
import { AD_ANGLES, type BrandContext } from "@/lib/templates/ads";
import type { Database } from "@/lib/types";

/** The Solaride factory goal (actionable) and a vague goal that needs a question, per language. */
export const GOALS = {
  hi: {
    factory: "फ़ैक्टरी मालिकों के लिए विज्ञापन: 31 दिसंबर से नॉन-DCR सोलर पैनल बंद हो रहे हैं और लागत 10,000 रुपये प्रति किलोवाट से ज़्यादा बढ़ जाएगी। डेडलाइन से पहले इंस्टॉल करवाएं।",
    vague: "मुझे अपने सोलर बिज़नेस के लिए ज़्यादा ग्राहक चाहिए",
  },
  hinglish: {
    factory: "Factory owners ke liye ad banao: 31 December se non-DCR solar panel band ho rahe hain aur cost 10,000 rupaye per kW se zyada badh jayegi. Deadline se pehle install karwa lo.",
    vague: "Mujhe apne solar business ke liye zyada customers chahiye",
  },
} as const;
/** Typed when a question has no options (e.g. the offer), in the owner's own language. */
const TYPED = { hi: "मुफ़्त साइट सर्वे और दिवाली पर 10% की छूट", hinglish: "Free site survey aur Diwali par 10% off" } as const;

const TEXT_URLS = ["https://openrouter.ai/api/v1/chat/completions", "https://api.groq.com/", "https://generativelanguage.googleapis.com/"];
const IMAGE_URLS = ["https://openrouter.ai/api/v1/images", "https://fal.run/", "https://api.openai.com/", "https://image.pollinations.ai/"];

async function main() {
  const [businessId] = process.argv.slice(2);
  if (!businessId) throw new Error("Pass a business ID.");
  const supabase = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: brand, error } = await supabase.from("businesses")
    .select("name, vertical, description, brand_voice, target_audience, usps, offers, languages, locations")
    .eq("id", businessId).single();
  if (error) throw error;
  const recentCopy = await recentCreativeCopy(supabase, businessId);

  type Reply = { language: string; goal: string; phase: "interview" | "concept"; angle?: string; attempt: number; provider: string; model: string; content: string; rulesAtRecording: string[] };
  const replies: Reply[] = [];
  const turns: { language: string; goal: string; answers: InterviewAnswer[]; result: unknown }[] = [];
  const realFetch = globalThis.fetch;
  let current = { language: "", goal: "", input: null as ConceptInput | null };
  globalThis.fetch = async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
    if (IMAGE_URLS.some((prefix) => url.startsWith(prefix))) throw new Error("Recorder: images are not generated.");
    const response = await realFetch(request, init);
    if (!current.input || !TEXT_URLS.some((prefix) => url.startsWith(prefix))) return response;
    const body = await response.clone().json().catch(() => null) as { model?: string; choices?: { message?: { content?: string } }[] } | null;
    const content = body?.choices?.[0]?.message?.content;
    const sent = typeof init?.body === "string" ? init.body : "";
    const angle = AD_ANGLES.find((candidate) => sent.includes(candidate.name));
    if (typeof content === "string" && angle) {
      let value: unknown;
      try { value = parseJSON<unknown>(content); } catch { value = undefined; }
      const result = value === undefined ? null : validateConcept(value, { ...current.input, angle });
      replies.push({
        language: current.language, goal: current.goal, phase: "concept", angle: angle.name, model: body?.model ?? "unknown", provider: new URL(url).hostname, content,
        attempt: replies.filter((reply) => reply.language === current.language && reply.goal === current.goal && reply.angle === angle.name).length + 1,
        rulesAtRecording: result === null ? ["invalid-json"] : result.success ? [] : conceptValidationRules(result.issues),
      });
    }
    return response;
  };

  for (const [language, kind] of [["hi", "vague"], ["hi", "factory"], ["hinglish", "vague"], ["hinglish", "factory"]] as const) {
    const goal = GOALS[language][kind];
    const answers: InterviewAnswer[] = [];
    let brief: string | undefined;
    for (let turn = 0; turn < 3 && !brief; turn++) {
      const ask = () => runInterview({ brand: brand as BrandContext, goal, answers: [...answers] }, {
        onAttempt: async (completion, attempt, valid, rules = []) => {
          replies.push({ language, goal: kind, phase: "interview", attempt, provider: completion.provider, model: completion.model, content: completion.text, rulesAtRecording: valid ? [] : rules });
        },
      });
      let result = await ask();
      // The vague goal is there to record a question; the model sometimes finishes at once.
      for (let retry = 0; kind === "vague" && turn === 0 && result.ready && retry < 2; retry++) result = await ask();
      turns.push({ language, goal: kind, answers: [...answers], result });
      console.log(`${language} ${kind} turn ${turn}: ${JSON.stringify(result).slice(0, 400)}`);
      if (result.ready) brief = result.brief;
      else if (result.question) {
        const { question } = result;
        answers.push({ question: question.question, questionId: question.id, field: question.field, options: question.options,
          answer: question.options?.[0] ?? TYPED[language] });
      }
    }
    if (!brief) throw new Error(`${language} ${kind}: the interview did not finish in 3 turns.`);
    const sourceFacts = [goal, ...answers.filter((answer) => !(answer.options ?? []).includes(answer.answer)).map((answer) => answer.answer)];
    current = { language, goal: kind, input: { brand: brand as BrandContext, brief, angle: AD_ANGLES[0], language: languagePromptName(language), format: "portrait", recentCopy: [], sourceFacts } };
    const outcomes: string[] = [];
    await generateVariants({
      brand: brand as BrandContext, brief, count: 3, language: languagePromptName(language), format: "portrait", recentCopy, sourceFacts,
      onFailure: async (angle, err) => {
        outcomes.push(`${angle.name}: ${err instanceof CreativeImageError ? "concept passed" : err instanceof CreativeValidationError ? `rejected ${err.issues.join(" | ")}` : String(err)}`);
      },
    });
    console.log(`${language} ${kind} concepts:\n  ${outcomes.join("\n  ")}`);
    turns.push({ language, goal: kind, answers, result: { brief, sourceFacts } });
    current = { language: "", goal: "", input: null };
  }
  globalThis.fetch = realFetch;

  writeFileSync(join(process.cwd(), "tests/core/fixtures/create/solaride-hindi.json"), `${JSON.stringify({
    recordedAt: new Date().toISOString(), brand, goals: GOALS, typed: TYPED, recentCopy, turns, replies,
  }, null, 2)}\n`);
  console.log(replies.map((reply) => `${reply.language} ${reply.goal} ${reply.phase} ${reply.angle ?? ""}#${reply.attempt} ${reply.rulesAtRecording.join(",") || "valid"} ${reply.model}`).join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
