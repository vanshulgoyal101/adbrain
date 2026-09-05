import { afterEach, expect, it, vi } from "vitest";
import { createOpenAICompatibleProvider } from "@/lib/llm/providers/openai-compatible";

afterEach(() => vi.unstubAllGlobals());
const provider = createOpenAICompatibleProvider({
  name: "openrouter",
  baseUrl: "https://example.com",
  defaultModel: "reasoning-model",
});

it("sends reasoning effort separately from total output budget", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      Response.json({
        choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  await provider.complete(
    [{ role: "user", content: "Plan" }],
    { maxTokens: 6000, reasoningEffort: "medium", json: true },
    { apiKey: "test", model: "reasoning-model" },
  );
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
    max_tokens: 6000,
    reasoning: { effort: "medium", exclude: true },
  });
});

it("does not treat truncated reasoning or JSON as successful output", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({
          choices: [{ message: { content: "" }, finish_reason: "length" }],
        }),
      ),
  );
  await expect(
    provider.complete([], {}, { apiKey: "test", model: "reasoning-model" }),
  ).rejects.toMatchObject({
    retryable: false,
    message: expect.stringContaining("token budget exhausted"),
  });
});
