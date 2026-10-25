import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { targetingInputSchema } from "@/lib/campaign/connect-contracts";
import { FALLBACK_AUDIENCE_RATIONALE } from "@/lib/campaign/planner-draft";
import groqCityOnly from "./fixtures/planner/groq-audience-city-only.json";
import { googleReply, openAIReply, requestBody, requestUrl, settleInVirtualTime, useVirtualDeadlines, wait } from "./replay";

// Prepare over the real provider transport: route, planner, LLM routing, AI SDK and the
// planner's own deadline are real; only provider HTTP, Supabase and Meta access are replaced.
// campaign-prepare.test.ts covers the route's handling of planner results with `complete` mocked.

const business = {
  id: "816aaafb-7ebc-4ad7-bbda-001beff172f8", name: "Cedar Ridge Chiropractic", vertical: "chiropractic clinic",
  description: "Chiropractic care in Austin.", target_audience: null,
  locations: ["Austin, Texas", "Round Rock", "Cedar Park"], offers: ["$49 new-patient exam"], website: null,
};
const creatives = [{
  id: "e3d165a9-bbf8-47f7-8c61-e69dbb8ee3d1", angle: "value", headline: "Diwali Renewal, Starting With Your Spine",
  image_url: "https://example.com/ad.png", primary_text: "A $49 new-patient exam.", cta: "Book Now",
}];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) } }),
}));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/llm/persist", () => ({
  configuredMonthlyTokenLimit: () => 0,
  monthlyTokenUsage: async () => 0,
  persistLLMUsage: async () => true,
}));
vi.mock("@/lib/supabase/queries", () => ({
  getPrimaryBusiness: async () => business,
  getApprovedCreatives: async () => creatives,
  getActiveInstructionsText: async () => "",
  getPerformanceContext: async () => "",
}));
vi.mock("@/lib/preferences/store", () => ({ preferenceContext: async () => "" }));
vi.mock("@/lib/meta/connection-access", () => ({
  ConnectionAccessError: class ConnectionAccessError extends Error {
    code = "UNAVAILABLE";
  },
  requireOwnedBusiness: async () => ({ userId: "owner", businessId: business.id }),
  withMetaConnection: async () => { throw new Error("Prepare must not read Meta for an audience recommendation."); },
}));

const audienceDraft = {
  businessId: business.id, name: "Cedar Ridge leads", goal: "Book new-patient exams", mode: "manual",
  creativeIds: creatives.map((creative) => creative.id), dailyBudgetRupees: 500, leadFormId: "form-1", abTest: false,
  targeting: { location: { mode: "ai", cityScope: "city_only" }, age: { mode: "ai" } },
};

let calls: string[];

function stubPlanner(answer: "recorded" | 503 | "hang") {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (!requestBody(init).includes("Plan only the audience")) throw new Error(`Unexpected request: ${url}`);
    calls.push(new URL(url).host);
    if (answer === "hang") await wait(10 * 60_000, init?.signal);
    if (answer === 503) return Response.json({ error: { message: "Service unavailable" } }, { status: 503 });
    const text = JSON.stringify(groqCityOnly);
    return url.includes("generativelanguage") ? googleReply(text) : openAIReply(text, "qwen/qwen3.8-27b");
  }));
}

// #612: the providers' own 429 shapes (as create-busy; a real one can't be recorded on demand).
const RATE_LIMITED: Record<string, () => Response> = {
  "api.groq.com": () => Response.json({ error: {
    message: "Rate limit reached for model `qwen/qwen3.8-27b` in organization `org_core` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 7021, Requested 2472. Please try again in 14.93s.",
    type: "tokens", code: "rate_limit_exceeded",
  } }, { status: 429, headers: { "retry-after": "15" } }),
  "generativelanguage.googleapis.com": () => Response.json({ error: {
    code: 429, status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota, please check your plan and billing details.",
    details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "23s" }],
  } }, { status: 429 }),
  "api.cerebras.ai": () => Response.json({ message: "Requests per minute limit exceeded", type: "too_many_requests_error", code: "request_quota_exceeded" },
    { status: 429, headers: { "retry-after": "30" } }),
  "openrouter.ai": () => Response.json({ error: { message: "Rate limit exceeded", code: 429 } }, { status: 429 }),
};

/** Every provider in `limited` answers 429; the rest answer with the recorded Groq plan. */
function stubRateLimits(limited: () => string[]) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (!requestBody(init).includes("Plan only the audience")) throw new Error(`Unexpected request: ${url}`);
    const host = new URL(url).host;
    calls.push(host);
    if (limited().includes(host)) return RATE_LIMITED[host]();
    const text = JSON.stringify(groqCityOnly);
    return url.includes("generativelanguage") ? googleReply(text) : openAIReply(text, host === "openrouter.ai" ? "anthropic/claude-haiku-5.5" : "qwen/qwen3.8-27b");
  }));
}

