import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  metaClientForBusiness: vi.fn(),
  requireOwnedBusiness: vi.fn(),
  withMetaConnection: vi.fn(),
  creatives: [] as Record<string, unknown>[],
}));

const getUser = mocks.getUser;
const metaClientForBusiness = mocks.metaClientForBusiness;
const business: {
  id: string;
  website: string;
  locations: string[];
} = {
  id: "11111111-1111-4111-8111-111111111111",
  website: "https://example.com",
  locations: [],
};

vi.mock("@/lib/meta/credentials", () => ({ metaClientForBusiness }));
vi.mock("@/lib/meta/connection-access", () => ({
  ConnectionAccessError: class ConnectionAccessError extends Error {},
  requireOwnedBusiness: mocks.requireOwnedBusiness,
  withMetaConnection: mocks.withMetaConnection,
}));
vi.mock("@/lib/audit", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from(table: string) {
      if (table === "businesses") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: business }) }),
            order: async () => ({ data: [business] }),
          }),
        };
      }
      return {
        select: () => ({
          "in": () => ({
            eq: () => ({
              eq: async () => ({ data: mocks.creatives }),
            }),
          }),
        }),
      };
    },
  }),
}));

function post(body: unknown): Request {
  return new Request("http://localhost/api/campaigns/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  businessId: business.id,
  creativeIds: ["creative-other-brand"],
  dailyBudget: 500,
  leadFormId: "form-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.creatives.length = 0;
  business.locations = [];
  getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
  mocks.requireOwnedBusiness.mockResolvedValue({ businessId: business.id, userId: "owner-1" });
  mocks.withMetaConnection.mockImplementation(async (_context, _options, execute) =>
    execute({
      listLeadForms: vi.fn().mockResolvedValue([{ id: "form-1" }]),
      resolveGeoTargeting: vi.fn().mockResolvedValue({
        targeting: {},
        matched: [{ label: "Mohali" }],
        unresolved: [],
      }),
      createLeadCampaign: vi.fn().mockResolvedValue({
        campaignId: "campaign-1",
        adSetId: "adset-1",
        adSetIds: ["adset-1"],
        adIds: ["ad-1"],
        destination: "instant_form",
      }),
    }, {
      generation: 1,
      selected: { currency: "INR" },
      capabilities: { canCreatePaused: { state: "available", blockers: [] } },
    }),
  );
  metaClientForBusiness.mockResolvedValue({
    listLeadForms: vi.fn(),
  });
});

describe("campaign create authorization boundary", () => {
  it("rejects a foreign business before resolving Meta credentials", async () => {
    const { POST } = await import("@/app/api/campaigns/create/route");
    const response = await POST(post({ ...validBody, businessId: "foreign-business" }));

    expect(response.status).toBe(400);
    expect(metaClientForBusiness).not.toHaveBeenCalled();
  });

  it("rejects another brand's creative before any Meta call", async () => {
    const { POST } = await import("@/app/api/campaigns/create/route");
    const response = await POST(post(validBody));

    expect(response.status).toBe(400);
    expect(metaClientForBusiness).not.toHaveBeenCalled();
  });

  it("rejects the removed legacy create shape before any provider access", async () => {
    business.locations = ["Unknown area"];
    mocks.creatives.push({
      id: "creative-1",
      business_id: business.id,
      status: "approved",
      image_url: "https://example.com/ad.png",
      headline: "Local help",
      primary_text: "Message",
      cta: "Learn More",
    });
    mocks.withMetaConnection.mockImplementationOnce(async (_context, _options, execute) =>
      execute({
        listLeadForms: vi.fn().mockResolvedValue([{ id: "form-1" }]),
        resolveGeoTargeting: vi.fn().mockResolvedValue({
          targeting: {},
          matched: [],
          unresolved: ["Unknown area"],
        }),
        createLeadCampaign: vi.fn(),
      }, {
        generation: 1,
        selected: { currency: "INR" },
        capabilities: { canCreatePaused: { state: "available", blockers: [] } },
      }),
    );

    const { POST } = await import("@/app/api/campaigns/create/route");
    const response = await POST(post({
      businessId: business.id,
      creativeIds: ["creative-1"],
      dailyBudget: 500,
      leadFormId: "form-1",
    }));

    expect(response.status).toBe(400);
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
    expect(metaClientForBusiness).not.toHaveBeenCalled();
  });

  it("rejects the removed legacy capability-test shape before any Meta mutation", async () => {
    mocks.creatives.push({
      id: "creative-1",
      business_id: business.id,
      status: "approved",
      image_url: "https://example.com/ad.png",
      headline: "Local help",
    });
    mocks.withMetaConnection.mockImplementationOnce(async (_context, _options, execute) =>
      execute({
        listLeadForms: vi.fn(),
        resolveGeoTargeting: vi.fn(),
        createLeadCampaign: vi.fn(),
      }, {
        generation: 1,
        selected: { currency: "INR" },
        capabilities: { canCreatePaused: { state: "unknown", blockers: [] } },
      }),
    );

    const { POST } = await import("@/app/api/campaigns/create/route");
    const response = await POST(post({
      businessId: business.id,
      creativeIds: ["creative-1"],
      dailyBudget: 500,
      leadFormId: "form-1",
    }));

    expect(response.status).toBe(400);
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
  });

  it("rejects nonfinite, oversized, and silently-truncated create inputs before boundary access", async () => {
    const { POST } = await import("@/app/api/campaigns/create/route");
    const cases = [
      { ...validBody, dailyBudget: "NaN" },
      { ...validBody, dailyBudget: 10_000_001 },
      { ...validBody, creativeIds: Array.from({ length: 51 }, (_, index) => `creative-${index}`) },
    ];

    for (const body of cases) {
      mocks.withMetaConnection.mockClear();
      const response = await POST(post(body));
      expect(response.status).toBe(400);
      expect(mocks.withMetaConnection).not.toHaveBeenCalled();
    }
  });

  it("does not run legacy campaign sync without binding storage", async () => {
    const { POST } = await import("@/app/api/campaigns/sync/route");
    const response = await POST();

    expect(response.status).toBe(503);
    expect(mocks.metaClientForBusiness).not.toHaveBeenCalled();
  });
});