import { describe, expect, it, vi } from "vitest";

const getUser = vi.hoisted(() => vi.fn());
const adminFrom = vi.hoisted(() => vi.fn());
const adminRpc = vi.hoisted(() => vi.fn());

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