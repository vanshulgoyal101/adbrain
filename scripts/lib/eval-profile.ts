/** Which models a Create eval run uses (#418); pure, so the money guard is unit-tested. */

export type EvalProfileName = "paid" | "free";

export type EvalSettings = {
  profile: EvalProfileName;
  textModel: string;
  imageModel: string;
  judge: "openrouter" | "google";
  judgeModel: string;
  /** Concept calls at once: "serial" fits Groq's free tokens-per-minute. */
  schedule: "serial" | "parallel";
  /** The report this profile is compared with, and written by `--write-baseline`. */
  baseline: string;
  /** Cases run when `--cases` isn't given; null means every case. */
  gateCases: string[] | null;
  judgeByDefault: boolean;
  /** Compare only the deterministic copy checks (see `compareSummaries`). */
  deterministic: boolean;
};

/**
 * `paid`: production's models on OpenRouter (Haiku 5.5 + gpt-image), judged on OpenRouter.
 * `free` ($0, the gate for generation changes; CTO, Oct 25): Gemini then Groq on the free keys,
 * Pollinations images and no OpenRouter key at all. Its copy model is not production's Gemini
 * model, so a run never spends production's 20-a-day free quota. Two cases (English, Hindi), no
 * judge by default, compared on the deterministic copy checks against its own baseline (#418).
 */
export function evalProfile(name: string, overrides: Record<string, string | undefined>): { settings: EvalSettings; env: Record<string, string> } {
  const shared = { AD_DESIGN_OVERLAY: "true", IMAGE_PROVIDER_FALLBACK: "none" };
  if (name === "paid") {
    const settings: EvalSettings = {
      profile: "paid",
      textModel: overrides.EVAL_TEXT_MODEL ?? "anthropic/claude-haiku-5.5",
      imageModel: overrides.EVAL_IMAGE_MODEL ?? "openai/gpt-image-2.5-flare",
      judge: "openrouter",
      judgeModel: overrides.EVAL_JUDGE_MODEL ?? "google/gemini-3.8-flash",
      // #713: EVAL_SCHEDULE=serial measures production's default against parallel on the same paid models.
      schedule: overrides.EVAL_SCHEDULE === "serial" ? "serial" : "parallel",
      baseline: "tests/eval/baseline.json", gateCases: null, judgeByDefault: true, deterministic: false,
    };
    return { settings, env: { ...shared, CREATIVE_CONCEPT_SCHEDULE: settings.schedule, CREATIVE_PROVIDER_ORDER: "openrouter", OPENROUTER_MODEL: settings.textModel,
      IMAGE_PROVIDER: "openrouter", OPENROUTER_IMAGE_MODEL: settings.imageModel } };
  }
  if (name === "free") {
    const pollinations = overrides.EVAL_IMAGE_MODEL ?? "flux";
    const settings: EvalSettings = {
      profile: "free",
      textModel: overrides.EVAL_TEXT_MODEL ?? "gemini-3.8-flash",
      imageModel: `pollinations/${pollinations}`,
      judge: "google",
      judgeModel: overrides.EVAL_JUDGE_MODEL ?? "gemini-3.8-flash",
      schedule: "serial",
      baseline: "tests/eval/baseline-free.json", gateCases: ["cedar-ridge-en", "solaride-factory-hi"], judgeByDefault: false, deterministic: true,
    };
    return { settings, env: { ...shared, CREATIVE_CONCEPT_SCHEDULE: settings.schedule, CREATIVE_PROVIDER_ORDER: "google,groq", GEMINI_MODEL: settings.textModel,
      GROQ_MODEL: "qwen/qwen3.8-27b", IMAGE_PROVIDER: "pollinations", POLLINATIONS_MODEL: pollinations, OPENROUTER_API_KEYS: "" } };
  }
  throw new Error(`--profile must be paid or free, not ${name}.`);
}
