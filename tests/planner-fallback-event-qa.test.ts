import { beforeEach, describe, expect, it, vi } from "vitest";
import { AllLLMProvidersFailedError } from "@/lib/llm/types";

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
  friendlyMetaError: vi.fn(),
  inserted: vi.fn(),
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
      insert: (row: unknown) => (mocks.inserted(row), {
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
vi.mock("@/lib/campaign/planner", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/campaign/planner")>(),
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
  friendlyMetaError: mocks.friendlyMetaError,
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.friendlyMetaError.mockImplementation((_error: unknown, fallback: string) => fallback);
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

// QA red test for #612, from production (Oct 24 10–13Z): 26 audience-only plans were counted as
// `campaign.plan` failed (PLAN_MODEL_EXHAUSTED_RATE_LIMIT / _MIXED / _COOLDOWN), yet each one answered
// with fallback targeting, so the owner could still launch. A fallback is a partial result, not a
// failure: counting it as failed makes #612's "< 2 failures a day" measure the wrong thing.
describe("QA #612: an audience plan that falls back is partial, not failed", () => {
  it.each(["RATE_LIMIT", "MIXED", "COOLDOWN"] as const)("records %s exhaustion on an audience plan as partial with fallback targeting", async (reason) => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      mocks.runPlanner.mockRejectedValueOnce(new AllLLMProvidersFailedError(reason, 2));
      const audienceDraft = {
        businessId: business.id, name: "Owner name", goal: "Qualified leads", mode: "manual",
        creativeIds: [creativeId], dailyBudgetRupees: 700, leadFormId: "owner-form", abTest: false,
        targeting: { age: { mode: "manual", min: 30, max: 60 }, location: { mode: "manual", included: [{ key: "city-1", name: "Jaipur", type: "city" }], radiusKm: 25 } },
      };
      const { POST } = await import("@/app/api/campaigns/plan/route");
      const response = await POST(new Request("http://localhost/api/campaigns/plan", { method: "POST", body: JSON.stringify({ goal: audienceDraft.goal, audienceDraft }) }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ready: true, fallback: true });
      const planEvents = info.mock.calls.map(([entry]) => String(entry)).filter((entry) => entry.includes('"name":"campaign.plan"'));
      expect(planEvents.some((entry) => entry.includes('"outcome":"failed"'))).toBe(false);
      expect(planEvents.some((entry) => entry.includes('"outcome":"partial"') && entry.includes(`EXHAUSTED_${reason}`))).toBe(true);
    } finally {
      info.mockRestore();
    }
  });
});
