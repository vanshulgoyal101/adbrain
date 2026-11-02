import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import internal from "@/lib/internal-accounts.json";
import recorded from "./fixtures/create/interview-non-answer.json";
import { openAIReply, requestUrl, settleInVirtualTime, useVirtualDeadlines } from "./replay";

// Core gate for #410: Create step 1 must never dead-end with a bare 500 when the AI
// providers refuse. The route, interview, router, AI SDK providers and usage logging are
// real; only the provider network and Supabase are replaced. The success reply is the
// recorded real Solaride interview reply (interview-non-answer.json). The 429 bodies and
// headers follow each provider's rate-limit response; a real one cannot be recorded without
// adding load to the shared free-tier keys, which is what caused #410.

const OPENROUTER_MODEL = "anthropic/claude-haiku-5.5";
const URLS = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  google: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
} as const;
type Provider = keyof typeof URLS;

const RATE_LIMITED: Record<Provider, () => Response> = {
  groq: () => Response.json({ error: {
    message: "Rate limit reached for model `qwen/qwen3.8-27b` in organization `org_core` service tier `on_demand` on tokens per minute (TPM): Limit 6000, Used 5021, Requested 2472. Please try again in 14.93s.",
    type: "tokens", code: "rate_limit_exceeded",
  } }, { status: 429, headers: { "retry-after": "15" } }),
  google: () => Response.json({ error: {
    code: 429, status: "RESOURCE_EXHAUSTED",
    message: "You exceeded your current quota, please check your plan and billing details.",
    details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "23s" }],
  } }, { status: 429 }),
  openrouter: () => Response.json({ error: { message: "Rate limit exceeded", code: 429 } }, { status: 429 }),
};
// Recorded 2026-10-24 12:02Z from OpenRouter when the key reached its total limit (#449); the
// key-management link is shortened.
const KEY_LIMIT = () => Response.json({ error: {
  message: "Key limit exceeded (total limit). Manage it using https://openrouter.ai/workspaces/default/keys/… $7.03 of $7.00 used; does not reset.",
  code: 403, metadata: { limit_source: "openrouter_key_limit" },
} }, { status: 403 });

const CUSTOMER = { id: "8c1f4f0e-5a43-4c55-9b1f-3f7a3f0c2a10" };
const SMOKE = { id: internal.smokeUserIds[0], email: "smoke@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
const mocks = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], user: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => {
      const { observeVerifiedUser } = await import("@/lib/observability/context");
      observeVerifiedUser(mocks.user as never);
      return { data: { user: mocks.user } };
    } },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: recorded.brand, error: null }) }) }) }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ insert: (rows: Record<string, unknown>[]) => {
      mocks.rows.push(...rows);
      return { abortSignal: async () => ({ error: null }) };
    } }),
  }),
}));
vi.mock("@/lib/supabase/queries", () => ({ getActiveInstructionsText: async () => "" }));
vi.mock("@/lib/campaign/result-evidence-store", () => ({ getResultEvidence: async () => [] }));
vi.mock("@/lib/preferences/store", () => ({ preferenceContext: async () => "" }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));

beforeEach(() => {
  vi.resetModules();
  mocks.rows = [];
  mocks.user = CUSTOMER;
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    GROQ_API_KEYS: "core-groq",
    GROQ_MODEL: "qwen/qwen3.8-27b",
    GOOGLE_AI_API_KEYS: "core-google",
    GEMINI_MODEL: "gemini-3.6-flash",
    OPENROUTER_API_KEYS: "core-openrouter",
    OPENROUTER_MODEL,
    // Production order since the #410 mitigation: two free tiers, then the paid fallback.
    LLM_BUDGET_PROVIDER_ORDER: "groq,google,openrouter",
    LLM_MONTHLY_TOKEN_LIMIT: "0",
    PRODUCT_LOGGING_ENABLED: "true",
  })) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function providers(answer: Partial<Record<Provider, () => Response>>) {
  const calls: Provider[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    const provider = (Object.keys(URLS) as Provider[]).find((name) => url.startsWith(URLS[name]));
    if (!provider) throw new Error(`Unexpected request to ${url}`);
    calls.push(provider);
    return (answer[provider] ?? RATE_LIMITED[provider])();
  }));
  return calls;
}

function productEvents() {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  return () => info.mock.calls
    .map(([line]) => { try { return JSON.parse(String(line)); } catch { return null; } })
    .filter((event) => event?.source === "adbrain.product");
}

async function startCreating(startClock: typeof useVirtualDeadlines) {
  const { POST } = await import("@/app/api/creatives/assistant/route");
  const clock = startClock();
  const response = await settleInVirtualTime(POST(new Request("http://localhost/api/creatives/assistant", {
    method: "POST",
    body: JSON.stringify({ businessId: "ea6ea561-0000-4000-8000-000000000001", goal: recorded.goal }),
  })));
  return { response, elapsedMs: Date.now() - clock.startedAt };
}

