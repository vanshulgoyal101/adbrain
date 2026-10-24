import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #525: a managed business (2-Tier child) runs on the parent system user's token with its own
// child ad account and Page; everyone else stays on their OAuth connection. Behind the flag.
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), adminFrom: vi.fn(), adminRpc: vi.fn(), managedFilters: [] as [string, unknown][] }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "business-1", owner_id: "user-1" }, error: null }) }) }) }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.adminFrom, rpc: mocks.adminRpc }) }));

const ready = {
  business_id: "business-1", state: "ready", child_business_id: "2000000000000001", ad_account_id: "act_3000000000000001",
  page_id: "4000000000000001", funding_state: "funded", generation: 3,
};
let managedRows: Record<string, unknown>[] = [];
let oauthRow: Record<string, unknown> | null = null;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.managedFilters = [];
  managedRows = [ready, { ...ready, business_id: "business-2", ad_account_id: "act_9", page_id: "9" }];
  oauthRow = null;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://core-test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("META_CONNECT_ROLLOUT", "enabled");
  vi.stubEnv("MANAGED_ACCOUNTS_ENABLED", "true");
  vi.stubEnv("META_PARENT_SYSTEM_TOKEN", "parent-system-token");
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.adminFrom.mockImplementation((table: string) => {
    if (table === "managed_meta_accounts") {
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { mocks.managedFilters.push([column, value]); return query; },
        maybeSingle: async () => ({ data: managedRows.find((row) => mocks.managedFilters.every(([column, value]) => row[column] === value)) ?? null, error: null }),
      };
      return query;
    }
    if (table === "meta_connections") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: oauthRow, error: null }) }) }) };
    throw new Error(`unexpected table ${table}`);
  });
});
afterEach(() => vi.unstubAllEnvs());

async function run(options: Parameters<typeof import("@/lib/meta/connection-access").withMetaConnection>[1]) {
  const { requireOwnedBusiness, withMetaConnection } = await import("@/lib/meta/connection-access");
  const context = await requireOwnedBusiness("business-1");
  return withMetaConnection(context, options, async (client, connection) => ({ creds: (client as unknown as { creds: unknown }).creds, connection }));
}
const tables = () => mocks.adminFrom.mock.calls.map(([table]) => table);

describe("Meta credentials for a managed business (#525)", () => {
  it("uses the child ad account and Page with the parent token, and never reads an OAuth token", async () => {
    const { creds, connection } = await run({ purpose: "create_paused" });
    expect(creds).toEqual({ adAccountId: "act_3000000000000001", pageId: "4000000000000001", accessToken: "parent-system-token" });
    expect(connection).toMatchObject({ businessId: "business-1", generation: 3, authorization: "connected",
      selected: { metaBusinessId: "2000000000000001", adAccountId: "act_3000000000000001", pageId: "4000000000000001", currency: "INR" } });
    expect(mocks.managedFilters).toContainEqual(["business_id", "business-1"]);
    expect(tables()).not.toContain("meta_connections");
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("never falls back to an OAuth connection while the managed account is being set up", async () => {
    managedRows = [{ ...ready, state: "ad_account_created", funding_state: "unfunded" }];
    oauthRow = { business_id: "business-1", authorization_status: "connected" };
    await expect(run({ purpose: "create_paused" })).rejects.toThrow(/being set up/);
    expect(tables()).not.toContain("meta_connections");
  });

  it("creates paused campaigns but activates only once the child account is funded", async () => {
    managedRows = [{ ...ready, funding_state: "unfunded" }];
    await expect(run({ purpose: "create_paused" })).resolves.toBeTruthy();
    await expect(run({ purpose: "activate" })).rejects.toThrow(/funded/);
  });

  it("keeps the review and campaign binding checks: a changed generation or account is a conflict", async () => {
    await expect(run({ purpose: "activate", expectedGeneration: 2 })).rejects.toThrow(/changed/);
    await expect(run({ purpose: "pause", expectedGeneration: 3, binding: { adAccountId: "act_9", pageId: "9" } })).rejects.toThrow(/no longer match/);
    await expect(run({ purpose: "pause", expectedGeneration: 3, binding: { adAccountId: ready.ad_account_id, pageId: ready.page_id } })).resolves.toBeTruthy();
  });

  it("is unavailable without the parent token instead of using any other credential", async () => {
    vi.stubEnv("META_PARENT_SYSTEM_TOKEN", "");
    await expect(run({ purpose: "read_insights" })).rejects.toThrow(/unavailable/i);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("leaves a business without a managed account on its OAuth connection", async () => {
    managedRows = [{ ...ready, business_id: "business-2" }];
    await expect(run({ purpose: "read_insights" })).rejects.toThrow(/not connected/);
    expect(tables()).toEqual(["managed_meta_accounts", "meta_connections"]);
  });

  it("does not read managed accounts at all while the flag is off", async () => {
    vi.stubEnv("MANAGED_ACCOUNTS_ENABLED", "false");
    await expect(run({ purpose: "create_paused" })).rejects.toThrow(/not connected/);
    expect(tables()).not.toContain("managed_meta_accounts");
  });

  it("resolves the same credentials for geo search and other direct callers", async () => {
    const { resolveMetaCredentials } = await import("@/lib/meta/credentials");
    await expect(resolveMetaCredentials("business-1")).resolves.toEqual({ adAccountId: ready.ad_account_id, pageId: ready.page_id, accessToken: "parent-system-token" });
    managedRows = [{ ...ready, state: "page_linked" }];
    await expect(resolveMetaCredentials("business-1")).resolves.toBeNull();
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
});
