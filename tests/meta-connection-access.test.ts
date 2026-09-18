import { afterEach, describe, expect, it, vi } from "vitest";

const getUser = vi.hoisted(() => vi.fn());
const adminFrom = vi.hoisted(() => vi.fn());
const adminRpc = vi.hoisted(() => vi.fn());
afterEach(() => vi.unstubAllEnvs());

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { id: "business-1", owner_id: "user-1" }, error: null }) }),
      }),
    }),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: adminFrom, rpc: adminRpc }),
}));

function connection(capability: "available" | "blocked" | "unknown") {
  return {
    businessId: "business-1",
    generation: 4,
    authorization: "connected" as const,
    selected: {
      metaBusinessId: "meta-business-1",
      adAccountId: "act_1",
      accountName: "Main",
      pageId: "page_1",
      pageName: "Main Page",
      currency: "INR",
      timezoneName: "Asia/Kolkata",
    },
    capabilities: {
      canReadInsights: { state: "available" as const, blockers: [] },
      canReadLeads: { state: "available" as const, blockers: [] },
      canCreatePaused: { state: capability, blockers: capability === "blocked" ? [{ code: "MISSING_PERMISSION" as const, message: "Paused creation is unavailable.", action: null }] : [] },
      canActivate: { state: "available" as const, blockers: [] },
    },
    checkedAt: null,
  };
}

describe("withMetaConnection capability boundary", () => {
  it("keeps business ownership available for drafts when Meta publishing is disabled", async () => {
    vi.stubEnv("META_CONNECT_ROLLOUT", "disabled");
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const { requireOwnedBusiness, withMetaConnection } = await import("@/lib/meta/connection-access");
    const context = await requireOwnedBusiness("business-1");
    expect(context.businessId).toBe("business-1");
    await expect(withMetaConnection(context, { purpose: "create_paused" }, async () => "unexpected"))
      .rejects.toThrow("Meta publishing is not enabled");
  });

  it("blocks unknown or unavailable operation capability before token access", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    adminFrom.mockImplementation((table: string) => {
      if (table === "meta_connections") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  business_id: "business-1",
                  generation: 4,
                  authorization_status: "connected",
                  meta_business_id: "meta-business-1",
                  ad_account_id: "act_1",
                  page_id: "page_1",
                  account_name: "Main",
                  page_name: "Main Page",
                  currency: "INR",
                  timezone_name: "Asia/Kolkata",
                  capabilities: connection("unknown").capabilities,
                  last_checked_at: null,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    });
    const { requireOwnedBusiness, withMetaConnection } = await import("@/lib/meta/connection-access");
    const context = await requireOwnedBusiness("business-1");
    await expect(withMetaConnection(context, { purpose: "create_paused" }, async () => "unexpected"))
      .rejects.toThrow("Meta has not confirmed access");
    expect(adminRpc).not.toHaveBeenCalled();
  });
});

describe("campaign worker authorization", () => {
  function arrange(overrides: Record<string, unknown> = {}, draftOverrides: Record<string, unknown> = {}) {
    const rows: Record<string, unknown> = {
      campaign_operations: { state: "running", lease_until: "2099-01-01T00:00:00Z", business_id: "business-1", draft_id: "draft-1", draft_version: 3, payload: { execution: "worker" }, ...overrides },
      businesses: { id: "business-1", owner_id: "user-1" },
      campaign_drafts: { business_id: "business-1", owner_id: "user-1", version: 3, ...draftOverrides },
    };
    adminFrom.mockImplementation((table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: rows[table], error: null }) }) }) }));
  }

  it("authorizes the current owner from an active worker claim", async () => {
    arrange();
    const { requireCampaignWorkerActor } = await import("@/lib/meta/connection-access");
    expect(await requireCampaignWorkerActor("operation-1")).toMatchObject({ businessId: "business-1", userId: "user-1" });
  });

  it.each([{ state: "pending" }, { state: "succeeded" }, { lease_until: "2000-01-01T00:00:00Z" }, { lease_until: "invalid" }, { payload: {} }])("rejects an unclaimed or non-worker operation: %j", async overrides => {
    arrange(overrides);
    const { requireCampaignWorkerActor } = await import("@/lib/meta/connection-access");
    await expect(requireCampaignWorkerActor("operation-1")).rejects.toThrow();
  });

  it.each([{ owner_id: "other-owner" }, { business_id: "other-business" }, { version: 4 }])("rejects changed draft ownership or version: %j", async overrides => {
    arrange({}, overrides);
    const { requireCampaignWorkerActor } = await import("@/lib/meta/connection-access");
    await expect(requireCampaignWorkerActor("operation-1")).rejects.toThrow("ownership or version changed");
  });
});