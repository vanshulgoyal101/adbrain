import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/create/interview-non-answer.json";
import { openAIReply, requestUrl, settleInVirtualTime, useVirtualDeadlines, wait } from "./replay";
import type { BrandContext } from "@/lib/templates/ads";

// #2249: in the #2242 window (2026-10-28T15:48Z) one assistant request failed ASSISTANT_TIMEOUT after 45.3 s:
// Groq's four keys answered 429 on the shared daily token limit, Gemini ran until the 45 s request deadline, and
// the paid fallback (OpenRouter Haiku) was never reached; on the next request it answered in 7.0 s. The Groq 429
// is its recorded body; the OpenRouter answer is a recorded interview reply (interview-non-answer.json).
const brand = recorded.brand as BrandContext;
const tpd = () => Response.json({ error: { message: "Rate limit reached for model `qwen/qwen3.8-27b` in organization `org_x` service tier "
  + "`on_demand` on tokens per day (TPD): Limit 200000, Used 199583, Requested 2470. Please try again in 6m0s." } },
{ status: 429, headers: { "retry-after": "360" } });

beforeEach(() => {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    GROQ_API_KEYS: "g1,g2,g3,g4",
    GROQ_MODEL: "qwen/qwen3.8-27b",
    GOOGLE_AI_API_KEYS: "core-google",
    OPENROUTER_API_KEYS: "core-openrouter",
    CEREBRAS_API_KEYS: "",
    LLM_BUDGET_PROVIDER_ORDER: "groq,google,openrouter",
  })) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("core: a slow free provider leaves the assistant time for its paid fallback (#2249)", () => {
  it("Groq at its daily limit, Gemini hanging: OpenRouter answers inside the 45 s request", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.includes("api.groq.com")) { calls.push("groq"); return tpd(); }
      if (url.includes("generativelanguage.googleapis.com")) {
        calls.push("google");
        await wait(120_000, init?.signal);
        throw new Error("Gemini should have been cut off");
      }
      if (url.includes("openrouter.ai")) { calls.push("openrouter"); return openAIReply(recorded.replies[0].content, "anthropic/claude-haiku-4.5"); }
      throw new Error(`Unexpected request ${url}`);
    }));
    const { runInterview } = await import("@/lib/creative/interview");
    const { llmAttemptDeadlines, startedAt } = useVirtualDeadlines();

    const result = await settleInVirtualTime(runInterview({ brand, goal: recorded.goal, answers: [] }));

    expect(calls.filter((host) => host === "groq").length).toBeGreaterThanOrEqual(1);
    expect(calls.slice(-2)).toEqual(["google", "openrouter"]);
    expect(result).toHaveProperty("ready");
    // Every Gemini success seen in 14 days took at most 22.2 s (p90 17.3 s), and OpenRouter at most 11.9 s (QA, #2249).
    expect(llmAttemptDeadlines).toContain(25_000);
    expect(Date.now() - startedAt).toBeLessThan(45_000);
  });

  // #2462 (QA probe on 7ed1e724): the repair went back to the Gemini that had just timed out, with ~20 s left, and
  // the request deadline cut it off before OpenRouter. Calls were groq, google, openrouter, google, then 45 s.
  it("the repair turn still leaves OpenRouter its time after Gemini hung on the first turn", async () => {
    const calls: string[] = [];
    let openRouterReplies = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.includes("api.groq.com")) { calls.push("groq"); return tpd(); }
      if (url.includes("generativelanguage.googleapis.com")) {
        calls.push("google");
        await wait(120_000, init?.signal);
        throw new Error("Gemini should have been cut off");
      }
      if (url.includes("openrouter.ai")) {
        calls.push("openrouter");
        // A reply that fails validation, so the interview runs its repair turn.
        return openAIReply(openRouterReplies++ ? recorded.replies[0].content : JSON.stringify({ ready: false }), "anthropic/claude-haiku-4.5");
      }
      throw new Error(`Unexpected request ${url}`);
    }));
    const { runInterview } = await import("@/lib/creative/interview");
    const { startedAt } = useVirtualDeadlines();

    const result = await settleInVirtualTime(runInterview({ brand, goal: recorded.goal, answers: [] }));

    expect(calls.filter((host) => host === "openrouter")).toHaveLength(2);
    expect(calls.at(-1)).toBe("openrouter");
    expect(result).toHaveProperty("ready", true);
    expect(Date.now() - startedAt).toBeLessThan(45_000);
  });

  it("a hanging Groq can't use the whole request either: the paid fallback keeps its 12 s", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.includes("api.groq.com") || url.includes("generativelanguage.googleapis.com")) {
        calls.push(url.includes("groq") ? "groq" : "google");
        await wait(120_000, init?.signal);
        throw new Error("a hanging provider should have been cut off");
      }
      if (url.includes("openrouter.ai")) { calls.push("openrouter"); return openAIReply(recorded.replies[0].content, "anthropic/claude-haiku-4.5"); }
      throw new Error(`Unexpected request ${url}`);
    }));
    const { runInterview } = await import("@/lib/creative/interview");
    const { llmAttemptDeadlines, startedAt } = useVirtualDeadlines();

    const result = await settleInVirtualTime(runInterview({ brand, goal: recorded.goal, answers: [] }));

    expect(calls[0]).toBe("groq");
    expect(calls.at(-1)).toBe("openrouter");
    expect(result).toHaveProperty("ready", true);
    // 45 s request − 12 s kept for the last provider.
    expect(llmAttemptDeadlines[0]).toBe(33_000);
    expect(Date.now() - startedAt).toBeLessThan(45_000);
  });

  it("waiting out a short Gemini rate limit can't eat the time kept for OpenRouter", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.includes("api.groq.com")) { calls.push("groq"); return tpd(); }
      if (url.includes("generativelanguage.googleapis.com")) {
        calls.push("google");
        await wait(20_000, init?.signal);
        return Response.json({ error: { code: 429, message: "Resource exhausted", status: "RESOURCE_EXHAUSTED" } },
          { status: 429, headers: { "retry-after": "19" } });
      }
      if (url.includes("openrouter.ai")) {
        calls.push("openrouter");
        await wait(8_000, init?.signal);
        return openAIReply(recorded.replies[0].content, "anthropic/claude-haiku-4.5");
      }
      throw new Error(`Unexpected request ${url}`);
    }));
    const { runInterview } = await import("@/lib/creative/interview");
    const { startedAt } = useVirtualDeadlines();

    const result = await settleInVirtualTime(runInterview({ brand, goal: recorded.goal, answers: [] }));

    expect(calls.at(-1)).toBe("openrouter");
    expect(result).toHaveProperty("ready", true);
    expect(Date.now() - startedAt).toBeLessThan(45_000);
  });
});
