import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHILD_TOKEN_KEY, childTokenRpc } from "./helpers/managed-child-token";

// #525: a managed business (2-Tier child) runs on its child's own system-user token (#624) with its
// own child ad account and Page; everyone else stays on their OAuth connection. Behind the flag.
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), adminFrom: vi.fn(), adminRpc: vi.fn(), managedFilters: [] as [string, unknown][], spendCapGate: vi.fn() }));
vi.mock("@/lib/managed/spend-cap-wiring", () => ({ managedSpendCapGate: mocks.spendCapGate }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "business-1", owner_id: "user-1" }, error: null }) }) }) }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.adminFrom, rpc: mocks.adminRpc }) }));

// Columns and values of #533's managed_meta_accounts (#519); `generation` is optional there.
const ready = {
  business_id: "business-1", state: "ready", child_business_id: "2000000000000001", ad_account_id: "act_3000000000000001",
  page_id: "4000000000000001", funding_state: "card_attached", generation: 3, waba_id: null, phone_number_id: null,
  step_keys: {}, last_error: null, created_at: "2026-10-25T00:00:00Z", updated_at: "2026-10-25T00:00:00Z",
  manager_user_id: "6100000000000001", manager_token_id: "00000000-0000-4000-8000-000000000621",
};
const CHILD = "child-system-token";
let managedRows: Record<string, unknown>[] = [];
let oauthRow: Record<string, unknown> | null = null;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.managedFilters = [];
  managedRows = [ready, { ...ready, business_id: "business-2", ad_account_id: "act_9", page_id: "9", manager_token_id: "00000000-0000-4000-8000-000000000622" }];
  oauthRow = null;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://core-test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("META_CONNECT_ROLLOUT", "enabled");
  vi.stubEnv("MANAGED_ACCOUNTS_ENABLED", "true");
  vi.stubEnv("META_PARENT_SYSTEM_TOKEN", "parent-system-token");
  vi.stubEnv("META_TOKEN_ENCRYPTION_KEY", CHILD_TOKEN_KEY);
  mocks.adminRpc.mockImplementation(childTokenRpc({
    [ready.manager_token_id]: { businessId: "business-1", token: CHILD },
    "00000000-0000-4000-8000-000000000622": { businessId: "business-2", token: "other-child-token" },
  }));
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.spendCapGate.mockResolvedValue("allowed");
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
  it("uses the child ad account and Page with the child's own token, and never reads an OAuth token", async () => {
    const { creds, connection } = await run({ purpose: "create_paused" });
    expect(creds).toEqual({ adAccountId: "act_3000000000000001", pageId: "4000000000000001", accessToken: CHILD });
    expect(connection).toMatchObject({ businessId: "business-1", generation: 3, authorization: "connected",
      selected: { metaBusinessId: "2000000000000001", adAccountId: "act_3000000000000001", pageId: "4000000000000001", currency: "INR" } });
    expect(mocks.managedFilters).toContainEqual(["business_id", "business-1"]);
    expect(tables()).not.toContain("meta_connections");
    expect(mocks.adminRpc.mock.calls).toEqual([["meta_token_get", { p_token_id: ready.manager_token_id, p_business_id: "business-1" }]]);
  });

  it("never falls back to an OAuth connection while the managed account is being set up", async () => {
    managedRows = [{ ...ready, state: "child_created", ad_account_id: null, funding_state: "none" }];
    oauthRow = { business_id: "business-1", authorization_status: "connected" };
    await expect(run({ purpose: "create_paused" })).rejects.toThrow(/being set up/);
    expect(tables()).not.toContain("meta_connections");
  });

  it("creates and activates only on a ready, funded child account", async () => {
    managedRows = [{ ...ready, state: "funded" }];
    await expect(run({ purpose: "create_paused" })).rejects.toThrow(/being set up/);
    managedRows = [{ ...ready, funding_state: "failed" }];
    await expect(run({ purpose: "create_paused" })).resolves.toBeTruthy();
    await expect(run({ purpose: "activate" })).rejects.toThrow(/funded/);
    managedRows = [{ ...ready, funding_state: "invoiced" }];
    await expect(run({ purpose: "activate" })).resolves.toBeTruthy();
  });

  it.each([["no_room", /no spending room left/], ["updating", /being updated/]] as const)(
    "activates only when the child account's spending limit has room: %s blocks it, not create or pause (#522)", async (gate, message) => {
      mocks.spendCapGate.mockResolvedValue(gate);
      const binding = { adAccountId: ready.ad_account_id, pageId: ready.page_id };
      await expect(run({ purpose: "activate" })).rejects.toThrow(message);
      await expect(run({ purpose: "create_paused" })).resolves.toBeTruthy();
      await expect(run({ purpose: "pause", expectedGeneration: 3, binding })).resolves.toBeTruthy();
      expect(mocks.spendCapGate).toHaveBeenCalledOnce();
      expect(mocks.spendCapGate).toHaveBeenCalledWith(expect.objectContaining({ businessId: "business-1", userId: "user-1" }),
        expect.objectContaining({ business_id: "business-1", ad_account_id: ready.ad_account_id }));
    });

  it("keeps activation closed when the spending limit can't be verified (#522)", async () => {
    mocks.spendCapGate.mockRejectedValue(new Error("Meta is unavailable."));
    await expect(run({ purpose: "activate" })).rejects.toThrow(/being updated/);
  });

  it.each(["failed", "offboarding", "whatsapp_linked", "funded"])("can still stop and read a %s account that has an ad account, but not create on it (QA)", async (state) => {
    managedRows = [{ ...ready, state }];
    const binding = { adAccountId: ready.ad_account_id, pageId: ready.page_id };
    await expect(run({ purpose: "pause", expectedGeneration: 3, binding })).resolves.toMatchObject({
      creds: { adAccountId: ready.ad_account_id, accessToken: CHILD } });
    await expect(run({ purpose: "read_insights" })).resolves.toBeTruthy();
    await expect(run({ purpose: "create_paused" })).rejects.toThrow(/being set up|not available/);
  });

  it("works with #533's ledger, which has no generation column, using generation 1", async () => {
    const { generation: _generation, ...withoutGeneration } = ready;
    void _generation;
    managedRows = [withoutGeneration];
    const { connection } = await run({ purpose: "create_paused" });
    expect(connection.generation).toBe(1);
  });

  it("shows a ledger read failure as not ready instead of breaking the page, and keeps Meta calls closed", async () => {
    mocks.adminFrom.mockImplementation((table: string) => {
      if (table !== "managed_meta_accounts") throw new Error(`unexpected table ${table}`);
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: { message: "relation does not exist" } }) };
      return query;
    });
    const { getMetaConnection } = await import("@/lib/meta/credentials");
    await expect(getMetaConnection("business-1")).resolves.toMatchObject({ ready: false });
    await expect(run({ purpose: "read_insights" })).rejects.toThrow(/unavailable/i);
  });

  it("keeps the review and campaign binding checks: a changed generation or account is a conflict", async () => {
    await expect(run({ purpose: "activate", expectedGeneration: 2 })).rejects.toThrow(/changed/);
    await expect(run({ purpose: "pause", expectedGeneration: 3, binding: { adAccountId: "act_9", pageId: "9" } })).rejects.toThrow(/no longer match/);
    await expect(run({ purpose: "pause", expectedGeneration: 3, binding: { adAccountId: ready.ad_account_id, pageId: ready.page_id } })).resolves.toBeTruthy();
  });

  it("is unavailable without its own child token, never using the parent's or another business's (#624)", async () => {
    managedRows = [{ ...ready, manager_token_id: null }];
    await expect(run({ purpose: "read_insights" })).rejects.toThrow(/unavailable/i);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
    managedRows = [{ ...ready, manager_token_id: "00000000-0000-4000-8000-000000000622" }];
    await expect(run({ purpose: "pause", expectedGeneration: 3, binding: { adAccountId: ready.ad_account_id, pageId: ready.page_id } })).rejects.toThrow(/unavailable/i);
    vi.stubEnv("META_PARENT_SYSTEM_TOKEN", "");
    managedRows = [ready];
    await expect(run({ purpose: "read_insights" })).resolves.toMatchObject({ creds: { accessToken: CHILD } });
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
    await expect(resolveMetaCredentials("business-1")).resolves.toEqual({ adAccountId: ready.ad_account_id, pageId: ready.page_id, accessToken: CHILD });
    managedRows = [{ ...ready, state: "page_linked", child_business_id: null, ad_account_id: null }];
    await expect(resolveMetaCredentials("business-1")).resolves.toBeNull();
    expect(mocks.adminRpc).toHaveBeenCalledTimes(1);
  });
});
