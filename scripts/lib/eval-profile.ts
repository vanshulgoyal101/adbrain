/** Which models a Create eval run uses (#418); pure, so the money guard is unit-tested. */

export type EvalProfileName = "paid" | "free";

export type EvalSettings = {
  profile: EvalProfileName;
  textModel: string;
  imageModel: string;
  judge: "openrouter" | "google";
  judgeModel: string;
  schedule: "parallel";
};

/**
 * `paid`: production's models on OpenRouter (Haiku 5.5 + gpt-image), judged on OpenRouter.
 * `free`: what internal accounts get (#466): Gemini then Groq on the free keys, Pollinations images,
 * judged by the same Gemini model on Google directly, and no OpenRouter key at all.
 */
export function evalProfile(name: string, overrides: Record<string, string | undefined>): { settings: EvalSettings; env: Record<string, string> } {
  const shared = { AD_DESIGN_OVERLAY: "true", CREATIVE_CONCEPT_SCHEDULE: "parallel", IMAGE_PROVIDER_FALLBACK: "none" };
  if (name === "paid") {
    const settings: EvalSettings = {
      profile: "paid",
      textModel: overrides.EVAL_TEXT_MODEL ?? "anthropic/claude-haiku-5.5",
      imageModel: overrides.EVAL_IMAGE_MODEL ?? "openai/gpt-image-2.5-flare",
      judge: "openrouter",
      judgeModel: overrides.EVAL_JUDGE_MODEL ?? "google/gemini-3.8-flash",
      schedule: "parallel",
    };
    return { settings, env: { ...shared, CREATIVE_PROVIDER_ORDER: "openrouter", OPENROUTER_MODEL: settings.textModel,
      IMAGE_PROVIDER: "openrouter", OPENROUTER_IMAGE_MODEL: settings.imageModel } };
  }
  if (name === "free") {
    const pollinations = overrides.EVAL_IMAGE_MODEL ?? "flux";
    const settings: EvalSettings = {
      profile: "free",
      textModel: overrides.EVAL_TEXT_MODEL ?? "gemini-3.6-flash",
      imageModel: `pollinations/${pollinations}`,
      judge: "google",
      judgeModel: overrides.EVAL_JUDGE_MODEL ?? "gemini-3.8-flash",
      schedule: "parallel",
    };
    return { settings, env: { ...shared, CREATIVE_PROVIDER_ORDER: "google,groq", GEMINI_MODEL: settings.textModel,
      GROQ_MODEL: "qwen/qwen3.8-27b", IMAGE_PROVIDER: "pollinations", POLLINATIONS_MODEL: pollinations, OPENROUTER_API_KEYS: "" } };
  }
  throw new Error(`--profile must be paid or free, not ${name}.`);
}
