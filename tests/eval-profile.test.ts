import { describe, expect, it } from "vitest";
import { evalProfile } from "../scripts/lib/eval-profile";

describe("Create eval profiles (#418)", () => {
  it("pins the paid production models on OpenRouter, judged on OpenRouter", () => {
    const { settings, env } = evalProfile("paid", {});
    expect(settings).toMatchObject({ profile: "paid", textModel: "anthropic/claude-haiku-5.5", imageModel: "openai/gpt-image-2.5-flare", judge: "openrouter", judgeModel: "google/gemini-3.8-flash" });
    expect(env).toMatchObject({ CREATIVE_PROVIDER_ORDER: "openrouter", IMAGE_PROVIDER: "openrouter", IMAGE_PROVIDER_FALLBACK: "none" });
    expect(env).not.toHaveProperty("OPENROUTER_API_KEYS");
  });

  it("runs the free stack internal accounts get, with no way to reach the paid key (#466)", () => {
    const { settings, env } = evalProfile("free", { OPENROUTER_API_KEYS: "sk-or-live" });
    expect(settings).toMatchObject({ profile: "free", textModel: "gemini-3.6-flash", imageModel: "pollinations/flux", judge: "google", judgeModel: "gemini-3.8-flash" });
    expect(env).toMatchObject({
      CREATIVE_PROVIDER_ORDER: "google,groq", GEMINI_MODEL: "gemini-3.6-flash", GROQ_MODEL: "qwen/qwen3.8-27b",
      IMAGE_PROVIDER: "pollinations", POLLINATIONS_MODEL: "flux", IMAGE_PROVIDER_FALLBACK: "none", OPENROUTER_API_KEYS: "",
    });
  });

  it("takes bake-off overrides and rejects an unknown profile", () => {
    expect(evalProfile("free", { EVAL_TEXT_MODEL: "gemini-3.8-flash" }).env.GEMINI_MODEL).toBe("gemini-3.8-flash");
    expect(evalProfile("paid", { EVAL_TEXT_MODEL: "openai/gpt-5-mini" }).env.OPENROUTER_MODEL).toBe("openai/gpt-5-mini");
    expect(() => evalProfile("cheap", {})).toThrow(/paid or free/);
  });
});
