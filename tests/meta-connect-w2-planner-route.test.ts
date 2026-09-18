import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rateLimitResponse: vi.fn(),
  getPrimaryBusiness: vi.fn(),
  getApprovedCreatives: vi.fn(),
  getActiveInstructionsText: vi.fn(),
  getPerformanceContext: vi.fn(),
  runPlanner: vi.fn(),
  requireOwnedBusiness: vi.fn(),
  withMetaConnection: vi.fn(),
  createLeadCampaign: vi.fn(),
  tokenLimit: vi.fn(), usage: vi.fn(), persist: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            gt: async () => ({ data: [], error: null }),
          }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: async () => ({
            data: {
              id: "d123d123-d123-4123-8123-d123d123d123",
              business_id: business.id,
              owner_id: "user-1",
              version: 1,
              input: {
                businessId: business.id,
                name: "Guided leads",
                goal: "Generate qualified leads",
                mode: "guided",
                creativeIds: [creativeId],
                dailyBudgetRupees: 500,
                leadFormId: "form-1",
                targeting: { location: { mode: "manual", included: [{ key: "jaipur", name: "Jaipur", type: "city" }], excluded: [] }, age: { mode: "manual", min: 25, max: 55 } },
                abTest: false,
              },
              expires_at: "2099-09-14T10:00:00.000Z",
              created_at: "2026-09-07T10:00:00.000Z",
              updated_at: "2026-09-07T10:00:00.000Z",
            },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: mocks.rateLimitResponse }));
vi.mock("@/lib/llm/persist", () => ({ configuredMonthlyTokenLimit: mocks.tokenLimit, monthlyTokenUsage: mocks.usage, persistLLMUsage: mocks.persist }));
vi.mock("@/lib/supabase/queries", () => ({
  getPrimaryBusiness: mocks.getPrimaryBusiness,
  getApprovedCreatives: mocks.getApprovedCreatives,
  getActiveInstructionsText: mocks.getActiveInstructionsText,
  getPerformanceContext: mocks.getPerformanceContext,
}));
vi.mock("@/lib/campaign/planner", () => ({
  formatAnswers: (answers: unknown[]) => JSON.stringify(answers),
  runPlanner: mocks.runPlanner,
  PLANNER_PROMPT_VERSION: "campaign-planner-v2",
}));
vi.mock("@/lib/meta/connection-access", () => ({
  ConnectionAccessError: class ConnectionAccessError extends Error {
    code = "UNAVAILABLE";
  },
  requireOwnedBusiness: mocks.requireOwnedBusiness,
  withMetaConnection: mocks.withMetaConnection,
}));
vi.mock("@/lib/meta/client", () => ({
  friendlyMetaError: (_error: unknown, fallback: string) => fallback,
}));

const business = {
  id: "b123b123-b123-4123-8123-b123b123b123",
  name: "Test Business",
  vertical: "local business",
  description: null,
  target_audience: null,
  locations: ["Jaipur"],
  offers: [],
  website: null,
};
const creativeId = "c123c123-c123-4123-8123-c123c123c123";

function post(): Request {
  return new Request("http://localhost/api/campaigns/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal: "Generate qualified leads" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tokenLimit.mockReturnValue(1000);
  mocks.usage.mockResolvedValue(0);
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.rateLimitResponse.mockResolvedValue(null);
  mocks.getPrimaryBusiness.mockResolvedValue(business);
  mocks.getApprovedCreatives.mockResolvedValue([{
    id: creativeId,
    angle: "local",
    headline: "Local help",
    image_url: "https://example.com/ad.png",
    primary_text: "Message",
    cta: "Learn More",
  }]);
  mocks.getActiveInstructionsText.mockResolvedValue("");
  mocks.getPerformanceContext.mockResolvedValue("");
  mocks.requireOwnedBusiness.mockResolvedValue({ businessId: business.id, userId: "user-1" });
  mocks.withMetaConnection.mockImplementation(async (_context, _options, execute) =>
    execute({ listLeadForms: vi.fn().mockResolvedValue([{ id: "form-1", name: "Leads" }]) }),
  );
  mocks.runPlanner.mockResolvedValue({
    ready: true,
    plan: {
      name: "Guided leads",
      daily_budget_rupees: 500,
      lead_form_id: "form-1",
      creative_ids: [creativeId],
      age_min: 25,
      age_max: 55,
      locations: ["Jaipur"],
      excluded_locations: [],
      interests: ["Home improvement"],
      destination: "instant_form",
      special_ad_category: "none",
      rationale: "Use the approved local creative.",
    },
  });
});

