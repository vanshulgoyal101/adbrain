import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAICompatibleProvider } from "@/lib/llm/providers/openai-compatible";
import { createGeminiProvider } from "@/lib/llm/providers/gemini";
import { LLMError } from "@/lib/llm/types";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(response: {
  ok: boolean;
  status?: number;
  json?: unknown;
  text?: string;
}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: async () => response.json,
    text: async () => response.text ?? "",
  }) as unknown as typeof fetch;
}

describe("openai-compatible provider", () => {
  it("returns message content on success", async () => {
    mockFetch({
      ok: true,
      json: { choices: [{ message: { content: "hello" } }] },
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
    expect(out).toBe("hello");
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
});

describe("gemini provider", () => {
  it("maps candidates content to text", async () => {
    mockFetch({
      ok: true,
      json: {
        candidates: [{ content: { parts: [{ text: "solar" }, { text: "!" }] } }],
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
    expect(out).toBe("solar!");
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
