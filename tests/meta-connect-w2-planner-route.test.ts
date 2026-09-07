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
vi.mock("@/lib/supabase/queries", () => ({
  getPrimaryBusiness: mocks.getPrimaryBusiness,
  getApprovedCreatives: mocks.getApprovedCreatives,
  getActiveInstructionsText: mocks.getActiveInstructionsText,
  getPerformanceContext: mocks.getPerformanceContext,
}));
vi.mock("@/lib/campaign/planner", () => ({
  formatAnswers: (answers: unknown[]) => JSON.stringify(answers),
  runPlanner: mocks.runPlanner,
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
      destination: "instant_form",
      rationale: "Use the approved local creative.",
    },
  });
});

describe("guided planner route", () => {
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