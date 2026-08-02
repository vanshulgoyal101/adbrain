import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Env must be set before any getEnv() call (which happens inside complete()).
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.GROQ_API_KEYS = "key-a,key-b";
  process.env.GOOGLE_AI_API_KEYS = "";
  process.env.OPENROUTER_API_KEYS = "";
  process.env.CEREBRAS_API_KEYS = "";
  process.env.LLM_PROVIDER_ORDER = "google,groq,openrouter,cerebras";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LLM rotation", () => {
  it("rotates to the next key when the first is rate-limited", async () => {
    const { complete } = await import("@/lib/llm");

    let call = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: false,
          status: 429,
          json: async () => ({}),
          text: async () => "rate limited",
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
        text: async () => "",
      };
    }) as unknown as typeof fetch;

    const result = await complete([{ role: "user", content: "hi" }]);
    expect(result.text).toBe("ok");
    expect(result.provider).toBe("groq");
    expect(call).toBe(2);
  });

  it("throws NoLLMKeysError when no provider has keys", async () => {
    process.env.GROQ_API_KEYS = "";
    vi.resetModules();
    const { complete, NoLLMKeysError } = await import("@/lib/llm");
    await expect(complete([{ role: "user", content: "hi" }])).rejects.toBeInstanceOf(
      NoLLMKeysError,
    );
    process.env.GROQ_API_KEYS = "key-a,key-b";
  });
});
