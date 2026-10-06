import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

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
  Response.json({ choices: [{ message: { content } }] });

const httpError = (status: number) =>
  new Response(`HTTP ${status}`, { status });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LLM provider fallthrough", () => {
  beforeEach(() => {
    setEnv({ GROQ_API_KEYS: "gk", OPENROUTER_API_KEYS: "ok" });
  });

  it("falls through to the next provider when one errors", async () => {
    mockFetchByHost({
      "api.groq.com": () => new Response("private error", { status: 500, headers: { "x-request-id": "groq-failed-123" } }),
      "openrouter.ai": () => Response.json({ id: "openrouter-done-456", choices: [{ message: { content: "from openrouter" } }] }),
    });
    const { complete } = await import("@/lib/llm");
    const attempts: unknown[] = [];
    const res = await complete([{ role: "user", content: "hi" }], { onAttempt: (attempt) => attempts.push(attempt) });
    expect(res.provider).toBe("openrouter");
    expect(res.text).toBe("from openrouter");
    expect(attempts).toMatchObject([
      { provider: "groq", providerRequestId: "groq-failed-123", providerFinalStatus: "unknown", status: "error" },
      { provider: "openrouter", providerRequestId: "openrouter-done-456", providerFinalStatus: "completed", status: "success" },
    ]);
  });

  it("aggregates errors and throws when every provider/key fails", async () => {
    mockFetchByHost({
      "api.groq.com": () => httpError(500),
      "openrouter.ai": () => httpError(503),
    });
    const { complete } = await import("@/lib/llm");
    await expect(
      complete([{ role: "user", content: "hi" }]),
    ).rejects.toMatchObject({ name: "AllLLMProvidersFailedError", reason: "PROVIDER_SERVER", message: "All LLM providers failed (2 tried)" });
  });

  it("does not attribute mixed provider failures to one cause", async () => {
    mockFetchByHost({
      "api.groq.com": () => httpError(500),
      "openrouter.ai": () => httpError(429),
    });
    const { complete } = await import("@/lib/llm");
    await expect(complete([{ role: "user", content: "hi" }])).rejects.toMatchObject({ reason: "MIXED" });
  });
});

describe("LLM 429 cooldown", () => {
  it("parks a rate-limited key so it isn't retried on the next call", async () => {
    // Single provider, single key: once it 429s it must be skipped next time.
    setEnv({ GROQ_API_KEYS: "solo" });
    const fetchMock = vi.fn(async () => httpError(429)) as unknown as typeof fetch;
    global.fetch = fetchMock;

    const { complete } = await import("@/lib/llm");

    await expect(complete([{ role: "user", content: "1" }])).rejects.toMatchObject({ reason: "RATE_LIMIT" });
    const callsAfterFirst = (fetchMock as unknown as { mock: { calls: unknown[] } })
      .mock.calls.length;
    expect(callsAfterFirst).toBe(1);

    // Second call: key is still in cooldown, so fetch must NOT be hit again.
    await expect(complete([{ role: "user", content: "2" }])).rejects.toMatchObject({ reason: "COOLDOWN" });
    const callsAfterSecond = (fetchMock as unknown as { mock: { calls: unknown[] } })
      .mock.calls.length;
    expect(callsAfterSecond).toBe(1);
  });
});