describe("guided planner route", () => {
  it.each(["city_only", "radius"])("preserves owner city scope %s in an AI recommendation", async (cityScope) => {
    const audienceDraft = {
      businessId: business.id, name: "Leads", goal: "Leads", mode: "manual", creativeIds: [creativeId],
      dailyBudgetRupees: 500, leadFormId: null, abTest: false,
      targeting: { location: { mode: "ai", cityScope, radiusKm: 35 } },
    };
    const { POST } = await import("@/app/api/campaigns/plan/route");
    const response = await POST(new Request("http://localhost/api/campaigns/plan", { method: "POST", body: JSON.stringify({ goal: "Leads", audienceDraft }) }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.targeting.location.cityScope).toBe(cityScope);
    if (cityScope === "city_only") expect(body.targeting.location).not.toHaveProperty("radiusKm");
    else expect(body.targeting.location.radiusKm).toBe(25);
  });

  it.each([{ used: null, status: 503 }, { used: 1000, status: 429 }])("blocks planning when usage is $used", async ({ used, status }) => {
    mocks.usage.mockResolvedValue(used);
    const { POST } = await import("@/app/api/campaigns/plan/route");
    expect((await POST(post())).status).toBe(status);
    expect(mocks.runPlanner).not.toHaveBeenCalled();
  });

  it("records usage even for invalid planner output without storing prompt text", async () => {
    mocks.runPlanner.mockImplementationOnce(async (_input, options) => {
      await options.onCompletion({ provider: "test", model: "test", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }, false);
      throw new Error("invalid response");
    });
    const { POST } = await import("@/app/api/campaigns/plan/route");
    expect((await POST(post())).status).toBe(502);
    expect(mocks.persist).toHaveBeenCalledWith([expect.objectContaining({ businessId: business.id, route: "campaigns.plan", status: "error", errorCode: "PLANNER_VALIDATION", metadata: { audienceOnly: false } })]);
  });

  it("recommends targeting without saving a duplicate draft or reading Meta, retaining manual choices", async () => {
    const audienceDraft = {
      businessId: business.id, name: "Owner name", goal: "Qualified leads", mode: "manual",
      creativeIds: [creativeId], dailyBudgetRupees: 700, leadFormId: "owner-form", abTest: false,
      targeting: { age: { mode: "manual", min: 30, max: 60 }, location: { mode: "manual", included: [{ key: "city-1", name: "Jaipur", type: "city" }], radiusKm: 25 } },
    };
    const { POST } = await import("@/app/api/campaigns/plan/route");
    const response = await POST(new Request("http://localhost/api/campaigns/plan", { method: "POST", body: JSON.stringify({ goal: audienceDraft.goal, audienceDraft }) }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.draft).toBeUndefined();
    expect(body.targeting.age).toEqual(audienceDraft.targeting.age);
    expect(body.targeting.location).toEqual(audienceDraft.targeting.location);
    expect(body.targeting.audience.rationale).toBe("Use the approved local creative.");
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
    expect(mocks.createLeadCampaign).not.toHaveBeenCalled();
  });

  it("rejects audience planning for another business before the model is called", async () => {
    const { POST } = await import("@/app/api/campaigns/plan/route");
    const response = await POST(new Request("http://localhost/api/campaigns/plan", { method: "POST", body: JSON.stringify({
      goal: "Leads", audienceDraft: { businessId: creativeId, name: "Leads", goal: "Leads", mode: "manual", creativeIds: [creativeId], dailyBudgetRupees: 500, leadFormId: null, targeting: {}, abTest: false },
    }) }));
    expect(response.status).toBe(403);
    expect(mocks.runPlanner).not.toHaveBeenCalled();
  });

  it("replaces old AI location suggestions while preserving manual age and exclusions", async () => {
    const audienceDraft = {
      businessId: business.id, name: "Owner name", goal: "Qualified leads", mode: "manual",
      creativeIds: [creativeId], dailyBudgetRupees: 700, leadFormId: "owner-form", abTest: false,
      targeting: { gender: "women", age: { mode: "manual", min: 30, max: 60 }, location: { mode: "ai", includedNames: ["Delhi"], excludedNames: ["Ajmer"], radiusKm: 25 } },
    };
    const { POST } = await import("@/app/api/campaigns/plan/route");
    const response = await POST(new Request("http://localhost/api/campaigns/plan", { method: "POST", body: JSON.stringify({ goal: audienceDraft.goal, audienceDraft }) }));
    const body = await response.json();
    expect(body.targeting.location.includedNames).toEqual(["Jaipur"]);
    expect(body.targeting.location.excludedNames).toEqual(["Ajmer"]);
    expect(body.targeting.age).toEqual(audienceDraft.targeting.age);
    expect(body.targeting.gender).toBe("women");
  });

  it("retains explicitly typed place names including commas", async () => {
    const audienceDraft = {
      businessId: business.id, name: "Owner name", goal: "Qualified leads", mode: "manual",
      creativeIds: [creativeId], dailyBudgetRupees: 700, leadFormId: "owner-form", abTest: false,
      targeting: { age: { mode: "ai" }, location: { mode: "manual", includedNames: ["Austin, Texas"], radiusKm: 35 } },
    };
    const { POST } = await import("@/app/api/campaigns/plan/route");
    const response = await POST(new Request("http://localhost/api/campaigns/plan", { method: "POST", body: JSON.stringify({ goal: audienceDraft.goal, audienceDraft }) }));
    expect((await response.json()).targeting.location).toEqual(audienceDraft.targeting.location);
  });
  it("plans and saves a draft while Meta is unavailable", async () => {
    mocks.withMetaConnection.mockRejectedValueOnce(new Error("Meta not connected"));
    const proposed = await mocks.runPlanner();
    mocks.runPlanner.mockResolvedValueOnce({ ...proposed, plan: { ...proposed.plan, lead_form_id: null } });
    const { POST } = await import("@/app/api/campaigns/plan/route");
    const response = await POST(post());
    expect(response.status).toBe(200);
    expect((await response.json()).ready).toBe(true);
    expect(mocks.runPlanner).toHaveBeenLastCalledWith(expect.objectContaining({ leadForms: [] }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(mocks.createLeadCampaign).not.toHaveBeenCalled();
  });

  it("rejects malformed planner input before provider calls", async () => {
    const { POST } = await import("@/app/api/campaigns/plan/route");
    const response = await POST(new Request("http://localhost/api/campaigns/plan", { method: "POST", body: JSON.stringify({ goal: 42 }) }));
    expect(response.status).toBe(400);
    expect(mocks.runPlanner).not.toHaveBeenCalled();
  });

  it("returns a validated proposal without making a Meta mutation", async () => {
    const { POST } = await import("@/app/api/campaigns/plan/route");
    const response = await POST(post());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.draft).toMatchObject({
      input: {
        businessId: business.id,
        mode: "guided",
        creativeIds: [creativeId],
        leadFormId: "form-1",
      },
    });
    expect(mocks.createLeadCampaign).not.toHaveBeenCalled();
  });
});