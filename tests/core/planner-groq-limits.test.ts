import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/planner/groq-meta-interest-names.json";
import { PLANNER_GROQ_MAX_TOKENS } from "@/lib/campaign/planner";

// #1200: Groq's 429s on the planner were its 1,000 output-tokens/minute limit (max_tokens counts) and its daily
// token limit. The planner asks Groq for at most 1,000 output tokens, and a daily-limit 429 parks Groq until retry-after.
function setEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.GOOGLE_AI_API_KEYS = "";
  process.env.CEREBRAS_API_KEYS = "";
  process.env.GROQ_API_KEYS = "gk";
  process.env.OPENROUTER_API_KEYS = "ok";
  process.env.LLM_PROVIDER_ORDER = "google,groq,openrouter,cerebras";
  vi.resetModules();
}

type Call = { host: string; body: { max_tokens?: number } };
function routeFetch(groq: () => Response) {
  const calls: Call[] = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const host = url.includes("api.groq.com") ? "groq" : url.includes("openrouter.ai") ? "openrouter" : "other";
    calls.push({ host, body: JSON.parse(String(init?.body ?? "{}")) });
    if (host === "groq") return groq();
    return Response.json({ choices: [{ message: { content: "{\"ready\":true}" } }] });
  }) as unknown as typeof fetch;
  return calls;
}
const groqLimit = (kind: string, retryAfterSeconds: number) => () => Response.json({ error: { message:
  `Rate limit reached for model \`qwen/qwen3.8-27b\` in organization \`org_x\` service tier \`on_demand\` on ${kind}. Please try again in ${retryAfterSeconds}s.` } },
  { status: 429, headers: { "retry-after": String(retryAfterSeconds) } });

beforeEach(setEnv);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("core: planner Groq output cap (#1200)", () => {
  it("the recorded Groq plan fits well inside 1,000 output tokens", () => {
    // Conservative: no model emits fewer than 2 characters per token on JSON like this.
    expect(recorded.model).toBe("qwen/qwen3.8-27b");
    expect(recorded.text.length / 2).toBeLessThan(PLANNER_GROQ_MAX_TOKENS);
    expect(() => JSON.parse(recorded.text)).not.toThrow();
  });

  it("Groq is asked for at most 1,000 tokens; the fallback keeps 3,000; the recorded plan comes back whole", async () => {
    const calls = routeFetch(() => Response.json({ choices: [{ message: { content: recorded.text } }] }));
    const { complete } = await import("@/lib/llm");
    const result = await complete([{ role: "user", content: "plan" }], { maxTokens: 3000, providerMaxTokens: { groq: PLANNER_GROQ_MAX_TOKENS } });
    expect(result.provider).toBe("groq");
    expect(result.text).toBe(recorded.text);
    expect(calls[0]).toMatchObject({ host: "groq", body: { max_tokens: 1000 } });

    const fallback = routeFetch(groqLimit("tokens per minute (TPM): Limit 6000, Used 5800, Requested 1000", 2));
    const { complete: again } = await import("@/lib/llm");
    await again([{ role: "user", content: "plan" }], { maxTokens: 3000, providerMaxTokens: { groq: PLANNER_GROQ_MAX_TOKENS } });
    expect(fallback.find((call) => call.host === "openrouter")?.body.max_tokens).toBe(3000);
  });
});

