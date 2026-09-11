import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwnedBusiness: vi.fn(), getConnectionStatus: vi.fn(), withMetaConnection: vi.fn(),
  listCampaignsPage: vi.fn(), readBoundCampaign: vi.fn(), insert: vi.fn(), update: vi.fn(),
  existing: null as Record<string, unknown> | null,
}));
const connection = { generation: 4, authorization: "connected", selected: { adAccountId: "act_123", pageId: "page_1", currency: "INR" } };

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
vi.mock("@/lib/supabase/queries", () => ({ getPrimaryBusiness: async () => ({ id: "business" }) }));
vi.mock("@/lib/meta/connection-access", () => ({
  requireOwnedBusiness: mocks.requireOwnedBusiness, getConnectionStatus: mocks.getConnectionStatus, withMetaConnection: mocks.withMetaConnection,
  ConnectionAccessError: class extends Error { constructor(public code: string, message: string) { super(message); } },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.existing = null;
  mocks.requireOwnedBusiness.mockResolvedValue({ businessId: "business", userId: "owner" });
  mocks.getConnectionStatus.mockResolvedValue(connection);
  mocks.withMetaConnection.mockImplementation(async (_context, _purpose, execute) => execute({ listCampaignsPage: mocks.listCampaignsPage, readBoundCampaign: mocks.readBoundCampaign }, connection));
  mocks.listCampaignsPage.mockResolvedValue({ campaigns: [{ id: "campaign", name: "Local leads", status: "PAUSED", objective: "OUTCOME_LEADS" }], nextCursor: null });
  mocks.readBoundCampaign.mockResolvedValue({ dailyBudgetRupees: 500, adSetId: "set" });
  mocks.insert.mockResolvedValue({ error: null });
});

describe("verified campaign sync", () => {
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