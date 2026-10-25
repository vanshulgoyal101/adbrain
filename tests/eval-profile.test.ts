import { describe, expect, it } from "vitest";
import { evalProfile } from "../scripts/lib/eval-profile";

describe("Create eval profiles (#418)", () => {
  it("pins the paid production models on OpenRouter, judged on OpenRouter", () => {
    const { settings, env } = evalProfile("paid", {});
    expect(settings).toMatchObject({ profile: "paid", textModel: "anthropic/claude-haiku-5.5", imageModel: "openai/gpt-image-2.5-flare", judge: "openrouter", judgeModel: "google/gemini-3.8-flash",
      baseline: "tests/eval/baseline.json", gateCases: null, judgeByDefault: true, deterministic: false });
    expect(env).toMatchObject({ CREATIVE_PROVIDER_ORDER: "openrouter", IMAGE_PROVIDER: "openrouter", IMAGE_PROVIDER_FALLBACK: "none" });
    expect(env).not.toHaveProperty("OPENROUTER_API_KEYS");
  });

  it("runs at $0 with no way to reach the paid key, off production's Gemini model (#466, #418)", () => {
    const { settings, env } = evalProfile("free", { OPENROUTER_API_KEYS: "sk-or-live" });
    expect(settings).toMatchObject({ profile: "free", textModel: "gemini-3.8-flash", imageModel: "pollinations/flux", judge: "google", judgeModel: "gemini-3.8-flash" });
    expect(env).toMatchObject({
      CREATIVE_PROVIDER_ORDER: "google,groq", GEMINI_MODEL: "gemini-3.8-flash", GROQ_MODEL: "qwen/qwen3.8-27b",
      IMAGE_PROVIDER: "pollinations", POLLINATIONS_MODEL: "flux", IMAGE_PROVIDER_FALLBACK: "none", OPENROUTER_API_KEYS: "",
    });
  });

  it("gates a generation change at $0 on two cases' deterministic copy checks, against its own baseline (CTO, Oct 25)", () => {
    expect(evalProfile("free", {}).settings).toMatchObject({
      baseline: "tests/eval/baseline-free.json", gateCases: ["cedar-ridge-en", "solaride-factory-hi"], judgeByDefault: false, deterministic: true,
      // One concept at a time fits Groq's free tokens-per-minute; parallel concepts hit 429s.
      schedule: "serial",
    });
    expect(evalProfile("free", {}).env.CREATIVE_CONCEPT_SCHEDULE).toBe("serial");
    expect(evalProfile("paid", {}).env.CREATIVE_CONCEPT_SCHEDULE).toBe("parallel");
  });

  it("takes bake-off overrides and rejects an unknown profile", () => {
    expect(evalProfile("free", { EVAL_TEXT_MODEL: "gemini-3.7-flash" }).env.GEMINI_MODEL).toBe("gemini-3.7-flash");
    expect(evalProfile("paid", { EVAL_TEXT_MODEL: "openai/gpt-5-mini" }).env.OPENROUTER_MODEL).toBe("openai/gpt-5-mini");
    expect(() => evalProfile("cheap", {})).toThrow(/paid or free/);
  });
});
