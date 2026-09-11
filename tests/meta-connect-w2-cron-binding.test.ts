import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminFrom: vi.fn(),
  requireScheduledBusiness: vi.fn(),
  withMetaConnection: vi.fn(),
  updateCampaignStatus: vi.fn(),
}));

const boundCampaign = {
  id: "campaign-1",
  business_id: "business-1",
  status: "active",
  daily_budget: 500,
  meta_campaign_id: "meta-campaign-1",
  meta_ad_account_id: "act_123",
  meta_page_id: "page_123",
  meta_connection_generation: 4,
};

vi.mock("@/lib/env", () => ({ getEnv: () => ({ CRON_SECRET: "cron-secret" }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.adminFrom }),
}));
vi.mock("@/lib/meta/connection-access", () => ({
  ConnectionAccessError: class ConnectionAccessError extends Error {},
  requireScheduledBusiness: mocks.requireScheduledBusiness,
  withMetaConnection: mocks.withMetaConnection,
}));

function configureAdmin(campaigns: Record<string, unknown>[]) {
  mocks.adminFrom.mockImplementation((table: string) => {
    if (table === "spend_limits") {
      return {
        select: () => ({
          eq: () => ({
            gt: async () => ({
              data: [{ business_id: "business-1", weekly_cap_rupees: 7000, alert_pct: 80, auto_pause: true }],
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "campaigns") {
      return {
        select: () => ({ eq: async () => ({ data: campaigns }) }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
    }
    if (table === "campaign_results") {
      return {
        select: () => ({
          in: () => ({
            order: async () => ({ data: [{ campaign_id: "campaign-1", spend: 7000, fetched_at: "2026-09-07T00:00:00Z" }] }),
          }),
        }),
      };
    }
    return { insert: async () => ({ error: null }) };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireScheduledBusiness.mockResolvedValue({ businessId: "business-1", userId: "system" });
  mocks.withMetaConnection.mockImplementation(async (_context, _options, execute) =>
    execute({ updateCampaignStatus: mocks.updateCampaignStatus }, {
      generation: 4,
      selected: {
        metaBusinessId: null,
        adAccountId: "act_123",
        accountName: "Account",
        pageId: "page_123",
        pageName: "Page",
        currency: "INR",
        timezoneName: "Asia/Kolkata",
      },
      capabilities: { canActivate: { state: "available", blockers: [] } },
    }),
  );
  mocks.updateCampaignStatus.mockResolvedValue(undefined);
  configureAdmin([boundCampaign]);
});

describe("scheduled spend binding boundary", () => {
  it("uses verified scheduler context and original binding for auto-pause", async () => {
    const { GET } = await import("@/app/api/cron/enforce-spend/route");
    const response = await GET(new Request("http://localhost/api/cron/enforce-spend", {
      headers: { authorization: "Bearer cron-secret" },
    }));

    expect(response.status).toBe(200);
    expect(mocks.requireScheduledBusiness).toHaveBeenCalledWith(
      "business-1",
      expect.any(Request),
    );
    expect(mocks.withMetaConnection).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: "business-1" }),
      expect.objectContaining({
        purpose: "pause",
        binding: { adAccountId: "act_123", pageId: "page_123" },
        expectedGeneration: 4,
      }),
      expect.any(Function),
    );
    expect(mocks.updateCampaignStatus).toHaveBeenCalledWith("meta-campaign-1", "PAUSED");
  });

  it("skips an unmapped campaign without a provider call", async () => {
    configureAdmin([{ ...boundCampaign, meta_ad_account_id: null }]);
    const { GET } = await import("@/app/api/cron/enforce-spend/route");
    const response = await GET(new Request("http://localhost/api/cron/enforce-spend", {
      headers: { authorization: "Bearer cron-secret" },
    }));

    expect(response.status).toBe(200);
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
  });
});