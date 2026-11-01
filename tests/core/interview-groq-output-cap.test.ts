import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/create/interview-non-answer.json";
import { openAIReply, requestUrl } from "./replay";
import type { BrandContext } from "@/lib/templates/ads";

// #2249: Groq counts max_tokens against its 1,000 output tokens a minute. The smoke's assistant turn on Oct 31 14:13Z
// was refused (OTPM) after two quick turns, each reserving 2,400. The assistant now asks Groq for 800; the replies
// below are Groq's recorded interview replies (the longest is 2,293 characters, about its 532-token production peak).
const brand = recorded.brand as BrandContext;
const groqReplies = recorded.replies.filter((reply) => reply.model === "qwen/qwen3.8-27b" && reply.turn === "goal");
const longest = groqReplies.reduce((a, b) => (b.content.length > a.content.length ? b : a));

beforeEach(() => {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    GROQ_API_KEYS: "core-groq",
    GROQ_MODEL: "qwen/qwen3.8-27b",
    GOOGLE_AI_API_KEYS: "",
    CEREBRAS_API_KEYS: "",
    OPENROUTER_API_KEYS: "core-openrouter",
    LLM_BUDGET_PROVIDER_ORDER: "groq,openrouter",
  })) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function network(groq: () => Response) {
  const calls: Array<{ host: string; maxTokens?: number }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as { max_tokens?: number };
    const host = url.includes("api.groq.com") ? "groq" : url.includes("openrouter.ai") ? "openrouter" : url;
    calls.push({ host, maxTokens: body.max_tokens });
    if (host === "groq") return groq();
    if (host === "openrouter") return openAIReply(longest.content, "anthropic/claude-haiku-4.5");
    throw new Error(`Unexpected request ${url}`);
  }));
  return calls;
}

describe("core: the assistant reserves at most 800 Groq output tokens (#2249)", () => {
  it("every recorded Groq interview reply fits well inside 800 tokens", async () => {
    const { INTERVIEW_GROQ_MAX_TOKENS } = await import("@/lib/creative/interview");
    expect(INTERVIEW_GROQ_MAX_TOKENS).toBe(800);
    // Production's longest Groq reply was 2,294 characters for 532 tokens (QA, #2249); keep 1.5× headroom on that rate.
    for (const reply of groqReplies) expect(Math.ceil(reply.content.length * 532 / 2294) * 1.5).toBeLessThanOrEqual(INTERVIEW_GROQ_MAX_TOKENS);
  });

  it("Groq is asked for 800 and its longest recorded reply comes back whole", async () => {
    const calls = network(() => openAIReply(longest.content, "qwen/qwen3.8-27b", { prompt: 2_400, completion: 532 }));
    const { runInterview } = await import("@/lib/creative/interview");

    const result = await runInterview({ brand, goal: recorded.goal, answers: [] });

    expect(calls).toEqual([{ host: "groq", maxTokens: 800 }]);
    expect(result).toHaveProperty("ready");
  });

  it("the paid fallback keeps 2,400 when Groq is at its per-minute output limit", async () => {
    const calls = network(() => Response.json({ error: {
      message: "Rate limit reached for model `qwen/qwen3.8-27b` in organization `org_core` service tier `on_demand` on output tokens per minute (OTPM): Limit 1000, Used 0, Requested 1066. Please try again in 57.2s.",
      type: "tokens", code: "rate_limit_exceeded",
    } }, { status: 429, headers: { "retry-after": "58" } }));
    const { runInterview } = await import("@/lib/creative/interview");

    const result = await runInterview({ brand, goal: recorded.goal, answers: [] });

    expect(calls[0]).toEqual({ host: "groq", maxTokens: 800 });
    expect(calls.at(-1)).toEqual({ host: "openrouter", maxTokens: 2400 });
    expect(result).toHaveProperty("ready");
  });
});
