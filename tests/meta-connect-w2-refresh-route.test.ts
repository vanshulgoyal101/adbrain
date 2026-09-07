import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  requireOwnedBusiness: vi.fn(),
  withMetaConnection: vi.fn(),
  metaClientForBusiness: vi.fn(),
  summarizeInsights: vi.fn(),
  enforceAutoPause: vi.fn(),
  logEvent: vi.fn(),
}));

const campaign = {
  id: "campaign-1",
  business_id: "business-1",
  meta_campaign_id: "meta-campaign-1",
  objective: "leads",
  name: "Campaign",
  daily_budget: 500,
  status: "paused",
  meta_ad_account_id: "act_123" as string | null,
  meta_page_id: "page_123",
  meta_connection_generation: 4,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: (table: string) => {
      if (table === "campaigns") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: campaign }) }),
          }),
        };
      }
      return {
        insert: () => ({
          select: () => ({ single: async () => ({ data: { id: "result-1" } }) }),
        }),
      };
    },
  }),
}));
vi.mock("@/lib/meta/connection-access", () => ({
  ConnectionAccessError: class ConnectionAccessError extends Error {
    code = "CONFLICT";
  },
  requireOwnedBusiness: mocks.requireOwnedBusiness,
  withMetaConnection: mocks.withMetaConnection,
}));
vi.mock("@/lib/meta/credentials", () => ({ metaClientForBusiness: mocks.metaClientForBusiness }));
vi.mock("@/lib/creative/summary", () => ({ summarizeInsights: mocks.summarizeInsights }));
vi.mock("@/lib/campaign/spend-enforce", () => ({ enforceAutoPause: mocks.enforceAutoPause }));
vi.mock("@/lib/audit", () => ({ logEvent: mocks.logEvent }));

function request(): Request {
  return new Request("http://localhost/api/campaigns/campaign-1/refresh", { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.requireOwnedBusiness.mockResolvedValue({ businessId: "business-1", userId: "user-1" });
  mocks.withMetaConnection.mockImplementation(async (_context, _options, execute) =>
    execute({ getCampaignInsights: vi.fn().mockResolvedValue({ impressions: 1, clicks: 2, leads: 1, spend: 3, cpl: 3 }) }),
  );
  mocks.summarizeInsights.mockResolvedValue("Summary");
  mocks.enforceAutoPause.mockResolvedValue([]);
});

describe("campaign refresh binding boundary", () => {
  it("uses the stored account, page, and generation for insight reads", async () => {
    const { POST } = await import("@/app/api/campaigns/[id]/refresh/route");
    const response = await POST(request(), { params: Promise.resolve({ id: "campaign-1" }) });

    expect(response.status).toBe(200);
    expect(mocks.withMetaConnection).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: "business-1" }),
      {
        purpose: "read_insights",
        binding: { adAccountId: "act_123", pageId: "page_123" },
        expectedGeneration: 4,
      },
      expect.any(Function),
    );
    expect(mocks.metaClientForBusiness).not.toHaveBeenCalled();
  });

  it("blocks an old row without binding before any provider access", async () => {
    const { POST } = await import("@/app/api/campaigns/[id]/refresh/route");
    const original = campaign.meta_ad_account_id;
    campaign.meta_ad_account_id = null;

    const response = await POST(request(), { params: Promise.resolve({ id: "campaign-1" }) });

    campaign.meta_ad_account_id = original;
    expect(response.status).toBe(409);
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
    expect(mocks.metaClientForBusiness).not.toHaveBeenCalled();
  });
});