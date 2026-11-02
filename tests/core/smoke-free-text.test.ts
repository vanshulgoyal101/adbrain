import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import internal from "@/lib/internal-accounts.json";
import recorded from "./fixtures/planner/groq-meta-interest-names.json";
import { googleReply, openAIReply, requestUrl } from "./replay";

// #2230 (CTO, #2145): the scheduled smoke runs Prepare once a day and must spend $0. The smoke login's text uses
// free models only (Groq, Gemini); when they can't answer, the call fails with FREE_TEXT_UNAVAILABLE instead of
// paying OpenRouter. Real plan route, planner, router, providers and usage ledger; the network, auth and data reads
// are replaced. The plan is Groq's recorded reply to this route's prompt (Oct 26).

const SMOKE = { id: internal.smokeUserIds[0], email: "smoke@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
const CUSTOMER = { id: "7d2a5b1f-6b54-4d66-8c2a-4a8b4a1d3b21", email: "owner@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
const mocks = vi.hoisted(() => ({ user: null as unknown, rows: [] as Record<string, unknown>[] }));

const business = {
  id: "816aaafb-7ebc-4ad7-bbda-001beff172f8", name: "Cedar Ridge Chiropractic", vertical: "chiropractic clinic",
  description: "Chiropractic care in Austin.", target_audience: null,
  locations: ["Austin, Texas", "Round Rock", "Cedar Park"], offers: ["$49 new-patient exam"], website: null,
};
const creativeId = "e3d165a9-bbf8-47f7-8c61-e69dbb8ee3d1";
const audienceDraft = {
  businessId: business.id, name: "Cedar Ridge leads", goal: "Book new-patient exams", mode: "manual",
  creativeIds: [creativeId], dailyBudgetRupees: 500, leadFormId: "form-1", abTest: false,
  targeting: { location: { mode: "ai", cityScope: "city_only" }, age: { mode: "ai" } },
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => {
    const { observeVerifiedUser } = await import("@/lib/observability/context");
    observeVerifiedUser(mocks.user as never);
    return { data: { user: mocks.user } };
  } } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ insert: async (rows: Record<string, unknown>[]) => {
    mocks.rows.push(...rows);
    return { error: null };
  } }) }),
}));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/supabase/queries", () => ({
  getPrimaryBusiness: async () => business,
  getApprovedCreatives: async () => [{ id: creativeId, angle: "value", headline: "Diwali Renewal, Starting With Your Spine" }],
  getActiveInstructionsText: async () => "",
  getPerformanceContext: async () => "",
}));
vi.mock("@/lib/preferences/store", () => ({ preferenceContext: async () => "" }));
vi.mock("@/lib/meta/connection-access", () => ({
  ConnectionAccessError: class ConnectionAccessError extends Error { code = "UNAVAILABLE"; },
  requireOwnedBusiness: async () => ({ businessId: business.id, userId: "user-1" }),
  withMetaConnection: async () => { throw new Error("Meta unavailable"); },
}));

const groqDailyLimit = () => Response.json({ error: { message: "Rate limit reached for model `qwen/qwen3.8-27b` in organization `org_x` "
  + "service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199998, Requested 2013. Please try again in 600s." } },
{ status: 429, headers: { "retry-after": "600" } });
const googleBusy = () => Response.json({ error: { code: 429, message: "Resource has been exhausted", status: "RESOURCE_EXHAUSTED" } }, { status: 429 });

function network({ freeBusy }: { freeBusy: boolean }) {
  const hosts: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(requestUrl(input));
    hosts.push(url.hostname);
    if (url.hostname === "api.groq.com") return freeBusy ? groqDailyLimit() : openAIReply(recorded.text, recorded.model, { prompt: 2_100, completion: 640 });
    if (url.hostname === "generativelanguage.googleapis.com") return freeBusy ? googleBusy() : googleReply(recorded.text);
    if (url.hostname === "openrouter.ai") return openAIReply(recorded.text, "anthropic/claude-haiku-5.5");
    throw new Error(`Unexpected request to ${url.hostname}${url.pathname}`);
  }));
  return hosts;
}

async function prepare(user: typeof SMOKE) {
  mocks.user = user;
  const { POST } = await import("@/app/api/campaigns/plan/route");
  const response = await POST(new Request("http://localhost/api/campaigns/plan", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal: audienceDraft.goal, audienceDraft }),
  }));
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.resetModules();
  mocks.rows.length = 0;
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    GROQ_API_KEYS: "core-groq",
    GOOGLE_AI_API_KEYS: "core-google",
    GEMINI_MODEL: "gemini-3.6-flash",
    OPENROUTER_API_KEYS: "core-openrouter",
    OPENROUTER_MODEL: "anthropic/claude-haiku-5.5",
    CEREBRAS_API_KEYS: "",
    LLM_MONTHLY_TOKEN_LIMIT: "0",
    // Production's Prepare order (#366/#668): Groq, then Haiku, then Gemini.
    LLM_BUDGET_PROVIDER_ORDER: "groq,google",
  })) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("core: the smoke login's Prepare spends $0 (#2230)", () => {
  it("plans on Groq's recorded reply and its receipts cost $0", async () => {
    const hosts = network({ freeBusy: false });
    const { status, body } = await prepare(SMOKE);
    expect(status).toBe(200);
    expect(body.fallback).toBeUndefined();
    expect(body.targeting.age).toMatchObject({ min: 30, max: 60 });
    expect(hosts).not.toContain("openrouter.ai");
    expect(mocks.rows.map((row) => [row.route, row.provider, row.status, row.estimated_cost_usd])).toEqual([["campaigns.plan", "groq", "success", 0]]);
  });

  it("free models busy: never reaches OpenRouter and fails with FREE_TEXT_UNAVAILABLE", async () => {
    const hosts = network({ freeBusy: true });
    const { POST } = await import("@/app/api/campaigns/plan/route");
    mocks.user = SMOKE;
    const response = await POST(new Request("http://localhost/api/campaigns/plan", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal: audienceDraft.goal }),
    }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "FREE_TEXT_UNAVAILABLE" });
    expect(hosts).not.toContain("openrouter.ai");
    expect(hosts).toContain("api.groq.com");
    expect(mocks.rows.every((row) => row.estimated_cost_usd === 0)).toBe(true);
  });

  it("the router itself refuses paid text for the smoke login, whatever the route", async () => {
    const hosts = network({ freeBusy: true });
    const { eventContext, newEventContext, observeVerifiedUser } = await import("@/lib/observability/context");
    const { complete } = await import("@/lib/llm");
    const error = await eventContext.run(newEventContext(), () => {
      observeVerifiedUser(SMOKE);
      return complete([{ role: "user", content: "concept" }], { routing: "creative", nextProviders: ["openrouter"] }).catch((err: unknown) => err);
    });
    expect(error).toMatchObject({ name: "AllLLMProvidersFailedError", reason: "FREE_TEXT_UNAVAILABLE" });
    expect(hosts).not.toContain("openrouter.ai");
  });

  it("customers are unchanged: with the free models busy, Prepare still plans on Haiku", async () => {
    const hosts = network({ freeBusy: true });
    const { status, body } = await prepare(CUSTOMER);
    expect(status).toBe(200);
    expect(body.fallback).toBeUndefined();
    expect(hosts).toContain("openrouter.ai");
    expect(mocks.rows.find((row) => row.status === "success")).toMatchObject({ provider: "openrouter" });
    expect(Number(mocks.rows.find((row) => row.status === "success")?.estimated_cost_usd)).toBeGreaterThan(0);
  });
});
