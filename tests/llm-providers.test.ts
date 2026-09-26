import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAICompatibleProvider } from "@/lib/llm/providers/openai-compatible";
import { createGeminiProvider } from "@/lib/llm/providers/gemini";
import { LLMError } from "@/lib/llm/types";
import { z } from "zod";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockFetch(response: {
  ok: boolean;
  status?: number;
  json?: unknown;
  text?: string;
}) {
  global.fetch = vi.fn().mockImplementation(async () => new Response(
    response.json === undefined ? response.text ?? "" : JSON.stringify(response.json),
    { status: response.status ?? (response.ok ? 200 : 500), headers: { "Content-Type": "application/json" } },
  )) as unknown as typeof fetch;
}

describe("openai-compatible provider", () => {
  it("returns message content on success", async () => {
    mockFetch({
      ok: true,
      json: {
        choices: [{ message: { content: "hello" } }],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
      },
    });
    const provider = createOpenAICompatibleProvider({
      name: "groq",
      baseUrl: "https://api.groq.com/openai/v1/chat/completions",
      defaultModel: "llama-3.3-70b-versatile",
    });
    const out = await provider.complete([{ role: "user", content: "hi" }], {}, {
      apiKey: "k",
      model: "llama-3.3-70b-versatile",
    });
    expect(out.text).toBe("hello");
    expect(out.usage).toEqual({
      promptTokens: 12,
      completionTokens: 3,
      totalTokens: 15,
    });
  });

  it("throws a retryable LLMError on HTTP 429", async () => {
    mockFetch({ ok: false, status: 429, text: "rate limited" });
    const provider = createOpenAICompatibleProvider({
      name: "groq",
      baseUrl: "https://x",
      defaultModel: "m",
    });
    await expect(
      provider.complete([{ role: "user", content: "hi" }], {}, {
        apiKey: "k",
        model: "m",
      }),
    ).rejects.toMatchObject({ status: 429, retryable: true });
  });

  it("names the task and budget route when output is truncated", async () => {
    mockFetch({
      ok: true,
      json: { choices: [{ message: { content: "" }, finish_reason: "length" }] },
    });
    const provider = createOpenAICompatibleProvider({ name: "groq", baseUrl: "https://x", defaultModel: "m" });
    await expect(provider.complete([{ role: "user", content: "extract" }], { routing: "budget", task: "website brand extraction" }, { apiKey: "k", model: "m" })).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining("website brand extraction"),
    });
  });
});

describe("gemini provider", () => {
  it("maps candidates content to text", async () => {
    mockFetch({
      ok: true,
      json: {
        candidates: [{ content: { parts: [{ text: "solar" }, { text: "!" }] } }],
        usageMetadata: {
          promptTokenCount: 8,
          candidatesTokenCount: 2,
          totalTokenCount: 10,
        },
      },
    });
    const provider = createGeminiProvider();
    const out = await provider.complete(
      [
        { role: "system", content: "be brief" },
        { role: "user", content: "hi" },
      ],
      {},
      { apiKey: "k", model: "gemini-2.0-flash" },
    );
    expect(out.text).toBe("solar!");
    expect(out.usage).toEqual({
      promptTokens: 8,
      completionTokens: 2,
      totalTokens: 10,
    });
  });

  it("throws LLMError on non-ok response", async () => {
    mockFetch({ ok: false, status: 403, text: "forbidden" });
    const provider = createGeminiProvider();
    await expect(
      provider.complete([{ role: "user", content: "hi" }], {}, {
        apiKey: "k",
        model: "gemini-2.0-flash",
      }),
    ).rejects.toBeInstanceOf(LLMError);
  });
});

