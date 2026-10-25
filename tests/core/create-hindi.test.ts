import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/create/solaride-hindi.json";
import { openAIReply, requestBody, requestUrl } from "./replay";
import type { BrandContext } from "@/lib/templates/ads";

// solaride-hindi.json: real Solaride replies recorded by scripts/record-hindi-create-fixtures.ts (#290).
// A vague goal and the factory goal, typed in Devanagari Hindi and in Hinglish, go through the
// interview (Groq qwen, interview-v4) and three concepts in that ad language (Claude Haiku).
// Interview, validation and generation are real; only the network and images are replaced.
vi.mock("@/lib/imageGen", () => ({
  generateImage: async (req: { prompt: string; width: number; height: number }) => ({
    url: "https://core-test.supabase.co/storage/v1/object/public/creatives/hindi.webp",
    provider: "openrouter", model: "openai/gpt-image-2.5-flare", prompt: req.prompt, width: req.width, height: req.height,
  }),
}));

const brand = recorded.brand as BrandContext;
type Language = "hi" | "hinglish";
type Goal = "vague" | "factory";
const DEVANAGARI = /\p{Script=Devanagari}/u;
const replies = (language: Language, goal: Goal, phase: "interview" | "concept") =>
  recorded.replies.filter((reply) => reply.language === language && reply.goal === goal && reply.phase === phase);
const turns = (language: Language, goal: Goal) => recorded.turns.filter((turn) => turn.language === language && turn.goal === goal);

beforeEach(() => {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    GROQ_API_KEYS: "core-groq",
    GROQ_MODEL: "qwen/qwen3.8-27b",
    LLM_BUDGET_PROVIDER_ORDER: "groq",
    OPENROUTER_API_KEYS: "core-openrouter",
    GOOGLE_AI_API_KEYS: "",
    CEREBRAS_API_KEYS: "",
    LLM_PROVIDER_ORDER: "openrouter,google,groq",
    CREATIVE_PROVIDER_ORDER: undefined,
    CREATIVE_CONCEPT_SCHEDULE: undefined,
    OPENROUTER_MODEL: undefined,
  })) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function interview(language: Language) {
  const queue = replies(language, "vague", "interview").map((reply) => reply.content);
  const prompts: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(requestUrl(input)).toBe("https://api.groq.com/openai/v1/chat/completions");
    prompts.push(requestBody(init));
    const next = queue.shift();
    if (next === undefined) throw new Error("No recorded interview reply left.");
    return openAIReply(next, "qwen/qwen3.8-27b");
  }));
  const { ownerLanguage, runInterview } = await import("@/lib/creative/interview");
  const goal = recorded.goals[language].vague;
  const [first, second] = turns(language, "vague");
  const question = await runInterview({ brand, goal });
  const ready = await runInterview({ brand, goal, answers: second.answers });
  // The recordings answered prompts that name the owner's language; without it qwen asked in English.
  expect(prompts.every((prompt) => prompt.includes(language === "hi" ? "OWNER WRITES IN: Hindi" : "OWNER WRITES IN: Hinglish"))).toBe(true);
  return { first, question, ready, ownerLanguage, left: queue.length };
}

async function create(language: Language, goal: Goal) {
  const final = turns(language, goal).at(-1)!.result as { brief: string; sourceFacts: string[] };
  const concepts = replies(language, goal, "concept");
  const served = new Map<string, number>();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(requestUrl(input)).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = requestBody(init);
    const angle = [...new Set(concepts.map((reply) => reply.angle!))].find((name) => body.includes(name));
    if (!angle) throw new Error("Concept request did not name a recorded angle.");
    const attempt = (served.get(angle) ?? 0) + 1;
    served.set(angle, attempt);
    const reply = concepts.find((item) => item.angle === angle && item.attempt === attempt);
    if (!reply) throw new Error(`No recorded reply ${attempt} for ${angle}.`);
    return openAIReply(reply.content, "anthropic/claude-haiku-5.5");
  }));
  const { generateVariants } = await import("@/lib/creative/generate");
  const { conceptValidationRules } = await import("@/lib/creative/concept");
  const { languagePromptName } = await import("@/lib/languages");
  const failed: string[][] = [];
  const saved = await generateVariants({
    brand, brief: final.brief, count: 3, language: languagePromptName(language), format: "portrait",
    recentCopy: recorded.recentCopy, sourceFacts: final.sourceFacts,
    onFailure: async (_angle, error) => { failed.push(conceptValidationRules((error as { issues?: string[] }).issues ?? [String(error)])); },
  });
  return { saved, failed };
}

describe("core: the assistant asks in the owner's language (#290)", () => {
  it("asks a Hindi owner in Hindi and suggests Hindi ads", async () => {
    const { first, question, ready, ownerLanguage, left } = await interview("hi");
    expect(question).toEqual(first.result);
    expect(question.ready).toBe(false);
    expect(ownerLanguage({ goal: `${question.question!.question} ${question.question!.help ?? ""}` })).toBe("hi");
    expect(ready).toMatchObject({ ready: true, language: "hi" });
    expect(ready.brief).toMatch(DEVANAGARI);
    expect(left).toBe(0);
  });

  it("asks a Hinglish owner in Hinglish and suggests Hinglish ads", async () => {
    const { question, ready, ownerLanguage, left } = await interview("hinglish");
    expect(question.ready).toBe(false);
    const text = `${question.question!.question} ${question.question!.help ?? ""}`;
    expect(text).not.toMatch(DEVANAGARI);
    expect(ownerLanguage({ goal: text })).toBe("hinglish");
    expect(ready).toMatchObject({ ready: true, language: "hinglish" });
    expect(left).toBe(0);
  });
});

