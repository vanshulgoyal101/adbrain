import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  requireOwnedBusiness: vi.fn(),
  getConnectionStatus: vi.fn(),
  withMetaConnection: vi.fn(),
  metaClientForBusiness: vi.fn(),
  draft: null as Record<string, unknown> | null,
}));

const businessId = "b123b123-b123-4123-8123-b123b123b123";
const draftId = "d123d123-d123-4123-8123-d123d123d123";
const creativeId = "c123c123-c123-4123-8123-c123c123c123";
const userId = "a123a123-a123-4123-8123-a123a123a123";

const draftRow = {
  id: draftId,
  business_id: businessId,
  owner_id: userId,
  version: 1,
  input: {
    businessId,
    name: "Campaign",
    goal: "Leads",
    mode: "manual",
    creativeIds: [creativeId],
    dailyBudgetRupees: 500,
    leadFormId: "form-1",
    targeting: {},
    abTest: false,
  },
  expires_at: "2099-09-14T10:00:00.000Z",
  created_at: "2026-09-07T10:00:00.000Z",
  updated_at: "2026-09-07T10:00:00.000Z",
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: (table: string) => {
      if (table === "campaign_drafts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: mocks.draft ?? draftRow, error: null }) }),
              }),
            }),
          }),
        };
      }
      if (table === "creatives") {
        return {
          select: () => ({
            in: () => ({
              eq: async () => ({ data: [{ id: creativeId, business_id: businessId, status: "approved", image_url: "https://example.com/ad.png", headline: "Headline" }] }),
            }),
          }),
        };
      }
      if (table === "businesses") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { locations: ["Jaipur"] } }) }) }),
        };
      }
      return {};
    },
  }),
}));
vi.mock("@/lib/meta/connection-access", () => ({
  ConnectionAccessError: class ConnectionAccessError extends Error { code = "UNAVAILABLE"; },
  requireOwnedBusiness: mocks.requireOwnedBusiness,
  getConnectionStatus: mocks.getConnectionStatus,
  withMetaConnection: mocks.withMetaConnection,
}));
vi.mock("@/lib/meta/credentials", () => ({ metaClientForBusiness: mocks.metaClientForBusiness }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.draft = null;
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
  mocks.requireOwnedBusiness.mockResolvedValue({ businessId, userId });
  mocks.getConnectionStatus.mockResolvedValue({
    generation: 4,
    selected: {
      metaBusinessId: null,
      adAccountId: "act_1",
      accountName: "Account",
      pageId: "page_1",
      pageName: "Page",
      currency: "INR",
      timezoneName: "Asia/Kolkata",
    },
    capabilities: { canCreatePaused: { state: "available", blockers: [] } },
  });
  mocks.withMetaConnection.mockImplementation(async (_context, _options, execute) =>
    execute({
      listLeadForms: vi.fn().mockResolvedValue([{ id: "form-1", status: "ACTIVE" }]),
      resolveGeoTargeting: vi.fn().mockResolvedValue({ matched: [{ label: "Jaipur" }], unresolved: [], targeting: {} }),
    }),
  );
});

function request(body: unknown): Request {
  return new Request("http://localhost/api/campaigns/preflight", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/campaigns/preflight", () => {
  it("returns a review envelope and never calls the legacy provider resolver", async () => {
    const { POST } = await import("@/app/api/campaigns/preflight/route");
    const response = await POST(request({ businessId, draftId, draftVersion: 1 }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({ draftId, draftVersion: 1, connectionGeneration: 4 });
    expect(mocks.metaClientForBusiness).not.toHaveBeenCalled();
  });

  it("rejects a stale draft version before provider-dependent loaders", async () => {
    const { POST } = await import("@/app/api/campaigns/preflight/route");
    const response = await POST(request({ businessId, draftId, draftVersion: 2 }));

    expect(response.status).toBe(409);
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
  });
});