describe.each(["groq", "google"] as const)("%s SDK compatibility", (name) => {
  const provider = name === "google"
    ? createGeminiProvider({ thinkingHeadroom: 3000 })
    : createOpenAICompatibleProvider({
      name, baseUrl: "https://provider.example/custom/completions", defaultModel: "default-model",
      extraHeaders: { "X-Title": "AdBrain" },
    });
  const context = { apiKey: "fixture-secret", model: name === "google" ? "gemini-2.0-flash" : "chosen-model" };
  const messages = [{ role: "user" as const, content: "Return a value" }];
  const reply = (text: string, finish = "stop") => name === "google"
    ? {
      candidates: [{ content: { parts: [{ text }] }, finishReason: finish === "length" ? "MAX_TOKENS" : "STOP" }],
      usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2, thoughtsTokenCount: 7, totalTokenCount: 17 },
    }
    : {
      choices: [{ message: { content: text }, finish_reason: finish }],
      usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 17 },
    };

  it("uses the exact direct endpoint, key, model, limits and system prompts", async () => {
    mockFetch({ ok: true, json: reply("done") });
    const result = await provider.complete([
      { role: "system", content: "First rule" },
      { role: "system", content: "Second rule" },
      { role: "assistant", content: "Earlier answer" },
      ...messages,
    ], { maxTokens: 123, temperature: 0.2 }, context);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    const headers = new Headers(init?.headers);
    const body = JSON.parse(init?.body as string);
    if (name === "google") {
      expect(String(url)).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${context.model}:generateContent`);
      expect(headers.get("x-goog-api-key")).toBe(context.apiKey);
      expect(body.systemInstruction.parts).toEqual([{ text: "First rule\n\nSecond rule" }]);
      expect(body.contents[0]).toMatchObject({ role: "model", parts: [{ text: "Earlier answer" }] });
      expect(body.generationConfig).toMatchObject({ maxOutputTokens: 3123, temperature: 0.2 });
    } else {
      expect(String(url)).toBe("https://provider.example/custom/completions");
      expect(headers.get("authorization")).toBe(`Bearer ${context.apiKey}`);
      expect(headers.get("x-title")).toBe("AdBrain");
      expect(body).toMatchObject({ model: context.model, max_tokens: 123, temperature: 0.2 });
      expect(body.messages.slice(0, 2)).toEqual([
        { role: "system", content: "First rule" }, { role: "system", content: "Second rule" },
      ]);
    }
    expect(result.usage).toEqual({ promptTokens: 8, completionTokens: 2, totalTokens: 17 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("requests JSON without breaking legacy fenced output", async () => {
    const text = '```json\n{"value":1}\n```';
    mockFetch({ ok: true, json: reply(text) });
    expect((await provider.complete(messages, { json: true }, context)).text).toBe(text);
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    if (name === "google") expect(body.generationConfig.responseMimeType).toBe("application/json");
    else expect(body.response_format).toEqual({ type: "json_object" });
  });

  it.each(['{"value":1}', '{"value":"invalid"}', "malformed JSON"])(
    "preserves schema-backed text and usage for task validation: %s", async (text) => {
      mockFetch({ ok: true, json: reply(text) });
      const result = await provider.complete(messages, {
        json: true, responseSchema: z.object({ value: z.number() }),
      }, context);
      expect(result.text).toBe(text);
      expect(result.usage).toEqual({ promptTokens: 8, completionTokens: 2, totalTokens: 17 });
      expect(fetch).toHaveBeenCalledTimes(1);
      if (name === "google") {
        const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
        expect(body.generationConfig.responseJsonSchema).toMatchObject({ properties: { value: { type: "number" } } });
      }
    },
  );

  it.each([401, 403, 429, 503])("does not retry HTTP %s or expose the provider body", async (status) => {
    mockFetch({ ok: false, status, text: `private response ${context.apiKey}` });
    const failure = await provider.complete(messages, {}, context).catch((error: unknown) => error);
    expect(failure).toMatchObject({ status, retryable: !(name === "google" && status === 401) });
    expect(String(failure)).not.toContain(context.apiKey);
    expect(String(failure)).not.toContain("private response");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("distinguishes an empty response from truncation", async () => {
    mockFetch({ ok: true, json: reply("") });
    await expect(provider.complete(messages, {}, context)).rejects.toMatchObject({ retryable: true, message: expect.stringContaining("empty response") });
    mockFetch({ ok: true, json: reply('{"value":', "length") });
    await expect(provider.complete(messages, { responseSchema: z.object({ value: z.number() }) }, context))
      .rejects.toMatchObject({ retryable: false, message: expect.stringContaining("token budget exhausted") });
  });

  it("redacts transport exception messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(`failed with ${context.apiKey}`)));
    const failure = await provider.complete(messages, {}, context).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LLMError);
    expect(String(failure)).not.toContain(context.apiKey);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not call the provider after cancellation", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const controller = new AbortController();
    const reason = new DOMException("Cancelled", "AbortError");
    controller.abort(reason);
    await expect(provider.complete(messages, { signal: controller.signal }, context)).rejects.toBe(reason);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves in-flight cancellation without retrying", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Cancelled", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      controller.abort(reason);
      throw reason;
    }));
    await expect(provider.complete(messages, { signal: controller.signal }, context)).rejects.toBe(reason);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("makes the adapter deadline terminal", async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      deadline.abort(new DOMException("Timed out", "TimeoutError"));
      throw deadline.signal.reason;
    }));
    await expect(provider.complete(messages, {}, context)).rejects.toMatchObject({ retryable: false, message: expect.stringContaining("deadline exceeded") });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