async function prepare() {
  const { POST } = await import("@/app/api/campaigns/plan/route");
  return () => POST(new Request("http://localhost/api/campaigns/plan", {
    method: "POST",
    body: JSON.stringify({ goal: audienceDraft.goal, audienceDraft }),
  }));
}

/** Parses the response the way the Campaigns screen does before continuing to launch. */
async function expectTargeting(response: Response) {
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body.ready).toBe(true);
  const targeting = targetingInputSchema.parse(body.targeting);
  expect(targeting.location).toMatchObject({ cityScope: "city_only" });
  return { body, targeting };
}

beforeEach(() => {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    GROQ_API_KEYS: "core-groq",
    GOOGLE_AI_API_KEYS: "core-google",
    CEREBRAS_API_KEYS: "core-cerebras",
    OPENROUTER_API_KEYS: "core-openrouter",
    LLM_BUDGET_PROVIDER_ORDER: undefined,
  })) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("core: Prepare over the provider transport", () => {
  it("turns the recorded Groq reply into launchable targeting", async () => {
    stubPlanner("recorded");
    const { body, targeting } = await expectTargeting(await (await prepare())());
    expect(body.fallback).toBeUndefined();
    expect(calls).toEqual(["api.groq.com"]);
    expect(targeting.age).toMatchObject({ min: 30, max: 60 });
    expect(targeting.audience).toMatchObject({ interestNames: groqCityOnly.plan.interests, rationale: groqCityOnly.plan.rationale });
  });

  it("uses the no-AI fallback when every planner provider fails", async () => {
    stubPlanner(503);
    const { body, targeting } = await expectTargeting(await (await prepare())());
    expect(body.fallback).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    expect(targeting.age).toMatchObject({ min: 25, max: 55 });
    expect(targeting.audience).toMatchObject({ interestNames: [], rationale: FALLBACK_AUDIENCE_RATIONALE });
  });

  it("uses the no-AI fallback before the 60 s route limit when the planner times out", async () => {
    const post = await prepare();
    const clock = useVirtualDeadlines();
    stubPlanner("hang");
    const response = await settleInVirtualTime(post());
    const elapsed = Date.now() - clock.startedAt;
    const { body, targeting } = await expectTargeting(response);
    expect(body.fallback).toBe(true);
    expect(targeting.audience).toMatchObject({ rationale: FALLBACK_AUDIENCE_RATIONALE });
    // Groq and Gemini each use their 20 s attempt; the 45 s planner deadline cuts Cerebras off.
    expect(calls).toEqual(["api.groq.com", "generativelanguage.googleapis.com", "api.cerebras.ai"]);
    expect(elapsed).toBeGreaterThanOrEqual(45_000);
    expect(elapsed).toBeLessThan(60_000);
  });

  // #612 (CTO): free-tier rate limits must not cost the owner a plan.
  it("plans after every free provider answers 429, on the paid last resort", async () => {
    const post = await prepare();
    useVirtualDeadlines();
    stubRateLimits(() => ["api.groq.com", "generativelanguage.googleapis.com", "api.cerebras.ai"]);
    const { body, targeting } = await expectTargeting(await settleInVirtualTime(post()));
    expect(body.fallback).toBeUndefined();
    expect(new Set(calls)).toEqual(new Set(["api.groq.com", "generativelanguage.googleapis.com", "api.cerebras.ai", "openrouter.ai"]));
    expect(targeting.audience).toMatchObject({ interestNames: groqCityOnly.plan.interests });
  });

  // The router already waits (up to 20 s) for a parked provider that frees up soon, rather than failing.
  it("after a burst parked every provider, the next Prepare waits out Groq's short cooldown and plans (#612)", async () => {
    const post = await prepare();
    const clock = useVirtualDeadlines();
    let limited = ["api.groq.com", "generativelanguage.googleapis.com", "api.cerebras.ai", "openrouter.ai"];
    stubRateLimits(() => limited);
    // The burst: every provider refuses, so this Prepare gets default targeting (and can still launch).
    expect((await expectTargeting(await settleInVirtualTime(post()))).body.fallback).toBe(true);
    // The next Prepare finds every key parked; Groq's 15 s retry-after frees up first.
    limited = [];
    calls = [];
    const started = Date.now();
    const { body, targeting } = await expectTargeting(await settleInVirtualTime(post()));
    expect(body.fallback).toBeUndefined();
    expect(targeting.audience).toMatchObject({ interestNames: groqCityOnly.plan.interests });
    expect(calls).toEqual(["api.groq.com"]);
    expect(Date.now() - started).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThanOrEqual(20_000);
    expect(Date.now() - clock.startedAt).toBeLessThan(120_000);
  });
});

