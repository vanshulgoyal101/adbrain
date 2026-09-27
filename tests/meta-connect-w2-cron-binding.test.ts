import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminFrom: vi.fn(),
  requireScheduledBusiness: vi.fn(),
  withMetaConnection: vi.fn(),
  updateCampaignStatus: vi.fn(),
  getCampaignInsights: vi.fn(),
  getCustomerBalance: vi.fn(),
  confirmCustomerCampaign: vi.fn(),
  failedTable: "",
  updateError: null as { message: string } | null,
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
  createAdminClient: () => ({ from: mocks.adminFrom, rpc: async () => ({ error: null }) }),
}));
vi.mock("@/lib/payments/customer-balance", () => ({
  getCustomerBalance: mocks.getCustomerBalance,
  confirmCustomerCampaign: mocks.confirmCustomerCampaign,
}));
vi.mock("@/lib/meta/connection-access", () => ({
  ConnectionAccessError: class ConnectionAccessError extends Error {},
  requireScheduledBusiness: mocks.requireScheduledBusiness,
  withMetaConnection: mocks.withMetaConnection,
}));

function configureAdmin(campaigns: Record<string, unknown>[]) {
  const page = (table: string, rows: Record<string, unknown>[]) => {
    let after: string | null = null;
    let orderKey = "id";
    let pageSize = 100;
    const query = {
      eq: () => query,
      gt: (key: string, value: string | number) => { if (key === orderKey) after = String(value); return query; },
      order: (key: string) => { orderKey = key; return query; },
      limit: (value: number) => { pageSize = value; return query; },
      then: (resolve: (value: unknown) => unknown) => resolve({
        data: rows.filter(row => after === null || String(row[orderKey]) > after).slice(0, pageSize),
        error: mocks.failedTable === table ? { message: "private database failure" } : null,
      }),
    };
    return { select: () => query };
  };
  mocks.adminFrom.mockImplementation((table: string) => {
    if (table === "spend_limits") {
      return page(table, [{ business_id: "business-1", weekly_cap_rupees: 7000, alert_pct: 80, auto_pause: true }]);
    }
    if (table === "campaigns") {
      return {
        ...page(table, campaigns),
        update: () => ({ eq: async () => ({ error: mocks.updateError }) }),
      };
    }
    return { insert: async () => ({ error: null }) };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.failedTable = "";
  mocks.updateError = null;
  mocks.requireScheduledBusiness.mockResolvedValue({ businessId: "business-1", userId: "system" });
  mocks.getCustomerBalance.mockResolvedValue({ held: false, reservations: [] });
  mocks.confirmCustomerCampaign.mockResolvedValue(undefined);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find(value => value.type === type)?.value;
  const periodEnd = `${part("year")}-${part("month")}-${part("day")}`;
  const start = new Date(`${periodEnd}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  mocks.getCampaignInsights.mockResolvedValue({ spend: 7000, periodStart: start.toISOString().slice(0, 10), periodEnd });
  mocks.withMetaConnection.mockImplementation(async (_context, _options, execute) =>
    execute({ updateCampaignStatus: mocks.updateCampaignStatus, getCampaignInsights: mocks.getCampaignInsights }, {
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
    expect(mocks.getCampaignInsights).toHaveBeenCalledWith("meta-campaign-1", { weekly: true });
  });

  it("skips an unmapped campaign without a provider call", async () => {
    configureAdmin([{ ...boundCampaign, meta_ad_account_id: null }]);
    const { GET } = await import("@/app/api/cron/enforce-spend/route");
    const response = await GET(new Request("http://localhost/api/cron/enforce-spend", {
      headers: { authorization: "Bearer cron-secret" },
    }));

    expect(response.status).toBe(503);
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("reports an incomplete sweep when campaigns cannot be read", async () => {
    mocks.failedTable = "campaigns";
    const { GET } = await import("@/app/api/cron/enforce-spend/route");
    const response = await GET(new Request("http://localhost/api/cron/enforce-spend", { headers: { authorization: "Bearer cron-secret" } }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, swept: [] });
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("does not silently accept a failed limits page", async () => {
    mocks.failedTable = "spend_limits";
    const { GET } = await import("@/app/api/cron/enforce-spend/route");
    const response = await GET(new Request("http://localhost/api/cron/enforce-spend", { headers: { authorization: "Bearer cron-secret" } }));
    expect(response.status).toBe(502);
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("pauses but reports incomplete when the live weekly observation fails", async () => {
    mocks.getCampaignInsights.mockRejectedValue(new Error("Meta unavailable"));
    const { GET } = await import("@/app/api/cron/enforce-spend/route");
    const response = await GET(new Request("http://localhost/api/cron/enforce-spend", { headers: { authorization: "Bearer cron-secret" } }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, swept: [{ businessId: "business-1", paused: ["campaign-1"] }] });
    expect(mocks.updateCampaignStatus).toHaveBeenCalledWith("meta-campaign-1", "PAUSED");
  });

  it("preserves a held customer's reservation without trusting spend insights", async () => {
    mocks.getCustomerBalance.mockResolvedValue({ held: true, reservations: [{ campaignId: "campaign-1", reservationId: "reservation-1", state: "active" }] });
    const { GET } = await import("@/app/api/cron/enforce-spend/route");
    const response = await GET(new Request("http://localhost/api/cron/enforce-spend", { headers: { authorization: "Bearer cron-secret" } }));
    expect(response.status).toBe(200);
    expect(mocks.getCampaignInsights).not.toHaveBeenCalled();
    expect(mocks.confirmCustomerCampaign).toHaveBeenCalledWith(
      { businessId: "business-1", userId: "system" }, "campaign-1", "reservation-1", "paused",
    );
  });

  it("reports an unknown customer balance as incomplete after attempting the pause", async () => {
    mocks.getCustomerBalance.mockRejectedValue(new Error("Balance unavailable"));
    const { GET } = await import("@/app/api/cron/enforce-spend/route");
    const response = await GET(new Request("http://localhost/api/cron/enforce-spend", { headers: { authorization: "Bearer cron-secret" } }));
    expect(response.status).toBe(503);
    expect(mocks.updateCampaignStatus).toHaveBeenCalledWith("meta-campaign-1", "PAUSED");
    expect(mocks.getCampaignInsights).not.toHaveBeenCalled();
  });

  it("includes campaigns beyond the first database page in the spend decision", async () => {
    configureAdmin([
      ...Array.from({ length: 100 }, (_, index) => ({
        ...boundCampaign, id: `campaign-${String(index).padStart(3, "0")}`,
        status: "paused", meta_campaign_id: `meta-${index}`,
      })),
      { ...boundCampaign, id: "campaign-999", meta_campaign_id: "meta-last" },
    ]);
    const { GET } = await import("@/app/api/cron/enforce-spend/route");
    const response = await GET(new Request("http://localhost/api/cron/enforce-spend", { headers: { authorization: "Bearer cron-secret" } }));
    expect(response.status).toBe(200);
    expect(mocks.getCampaignInsights).toHaveBeenCalledTimes(101);
    expect(mocks.updateCampaignStatus).toHaveBeenCalledWith("meta-last", "PAUSED");
  });

  it("does not claim a confirmed local pause when persistence fails", async () => {
    mocks.updateError = { message: "private database failure" };
    const { GET } = await import("@/app/api/cron/enforce-spend/route");
    const response = await GET(new Request("http://localhost/api/cron/enforce-spend", { headers: { authorization: "Bearer cron-secret" } }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, swept: [] });
    expect(mocks.updateCampaignStatus).toHaveBeenCalledOnce();
  });
});