describe("core: Create step 1 when the AI providers are busy (#410)", () => {
  it("returns 503 'busy, try again' and logs each refused attempt with its reason", async () => {
    const calls = providers({});
    const events = productEvents();

    const { response, elapsedMs } = await startCreating(useVirtualDeadlines);

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("10");
    expect(await response.json()).toEqual({ error: "AdBrain is busy right now. Tap Try again in a few seconds.", code: "AI_BUSY" });
    // Groq is retried once after its 15 s retry-after; Gemini and OpenRouter have no short wait.
    expect(calls).toEqual(["groq", "groq", "google", "openrouter"]);
    expect(elapsedMs).toBeLessThan(45_000);

    const completions = events().filter((event) => event.name === "ai.completion");
    expect(completions.map((event) => [event.outcome, event.attributes.provider, event.attributes.model, event.attributes.errorCode])).toEqual([
      ["failed", "groq", "qwen/qwen3.8-27b", "LLM_HTTP_429"],
      ["failed", "groq", "qwen/qwen3.8-27b", "LLM_HTTP_429"],
      ["failed", "google", "gemini-3.6-flash", "LLM_HTTP_429"],
      ["failed", "openrouter", OPENROUTER_MODEL, "LLM_HTTP_429"],
    ]);
    expect(events().filter((event) => event.kind === "workflow" && event.name === "creative.interview")
      .map((event) => [event.outcome, event.attributes.errorCode])).toEqual([["failed", "ASSISTANT_EXHAUSTED_RATE_LIMIT"]]);
    expect(mocks.rows.map((row) => [row.route, row.provider, row.status, row.error_code, row.total_tokens])).toEqual([
      ["creatives.assistant", "groq", "error", "LLM_HTTP_429", 0],
      ["creatives.assistant", "groq", "error", "LLM_HTTP_429", 0],
      ["creatives.assistant", "google", "error", "LLM_HTTP_429", 0],
      ["creatives.assistant", "openrouter", "error", "LLM_HTTP_429", 0],
    ]);
  });

  it("returns 500, not 'busy', when a key is refused for good, so the outage alerts (#449)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const calls = providers({ openrouter: KEY_LIMIT });
    const events = productEvents();

    const { response } = await startCreating(useVirtualDeadlines);

    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("code", "AI_BUSY");
    expect(calls).toEqual(["groq", "groq", "google", "openrouter"]);
    expect(events().filter((event) => event.name === "ai.completion").map((event) => event.attributes.errorCode))
      // #449: the refused key is logged as out of credit, not a bare 403, so the alert names the cause.
      .toEqual(["LLM_HTTP_429", "LLM_HTTP_429", "LLM_HTTP_429", "LLM_CREDIT_EXHAUSTED"]);
    expect(events().filter((event) => event.name === "creative.interview").map((event) => [event.outcome, event.attributes.errorCode]))
      .toEqual([["failed", "ASSISTANT_CREDIT_EXHAUSTED"]]);
  });

  it("answers from the paid fallback and still logs the refused free-tier attempts", async () => {
    const reply = recorded.replies.find((item) => item.turn === "goal")!.content;
    const calls = providers({ openrouter: () => openAIReply(reply, OPENROUTER_MODEL) });
    const events = productEvents();

    const { response } = await startCreating(useVirtualDeadlines);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ready: true, brief: expect.stringContaining("North India") });
    expect(calls).toEqual(["groq", "groq", "google", "openrouter"]);
    expect(events().filter((event) => event.name === "ai.completion")
      .map((event) => [event.outcome, event.attributes.provider, event.attributes.errorCode ?? null])).toEqual([
      ["failed", "groq", "LLM_HTTP_429"],
      ["failed", "groq", "LLM_HTTP_429"],
      ["failed", "google", "LLM_HTTP_429"],
      ["success", "openrouter", null],
    ]);
    expect(events().some((event) => event.name === "creative.interview" && event.outcome === "failed")).toBe(false);
  });
});

// #2457: the smoke login writes on free text only (#2230). Oct 31 14:13Z its turn met Groq's per-minute output limit,
// then a Gemini 503 (QA on #2249); the route called that a 500 "assistant trouble", which alerts and failed the smoke
// (#2396). Busy free models are load, so the owner sees "busy, try again"; a missing free provider still alerts.
describe("core: the smoke login's assistant when the free models are busy (#2457)", () => {
  const groqOutputPerMinute = () => Response.json({ error: {
    message: "Rate limit reached for model `qwen/qwen3.8-27b` in organization `org_core` service tier `on_demand` on output tokens per minute (OTPM): Limit 1000, Used 0, Requested 1066. Please try again in 57.2s.",
    type: "tokens", code: "rate_limit_exceeded",
  } }, { status: 429, headers: { "retry-after": "58" } });
  const geminiOverloaded = () => Response.json({ error: { code: 503, message: "The model is overloaded.", status: "UNAVAILABLE" } }, { status: 503 });

  it("returns 503 'busy, try again' and never reaches the paid model", async () => {
    mocks.user = SMOKE;
    const calls = providers({ groq: groqOutputPerMinute, google: geminiOverloaded });
    const events = productEvents();

    const { response } = await startCreating(useVirtualDeadlines);

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("10");
    expect(await response.json()).toEqual({ error: "AdBrain is busy right now. Tap Try again in a few seconds.", code: "AI_BUSY" });
    expect(calls).not.toContain("openrouter");
    expect(calls).toContain("google");
    expect(events().filter((event) => event.name === "creative.interview").map((event) => [event.outcome, event.attributes.errorCode]))
      .toEqual([["failed", "ASSISTANT_EXHAUSTED_FREE_TEXT_UNAVAILABLE"]]);
  });

  it("still returns 500 when a free key is refused for good, so it alerts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.user = SMOKE;
    const calls = providers({ groq: groqOutputPerMinute,
      google: () => Response.json({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }, { status: 400 }) });

    const { response } = await startCreating(useVirtualDeadlines);

    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("code", "AI_BUSY");
    expect(calls).not.toContain("openrouter");
  });

  it("still returns 500 when no free model is configured, so it alerts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("GROQ_API_KEYS", "");
    vi.stubEnv("GOOGLE_AI_API_KEYS", "");
    mocks.user = SMOKE;
    const calls = providers({});

    const { response } = await startCreating(useVirtualDeadlines);

    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("code", "AI_BUSY");
    expect(calls).toEqual([]);
  });
});