describe("core: Create makes Hindi and Hinglish ads (#290, #300)", () => {
  it("saves the Solaride factory ad in Hindi 3/3, in Devanagari on the image and in the post text", async () => {
    const { saved, failed } = await create("hi", "factory");
    expect(failed).toEqual([]);
    expect(saved).toHaveLength(3);
    for (const ad of saved) {
      expect(ad.primaryText).toMatch(DEVANAGARI);
      // #300 shapes Devanagari on the image, so the headline no longer has to be Latin.
      expect(ad.headline).toMatch(DEVANAGARI);
    }
  });

  it("saves the rest 3/3, retrying only concepts the checks rejected", async () => {
    const checks = new Set(["too-long", "unsupported-commercial-claim", "offer-below-fold", "all-caps"]);
    for (const [language, goal] of [["hi", "vague"], ["hinglish", "vague"], ["hinglish", "factory"]] as const) {
      const { saved, failed } = await create(language, goal);
      expect(saved, `${language} ${goal}`).toHaveLength(3);
      for (const rules of failed) for (const rule of rules) expect(checks, `${language} ${goal}`).toContain(rule);
      for (const ad of saved) {
        if (language === "hi") expect(`${ad.headline} ${ad.primaryText}`).toMatch(DEVANAGARI);
        else expect(`${ad.headline} ${ad.primaryText} ${ad.concept.supportingText ?? ""}`).not.toMatch(DEVANAGARI);
      }
    }
  });

  // #378: these first replies were rejected only for their rationale, which owners see in the ad's
  // details: "offers a no-cost first step (free site survey)" and "not a guaranteed saving".
  it("saves the vague-goal 'pain point' ads on the first try in Hindi and Hinglish", async () => {
    for (const language of ["hi", "hinglish"] as const) {
      const { saved } = await create(language, "vague");
      const painPoint = saved.find((ad) => ad.angleName === "Solve a pain point")!;
      expect(painPoint.llmUsage, language).toHaveLength(1);
    }
  });

  // #418: the eval saved this goal 1 of 3. The recorded first replies were rejected for "SOLARIDE" (the
  // Brand's own spelling) and "IIT/PEC" as shouting, and for "free" below the fold although the
  // first line already leads with "10,000 rupaye per kW", which the ₹ pattern did not see.
  // #378/#418: Gemini wrote "फ्री साइट सर्वे" without quoting the Brand or naming the offer in English,
  // and the claim check compared only English words for the thing offered. Haiku always repeated "free
  // site survey" in its English rationale, which hid this. Derived from a recorded Haiku reply: its
  // "free" quote and the English sentences naming the offer (rationale, visual) removed.
  it("cites the Brand's free site survey for a Hindi concept that states it without quoting it", async () => {
    const { validateConcept } = await import("@/lib/creative/concept");
    const { parseJSON } = await import("@/lib/llm");
    const { AD_ANGLES } = await import("@/lib/templates/ads");
    const reply = recorded.replies.find((item) => item.phase === "concept" && item.language === "hi" && item.goal === "factory"
      && item.content.normalize("NFC").includes("फ्री साइट सर्वे"))!;
    const value = parseJSON<{ sourceQuotes: string[]; rationale: string; visual: { direction: string } }>(reply.content);
    const withoutFree = (text: string) => text.split(/(?<=[.!?])\s+/).filter((sentence) => !/\bfree\b/i.test(sentence)).join(" ");
    const uncited = { ...value, sourceQuotes: value.sourceQuotes.filter((quote) => !/free/i.test(quote)),
      rationale: withoutFree(value.rationale), visual: { ...value.visual, direction: withoutFree(value.visual.direction) } };
    expect(uncited.sourceQuotes.length).toBeLessThan(value.sourceQuotes.length);
    expect(JSON.stringify(uncited)).not.toMatch(/\bfree\b/i);
    const angle = AD_ANGLES.find((item) => item.name === reply.angle)!;
    const result = validateConcept(uncited, { brand, brief: recorded.goals.hi.factory, angle, language: "Hindi in Devanagari script",
      sourceFacts: [recorded.goals.hi.factory] });
    expect(result).toMatchObject({ success: true, concept: { sourceQuotes: expect.arrayContaining(["Free site survey"]) } });
  });

  it("saves the Hinglish factory ad 3/3 on the first try: the Brand's capitals and a spelled ₹ amount", async () => {
    const { saved, failed } = await create("hinglish", "factory");
    expect(failed).toEqual([]);
    expect(saved.map((ad) => ad.llmUsage.length)).toEqual([1, 1, 1]);
    expect(saved.map((ad) => ad.headline)).toContain("31 Dec ke baad factory solar mehenga");
    expect(saved.some((ad) => /SOLARIDE ke IIT\/PEC engineers/.test(ad.primaryText))).toBe(true);
  });
});
