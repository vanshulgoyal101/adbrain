import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function setEnv(overrides: Record<string, string>) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.GOOGLE_AI_API_KEYS = "";
  process.env.GROQ_API_KEYS = "";
  process.env.OPENROUTER_API_KEYS = "";
  process.env.CEREBRAS_API_KEYS = "";
  process.env.LLM_PROVIDER_ORDER = "google,groq,openrouter,cerebras";
  Object.assign(process.env, overrides);
  vi.resetModules();
}

/** Route the fetch mock by target host so we can fail one provider, pass another. */
function mockFetchByHost(handlers: Record<string, () => Response | Promise<Response>>) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [host, handler] of Object.entries(handlers)) {
      if (url.includes(host)) return handler();
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as unknown as typeof fetch;
}

const ok = (content: string) =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => "",
  }) as unknown as Response;

const httpError = (status: number) =>
  ({
    ok: false,
    status,
    json: async () => ({ error: { message: `HTTP ${status}` } }),
    text: async () => `HTTP ${status}`,
  }) as unknown as Response;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LLM provider fallthrough", () => {
  beforeEach(() => {
    setEnv({ GROQ_API_KEYS: "gk", OPENROUTER_API_KEYS: "ok" });
  });

  it("falls through to the next provider when one errors", async () => {
    mockFetchByHost({
      "api.groq.com": () => httpError(500),
      "openrouter.ai": () => ok("from openrouter"),
    });
    const { complete } = await import("@/lib/llm");
    const res = await complete([{ role: "user", content: "hi" }]);
    expect(res.provider).toBe("openrouter");
    expect(res.text).toBe("from openrouter");
  });

  it("aggregates errors and throws when every provider/key fails", async () => {
    mockFetchByHost({
      "api.groq.com": () => httpError(500),
      "openrouter.ai": () => httpError(503),
    });
    const { complete } = await import("@/lib/llm");
    await expect(
      complete([{ role: "user", content: "hi" }]),
    ).rejects.toThrow(/All LLM providers failed/);
  });
});

describe("LLM 429 cooldown", () => {
  it("parks a rate-limited key so it isn't retried on the next call", async () => {
    // Single provider, single key: once it 429s it must be skipped next time.
    setEnv({ GROQ_API_KEYS: "solo" });
    const fetchMock = vi.fn(async () => httpError(429)) as unknown as typeof fetch;
    global.fetch = fetchMock;

    const { complete } = await import("@/lib/llm");

    await expect(complete([{ role: "user", content: "1" }])).rejects.toThrow(
      /All LLM providers failed/,
    );
    const callsAfterFirst = (fetchMock as unknown as { mock: { calls: unknown[] } })
      .mock.calls.length;
    expect(callsAfterFirst).toBe(1);

    // Second call: key is still in cooldown, so fetch must NOT be hit again.
    await expect(complete([{ role: "user", content: "2" }])).rejects.toThrow(
      /All LLM providers failed/,
    );
    const callsAfterSecond = (fetchMock as unknown as { mock: { calls: unknown[] } })
      .mock.calls.length;
    expect(callsAfterSecond).toBe(1);
  });
});