describe("SDK facade safety", () => {
  beforeEach(() => {
    setEnv({ GROQ_API_KEYS: "first-key,second-key", OPENROUTER_API_KEYS: "fallback-key" });
  });

  it.each([false, true])("records truncated Gemini usage once across shared callers (schema: %s)", async (structured) => {
    setEnv({ GOOGLE_AI_API_KEYS: "google-first,google-second", GROQ_API_KEYS: "", OPENROUTER_API_KEYS: "", GEMINI_MODEL: "gemini-3.6-flash" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      candidates: [{ content: { parts: [{ text: '{"value":' }] }, finishReason: "MAX_TOKENS" }],
      usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2, thoughtsTokenCount: 7, totalTokenCount: 17 },
    })));
    const { complete } = await import("@/lib/llm");
    const { resetUsage, usageSnapshot } = await import("@/lib/llm/usage");
    resetUsage();
    const messages = [{ role: "user" as const, content: "Return a value" }];
    const options = { cache: true, json: true, responseSchema: structured ? z.object({ value: z.number() }) : undefined };
    const results = await Promise.allSettled([complete(messages, options), complete(messages, options)]);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(result.reason).toMatchObject({
        provider: "google", model: "gemini-3.6-flash", retryable: false,
        usage: { promptTokens: 8, completionTokens: 2, totalTokens: 17 },
      });
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(usageSnapshot().overall).toEqual({
      calls: 1, cacheHits: 0, promptTokens: 8, completionTokens: 2, totalTokens: 17, savedTokens: 0,
    });
  });

  it("stops all key/provider fallthrough on caller cancellation", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => {
      controller.abort(new DOMException("Stopped", "AbortError"));
      throw controller.signal.reason;
    }));
    const { complete } = await import("@/lib/llm");
    const attempts: unknown[] = [];
    await expect(complete([{ role: "user", content: "test" }], {
      signal: controller.signal, onAttempt: (attempt) => attempts.push(attempt),
    })).rejects.toThrow("Stopped");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(attempts).toMatchObject([{ provider: "groq", status: "error", failure: "ABORTED" }]);
  });

  it("labels the caller's own deadline separately from a provider timeout", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => {
      controller.abort(new DOMException("Late", "TimeoutError"));
      throw controller.signal.reason;
    }));
    const { complete } = await import("@/lib/llm");
    const attempts: unknown[] = [];
    await expect(complete([{ role: "user", content: "test" }], {
      signal: controller.signal, onAttempt: (attempt) => attempts.push(attempt),
    })).rejects.toThrow("Late");
    expect(attempts).toMatchObject([{ status: "error", failure: "DEADLINE" }]);
  });

  it("skips the timed-out provider's other keys and falls through to the next provider", async () => {
    const deadlines: AbortController[] = [];
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      deadlines.push(new AbortController());
      return deadlines.at(-1)!.signal;
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("openrouter.ai")) return ok("from openrouter");
      deadlines.at(-1)!.abort(new DOMException("Timed out", "TimeoutError"));
      throw deadlines.at(-1)!.signal.reason;
    }));
    const { complete } = await import("@/lib/llm");
    const attempts: unknown[] = [];
    const result = await complete([{ role: "user", content: "test" }], {
      attemptTimeoutMs: 1_234, onAttempt: (attempt) => attempts.push(attempt),
    });
    expect(result).toMatchObject({ provider: "openrouter", text: "from openrouter" });
    expect(timeout).toHaveBeenCalledWith(1_234);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(attempts).toMatchObject([
      { provider: "groq", status: "error", failure: "TIMEOUT" },
      { provider: "openrouter", status: "success" },
    ]);
  });

  it("keeps the original timeout error when no other provider exists", async () => {
    setEnv({ GROQ_API_KEYS: "only-key" });
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    vi.stubGlobal("fetch", vi.fn(async () => {
      controller.abort(new DOMException("Timed out", "TimeoutError"));
      throw controller.signal.reason;
    }));
    const { complete } = await import("@/lib/llm");
    await expect(complete([{ role: "user", content: "test" }])).rejects.toMatchObject({
      name: "LLMError", code: "TIMEOUT", message: expect.stringContaining("deadline exceeded"),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("falls through to the next provider when output is truncated", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("openrouter.ai")
      ? ok("complete")
      : Response.json({ choices: [{ message: { content: '{"a":' }, finish_reason: "length" }],
        usage: { prompt_tokens: 5, completion_tokens: 9, total_tokens: 14 } })));
    const { complete } = await import("@/lib/llm");
    const attempts: unknown[] = [];
    const result = await complete([{ role: "user", content: "test" }], { onAttempt: (attempt) => attempts.push(attempt) });
    expect(result).toMatchObject({ provider: "openrouter", text: "complete" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(attempts).toMatchObject([
      { provider: "groq", status: "error", failure: "TRUNCATED", usage: { totalTokens: 14 } },
      { provider: "openrouter", status: "success" },
    ]);
  });

  it("tries each configured OpenRouter model in order", async () => {
    setEnv({ OPENROUTER_API_KEYS: "ok", OPENROUTER_MODEL: "first/model, second/model", LLM_PROVIDER_ORDER: "openrouter" });
    const models: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const model = JSON.parse(String(init?.body)).model as string;
      models.push(model);
      return model === "first/model" ? httpError(503) : ok("second");
    }));
    const { complete } = await import("@/lib/llm");
    const attempts: unknown[] = [];
    const result = await complete([{ role: "user", content: "test" }], { onAttempt: (attempt) => attempts.push(attempt) });
    expect(models).toEqual(["first/model", "second/model"]);
    expect(result).toMatchObject({ provider: "openrouter", model: "second/model", text: "second" });
    expect(attempts).toMatchObject([
      { model: "first/model", status: "error", failure: "HTTP_503" },
      { model: "second/model", status: "success" },
    ]);
  });

  it.each(['```json\n{"value":1}\n```', 'Result: {"value":1}'])
    ("preserves tolerant completeJSON parsing and non-enumerable completion metadata", async (text) => {
      vi.stubGlobal("fetch", vi.fn(async () => ok(text)));
      const { completeJSON } = await import("@/lib/llm");
      const result = await completeJSON<{ value: number }>([{ role: "user", content: "test" }]);
      expect(result).toEqual({ value: 1 });
      expect(Object.keys(result)).toEqual(["value"]);
      expect(Object.getOwnPropertyDescriptor(result, "__completion")?.value).toMatchObject({ provider: "groq", text });
    });

  it.each(['{"value":"private-invalid-output"}', "private-malformed-output"])
    ("rejects explicit schema-invalid JSON without fallback or raw error content", async (text) => {
      vi.stubGlobal("fetch", vi.fn(async () => ok(text)));
      const { completeJSON } = await import("@/lib/llm");
      const failure = await completeJSON([{ role: "user", content: "test" }], {
        responseSchema: z.object({ value: z.number() }),
      }).catch((error: unknown) => error);
      expect(failure).toMatchObject({ retryable: false, message: "LLM JSON output did not match the task schema" });
      expect(String(failure)).not.toContain("private-");
      expect(fetch).toHaveBeenCalledTimes(1);
    });
});
