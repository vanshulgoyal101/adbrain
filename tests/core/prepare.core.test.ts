import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { targetingInputSchema } from "@/lib/campaign/connect-contracts";
import { FALLBACK_AUDIENCE_RATIONALE } from "@/lib/campaign/planner-draft";
import run4 from "./fixtures/create-cedar-ridge-run4.json";
import { googleReply, openAIReply, requestBody, requestUrl, settleInVirtualTime, useVirtualDeadlines, wait } from "./replay";

// Core regression gate (#110): Prepare. The route, planner, LLM routing and AI SDK are real;
// provider HTTP, Supabase reads and the Meta connection check are replaced.

const creatives = [
  { id: "6f1c1d64-3a51-4b41-9f6f-0c0de0000001", angle: "value", headline: run4.angles[0].concept.headline },
  { id: "6f1c1d64-3a51-4b41-9f6f-0c0de0000002", angle: "problem", headline: run4.angles[1].concept.headline },
  { id: "6f1c1d64-3a51-4b41-9f6f-0c0de0000003", angle: "offer", headline: run4.angles[2].concept.headline },
];
// No successful planner response is stored in production (only one PLANNER_VALIDATION error),
// so this is a schema-shaped answer for the Cedar Ridge brand. Replace with a recorded plan
// once one exists.
const plan = {
  ready: true,
  plan: {
    name: "Cedar Ridge new-patient leads",
    daily_budget_rupees: 800,
    lead_form_id: null,
    creative_ids: creatives.map((creative) => creative.id),
    age_min: 28,
    age_max: 60,
    radius_km: 25,
    city_scope: "radius",
    interests: ["Chiropractic", "Back pain", "Physical therapy"],
    special_ad_category: "none",
    locations: ["Austin, Texas"],
    excluded_locations: [],
    destination: "instant_form",
    rationale: "Working adults near the clinic with back or neck pain, matching the brand's evening and weekend hours.",
  },
};

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
  getPrimaryBusiness: async () => run4.brand,
  getApprovedCreatives: async () => creatives,
  getActiveInstructionsText: async () => "",
  getPerformanceContext: async () => "",
}));
vi.mock("@/lib/preferences/store", () => ({ preferenceContext: async () => "" }));
vi.mock("@/lib/meta/connection-access", () => ({
  ConnectionAccessError: class ConnectionAccessError extends Error {
    code = "UNAVAILABLE";
  },
  requireOwnedBusiness: async () => ({ userId: "owner", businessId: run4.brand.id }),
  withMetaConnection: async () => { throw new Error("Prepare must not read Meta for an audience recommendation."); },
}));

const audienceDraft = {
  businessId: run4.brand.id,
  name: "Cedar Ridge new-patient leads",
  goal: "Book new-patient exams",
  mode: "manual",
  creativeIds: creatives.map((creative) => creative.id),
  dailyBudgetRupees: 800,
  leadFormId: "lead-form-core",
  abTest: false,
  targeting: { location: { mode: "ai", cityScope: "radius", radiusKm: 25 } },
};

let calls: string[];

function stubPlanner(answer: "plan" | 503 | "hang") {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (!requestBody(init).includes("Plan only the audience")) throw new Error(`Unexpected request: ${url}`);
    calls.push(new URL(url).host);
    if (answer === "hang") await wait(10 * 60_000, init?.signal);
    if (answer === 503) return Response.json({ error: { message: "Service unavailable" } }, { status: 503 });
    const text = JSON.stringify(plan);
    return url.includes("generativelanguage") ? googleReply(text) : openAIReply(text, "qwen/qwen3.8-27b");
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
  expect(targeting.location).toMatchObject({ cityScope: "radius" });
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

describe("Prepare core loop", () => {
  it("turns a planner answer into launchable targeting", async () => {
    stubPlanner("plan");
    const { body, targeting } = await expectTargeting(await (await prepare())());
    expect(body.fallback).toBeUndefined();
    expect(calls).toEqual(["api.groq.com"]);
    expect(targeting.age).toMatchObject({ min: 28, max: 60 });
    expect(targeting.audience).toMatchObject({ interestNames: plan.plan.interests, rationale: plan.plan.rationale });
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
});
