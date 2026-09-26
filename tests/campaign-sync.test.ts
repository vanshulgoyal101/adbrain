import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwnedBusiness: vi.fn(), getConnectionStatus: vi.fn(), withMetaConnection: vi.fn(),
  listCampaignsPage: vi.fn(), readBoundCampaign: vi.fn(), insert: vi.fn(), update: vi.fn(),
  existing: null as Record<string, unknown> | null,
  getCampaignPage: vi.fn(), getLatestResults: vi.fn(),
}));
const connection = { generation: 4, authorization: "connected", selected: { adAccountId: "act_123", pageId: "page_1", currency: "INR" } };

vi.mock("@/lib/campaign/trusted-write", () => ({
  saveCampaign: (actor: { businessId: string }, values: Record<string, unknown>, id?: string) =>
    id ? mocks.update(values) : mocks.insert({ ...values, business_id: actor.businessId }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from: () => {
    const query = {
      select: () => query, eq: () => query, maybeSingle: async () => ({ data: mocks.existing, error: null }),
      order: async () => ({ data: [], error: null }),
      insert: mocks.insert, update: (value: unknown) => { mocks.update(value); return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
    };
    return query;
  },
}) }));
vi.mock("@/lib/supabase/queries", () => ({ getPrimaryBusiness: async () => ({ id: "business" }), getCampaignPage: mocks.getCampaignPage, getLatestResults: mocks.getLatestResults }));
vi.mock("@/lib/meta/connection-access", () => ({
  requireOwnedBusiness: mocks.requireOwnedBusiness, getConnectionStatus: mocks.getConnectionStatus, withMetaConnection: mocks.withMetaConnection,
  ConnectionAccessError: class extends Error { constructor(public code: string, message: string) { super(message); } },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.existing = null;
  mocks.getCampaignPage.mockResolvedValue({ campaigns: [], nextCursor: null });
  mocks.getLatestResults.mockResolvedValue({});
  mocks.requireOwnedBusiness.mockResolvedValue({ businessId: "business", userId: "owner" });
  mocks.getConnectionStatus.mockResolvedValue(connection);
  mocks.withMetaConnection.mockImplementation(async (_context, _purpose, execute) => execute({ listCampaignsPage: mocks.listCampaignsPage, readBoundCampaign: mocks.readBoundCampaign }, connection));
  mocks.listCampaignsPage.mockResolvedValue({ campaigns: [{ id: "campaign", name: "Local leads", status: "PAUSED", objective: "OUTCOME_LEADS" }], nextCursor: null });
  mocks.readBoundCampaign.mockResolvedValue({ dailyBudgetRupees: 500, adSetId: "set" });
  mocks.insert.mockResolvedValue({ error: null });
});

describe("verified campaign sync", () => {
  it("returns an owner-scoped display page and latest snapshots", async () => {
    mocks.getCampaignPage.mockResolvedValue({ campaigns: [{ id: "campaign" }], nextCursor: "display-next" });
    const { GET } = await import("@/app/api/campaigns/list/route");
    const response = await GET(new Request("http://localhost/api/campaigns/list?businessId=11111111-1111-4111-8111-111111111111&status=paused&query=solar"));
    expect(response.status).toBe(200);
    expect(mocks.getCampaignPage).toHaveBeenCalledWith("business", expect.objectContaining({ status: "paused", query: "solar" }));
    expect(mocks.getLatestResults).toHaveBeenCalledWith(["campaign"]);
    expect(await response.json()).toMatchObject({ nextCursor: "display-next", results: {} });
  });

  it("rejects unsupported list filters before loading campaigns", async () => {
    const { GET } = await import("@/app/api/campaigns/list/route");
    expect((await GET(new Request("http://localhost/api/campaigns/list?businessId=11111111-1111-4111-8111-111111111111&status=deleted"))).status).toBe(400);
    expect(mocks.getCampaignPage).not.toHaveBeenCalled();
  });

  it("does not query list data when business authorization fails", async () => {
    const { ConnectionAccessError } = await import("@/lib/meta/connection-access");
    mocks.requireOwnedBusiness.mockRejectedValue(new ConnectionAccessError("FORBIDDEN", "Private detail"));
    const { GET } = await import("@/app/api/campaigns/list/route");
    const response = await GET(new Request("http://localhost/api/campaigns/list?businessId=11111111-1111-4111-8111-111111111111"));
    expect(response.status).toBe(403);
    expect(mocks.getCampaignPage).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("Private detail");
  });

  it("saves only verified account/Page bindings and actual budgets", async () => {
    const { POST } = await import("@/app/api/campaigns/sync/route");
    expect((await POST()).status).toBe(200);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ business_id: "business", daily_budget: 500, meta_ad_account_id: "act_123", meta_page_id: "page_1", meta_connection_generation: 4, status: "paused" }));
  });

  it("reports unmatched campaigns without saving them", async () => {
    mocks.readBoundCampaign.mockResolvedValue(null);
    mocks.listCampaignsPage.mockResolvedValue({ campaigns: [{ id: "campaign" }], nextCursor: "next-page" });
    const { POST } = await import("@/app/api/campaigns/sync/route");
    expect(await (await POST()).json()).toMatchObject({ skipped: 1, nextCursor: "next-page" });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it.each(["DELETED", "ARCHIVED", "UNKNOWN"])("does not import %s campaigns as paused", async (status) => {
    mocks.listCampaignsPage.mockResolvedValue({ campaigns: [{ id: "campaign", status }], nextCursor: null });
    const { POST } = await import("@/app/api/campaigns/sync/route");
    expect(await (await POST()).json()).toMatchObject({ skipped: 1 });
    expect(mocks.readBoundCampaign).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("preserves a known Page binding even when the stored account ID is missing", async () => {
    mocks.existing = { id: "stored", meta_ad_account_id: null, meta_page_id: "other" };
    const { POST } = await import("@/app/api/campaigns/sync/route");
    expect(await (await POST()).json()).toMatchObject({ skipped: 1 });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not report a duplicate insertion conflict as a successful sync", async () => {
    mocks.insert.mockResolvedValue({ error: { code: "23505" } });
    const { POST } = await import("@/app/api/campaigns/sync/route");
    expect((await POST()).status).toBe(502);
  });

  it("preserves an existing campaign belonging to a different bound Page", async () => {
    mocks.existing = { id: "stored", meta_ad_account_id: "act_other", meta_page_id: "other" };
    const { POST } = await import("@/app/api/campaigns/sync/route");
    expect(await (await POST()).json()).toMatchObject({ skipped: 1 });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("blocks writes when the connection changes during discovery", async () => {
    mocks.getConnectionStatus.mockResolvedValue({ ...connection, generation: 5 });
    const { POST } = await import("@/app/api/campaigns/sync/route");
    expect((await POST()).status).toBe(409);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});