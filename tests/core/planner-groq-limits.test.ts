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

// #2189: production batch 4134f1a0 (Oct 31). Gemini answered 503 to all three Create concepts, so Groq was the last
// provider left. One concept hit Groq's 1,000 output-tokens/minute limit; when the park ended, one concept probed Groq
// and the other two, finding the probe out, gave up with nothing to fall back to: 1 of 3 ads saved.
describe("core: when Groq is the last provider left, parallel calls wait their turn instead of failing (#2189)", () => {
  const otpm = (seconds: number) => groqLimit("output tokens per minute (OTPM): Limit 1000, Used 488, Requested 752", seconds)();

  function lastResortChain(groqReplies: Array<() => Response | Promise<Response>>) {
    process.env.GOOGLE_AI_API_KEYS = "gg";
    process.env.OPENROUTER_API_KEYS = "";
    process.env.LLM_PROVIDER_ORDER = "google,groq";
    vi.resetModules();
    const hosts: string[] = [];
    let groqCalls = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.groq.com")) {
        hosts.push("groq");
        const reply = groqReplies[Math.min(groqCalls++, groqReplies.length - 1)];
        return reply();
      }
      hosts.push("google");
      return Response.json({ error: { code: 503, message: "The model is overloaded.", status: "UNAVAILABLE" } }, { status: 503 });
    }) as unknown as typeof fetch;
    return hosts;
  }
  const answer = (delayMs = 0) => async () => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return Response.json({ choices: [{ message: { content: "{\"ready\":true}" } }] });
  };

  afterEach(() => { vi.useRealTimers(); });

  it("Gemini 503 + a Groq per-minute limit: all three concepts are answered by Groq, none is lost", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    // 1: the limit (15 s). 2: the probe, slow so the others find it out. 3: the limit again, now 30 s (over the
    // 20 s short wait). Then Groq answers.
    const hosts = lastResortChain([() => otpm(15), answer(1_000), () => otpm(30), answer()]);
    const { complete } = await import("@/lib/llm");
    const deadline = new AbortController();
    const settled = Promise.allSettled([1, 2, 3].map((n) =>
      complete([{ role: "user", content: `concept ${n}` }], { signal: deadline.signal, waitOnLastProvider: true })));
    await vi.advanceTimersByTimeAsync(180_000);
    const results = await settled;
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
    expect(results.map((result) => result.status === "fulfilled" && result.value.provider)).toEqual(["groq", "groq", "groq"]);
    // Gemini is tried once per concept (a 503 skips its other keys), and Groq isn't hammered while parked.
    expect(hosts.filter((host) => host === "google")).toHaveLength(3);
    expect(hosts.filter((host) => host === "groq").length).toBeLessThanOrEqual(5);
  });

  it.each([
    ["without a deadline signal", { waitOnLastProvider: true }],
    ["for calls that don't opt in (planner, interview)", { signal: new AbortController().signal }],
  ])("%s, the last provider still gives up on a long wait rather than hang", async (_, options) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    lastResortChain([() => otpm(30), answer()]);
    const { complete, AllLLMProvidersFailedError } = await import("@/lib/llm");
    const call = complete([{ role: "user", content: "concept" }], options).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await call).toBeInstanceOf(AllLLMProvidersFailedError);
  });

  it("the deadline still ends a last-resort wait", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    lastResortChain([() => otpm(30), answer()]);
    const { complete } = await import("@/lib/llm");
    const deadline = new AbortController();
    const call = complete([{ role: "user", content: "concept" }], { signal: deadline.signal, waitOnLastProvider: true })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    deadline.abort(new DOMException("deadline", "TimeoutError"));
    expect(await call).toMatchObject({ name: "TimeoutError" });
  });
});