describe("core: a daily-limit 429 parks Groq until retry-after (#1200)", () => {
  async function twoCalls(kind: string, retryAfterSeconds: number, gapMs: number) {
    let now = Date.parse("2026-10-28T14:00:00Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const calls = routeFetch(groqLimit(kind, retryAfterSeconds));
    const { complete } = await import("@/lib/llm");
    await complete([{ role: "user", content: "plan 1" }], {});
    now += gapMs;
    calls.length = 0;
    await complete([{ role: "user", content: "plan 2" }], {});
    return calls.map((call) => call.host);
  }

  it("tokens per day: 2 minutes later Groq is still skipped (no wasted call)", async () => {
    expect(await twoCalls("tokens per day (TPD): Limit 200000, Used 199998, Requested 2013", 600, 120_000)).toEqual(["openrouter"]);
  });

  it("tokens per day: parked for Groq's own retry-after, not 15 minutes (#1568), then tried again", async () => {
    const tpd = "tokens per day (TPD): Limit 200000, Used 199998, Requested 2013";
    expect(await twoCalls(tpd, 7_200, 16 * 60_000)).toEqual(["openrouter"]);
    setEnv();
    expect(await twoCalls(tpd, 7_200, 7_200_000 + 1_000)).toEqual(["groq", "openrouter"]);
  });

  it("a daily park is capped at 6 hours even if retry-after says more (#1568)", async () => {
    expect(await twoCalls("tokens per day (TPD): Limit 200000, Used 199998, Requested 2013", 86_400, 6 * 3_600_000 + 1_000)).toEqual(["groq", "openrouter"]);
  });

  it("an org-wide limit parks every Groq key, not just the one that answered (#1568)", async () => {
    process.env.GROQ_API_KEYS = "gk1,gk2";
    vi.resetModules();
    const calls = routeFetch(groqLimit("tokens per day (TPD): Limit 200000, Used 199998, Requested 2013", 600));
    const { complete } = await import("@/lib/llm");
    await complete([{ role: "user", content: "plan 1" }], {});
    expect(calls.map((call) => call.host)).toEqual(["groq", "openrouter"]);
    calls.length = 0;
    await complete([{ role: "user", content: "plan 2" }], {});
    expect(calls.map((call) => call.host)).toEqual(["openrouter"]);
  });

  it("a per-minute limit still clears after a minute, as before", async () => {
    expect(await twoCalls("output tokens per minute (OTPM): Limit 1000, Used 0, Requested 1343", 600, 61_000)).toEqual(["groq", "openrouter"]);
  });
});

describe("core: after a Groq rate limit, one call probes it; parallel calls don't pile on (#1568)", () => {
  it("park ends → the first call probes Groq; the calls made meanwhile go straight to the fallback", async () => {
    let now = Date.parse("2026-10-28T14:00:00Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const gate: { release?: () => void } = {};
    let groqCalls = 0;
    const hosts: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const host = url.includes("api.groq.com") ? "groq" : "openrouter";
      hosts.push(host);
      if (host === "groq") {
        groqCalls += 1;
        if (groqCalls === 1) return groqLimit("tokens per day (TPD): Limit 200000, Used 199998, Requested 2013", 600)();
        // The probe after the park: slow, so the other calls overlap it.
        if (groqCalls === 2) await new Promise<void>((resolve) => { gate.release = resolve; });
        return Response.json({ choices: [{ message: { content: "{\"ready\":true}" } }] });
      }
      return Response.json({ choices: [{ message: { content: "{\"ready\":true}" } }] });
    }) as unknown as typeof fetch;
    const { complete } = await import("@/lib/llm");
    await complete([{ role: "user", content: "plan 1" }], {});
    now += 601_000;
    hosts.length = 0;
    const probe = complete([{ role: "user", content: "plan 2" }], {});
    // Date.now is mocked, so poll with real timers instead of vi.waitFor.
    while (!gate.release) await new Promise((resolve) => setTimeout(resolve, 5));
    const others = await Promise.all([1, 2, 3].map((n) => complete([{ role: "user", content: `plan ${n + 2}` }], {})));
    expect(others.map((result) => result.provider)).toEqual(["openrouter", "openrouter", "openrouter"]);
    gate.release();
    expect((await probe).provider).toBe("groq");
    expect(hosts.filter((host) => host === "groq")).toHaveLength(1);
    // Groq answered, so the next call uses it again.
    expect((await complete([{ role: "user", content: "plan 9" }], {})).provider).toBe("groq");
  });
});
