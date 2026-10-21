import { beforeEach, describe, expect, it, vi } from "vitest";

// Prepare (audience planning) through the real route and real runPlanner; only
// the LLM transport, auth, rate limiting and data reads are stubbed.
const mocks = vi.hoisted(() => ({ complete: vi.fn(), persist: vi.fn() }));

const business = {
  id: "816aaafb-7ebc-4ad7-bbda-001beff172f8", name: "Cedar Ridge Chiropractic", vertical: "chiropractic clinic",
  description: "Chiropractic care in Austin.", target_audience: null,
  locations: ["Austin, Texas", "Round Rock", "Cedar Park"], offers: ["$49 new-patient exam"], website: null,
};
const creativeId = "e3d165a9-bbf8-47f7-8c61-e69dbb8ee3d1";

vi.mock("@/lib/llm", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/llm")>(),
  complete: mocks.complete,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) } }),
}));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/llm/persist", () => ({
  configuredMonthlyTokenLimit: () => 1_000_000, monthlyTokenUsage: async () => 0, persistLLMUsage: mocks.persist,
}));
vi.mock("@/lib/supabase/queries", () => ({
  getPrimaryBusiness: async () => business,
  getApprovedCreatives: async () => [{
    id: creativeId, angle: "value", headline: "Diwali Renewal, Starting With Your Spine",
    image_url: "https://example.com/ad.png", primary_text: "A $49 new-patient exam.", cta: "Book Now",
  }],
  getActiveInstructionsText: async () => "",
  getPerformanceContext: async () => "",
}));
vi.mock("@/lib/meta/connection-access", () => ({
  ConnectionAccessError: class ConnectionAccessError extends Error { code = "UNAVAILABLE"; },
  requireOwnedBusiness: async () => ({ businessId: business.id, userId: "user-1" }),
  withMetaConnection: async () => { throw new Error("Prepare must not call Meta for an audience draft."); },
}));

const audienceDraft = {
  businessId: business.id, name: "Cedar Ridge leads", goal: "Book new-patient exams", mode: "manual",
  creativeIds: [creativeId], dailyBudgetRupees: 500, leadFormId: "form-1", abTest: false,
  targeting: { location: { mode: "ai", cityScope: "city_only" }, age: { mode: "ai" } },
};
const plannerPlan = {
  name: "Cedar Ridge leads", daily_budget_rupees: 500, lead_form_id: "form-1", creative_ids: [creativeId],
  age_min: 28, age_max: 60, radius_km: 25, city_scope: "city_only",
  interests: ["Chiropractic", "Back pain", "Physical therapy"], special_ad_category: "none",
  locations: ["Austin, Texas", "Round Rock", "Cedar Park"], excluded_locations: [], destination: "instant_form",
  rationale: "Adults in the clinic's service area with back-pain and wellness interests.",
};
const usage = { promptTokens: 1200, completionTokens: 300, totalTokens: 1500 };

async function prepare() {
  const { POST } = await import("@/app/api/campaigns/plan/route");
  const response = await POST(new Request("http://localhost/api/campaigns/plan", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal: audienceDraft.goal, audienceDraft }),
  }));
  return { status: response.status, body: await response.json() };
}

beforeEach(() => vi.clearAllMocks());

describe("core: Prepare audience", () => {
  it("returns planner targeting when the model answers", async () => {
    mocks.complete.mockResolvedValue({ text: JSON.stringify({ ready: true, plan: plannerPlan }), provider: "google", model: "gemini", usage });
    const { status, body } = await prepare();
    expect(status).toBe(200);
    expect(body.fallback).toBeUndefined();
    expect(body.targeting.audience.interestNames).toEqual(plannerPlan.interests);
    expect(body.targeting.age).toMatchObject({ min: 28, max: 60 });
  });

  it.each([
    ["timeout", new DOMException("The operation was aborted due to timeout", "TimeoutError")],
    ["provider failure", new Error("all providers failed")],
  ])("still produces usable targeting after a planner %s", async (_label, error) => {
    mocks.complete.mockRejectedValue(error);
    const { status, body } = await prepare();
    expect(status).toBe(200);
    expect(body).toMatchObject({ ready: true, fallback: true });
    expect(body.targeting).toMatchObject({
      gender: "all", location: { mode: "ai", cityScope: "city_only" },
      age: { mode: "manual", min: 25, max: 55 }, audience: { interestNames: [] },
    });
    expect(body.targeting.audience.rationale).toBeTruthy();
  });
});
