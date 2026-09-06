import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.GROQ_API_KEYS = "groq-key";
  process.env.GOOGLE_AI_API_KEYS = "google-key";
  process.env.CEREBRAS_API_KEYS = "cerebras-key";
  process.env.OPENROUTER_API_KEYS = "openrouter-key";
  process.env.LLM_PROVIDER_ORDER = "openrouter,groq,google,cerebras";
  process.env.LLM_BUDGET_PROVIDER_ORDER = "groq,google,cerebras";
});

afterEach(() => vi.restoreAllMocks());

describe("task-aware LLM routing", () => {
  it("uses the standard pool for creative calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "standard" } }] }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    const { complete } = await import("@/lib/llm");
    const result = await complete([{ role: "user", content: "x" }]);
    expect(result.provider).toBe("openrouter");
  });

  it("keeps budget tasks off OpenRouter even when it is first globally", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "budget" } }] }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    const { complete } = await import("@/lib/llm");
    const result = await complete(
      [{ role: "user", content: "extract fields" }],
      { routing: "budget", maxTokens: 1200, reasoningEffort: "minimal" },
    );
    expect(result.provider).toBe("groq");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe("qwen/qwen3.8-27b");
    expect(body.reasoning).toBeUndefined();
  });

  it("fails closed instead of spending through OpenRouter when the budget pool is empty", async () => {
    process.env.GROQ_API_KEYS = "";
    process.env.GOOGLE_AI_API_KEYS = "";
    process.env.CEREBRAS_API_KEYS = "";
    const { complete, NoLLMKeysError } = await import("@/lib/llm");
    await expect(
      complete([{ role: "user", content: "extract" }], { routing: "budget" }),
    ).rejects.toBeInstanceOf(NoLLMKeysError);
  });
});
