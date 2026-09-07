import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionClient: vi.fn(),
  adminFrom: vi.fn(),
  rpc: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ CRON_SECRET: "local-test-secret" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.sessionClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.adminFrom, rpc: mocks.rpc }) }));
vi.mock("@/lib/meta/token-store", () => ({ decryptMetaToken: mocks.decrypt, fromPostgresBytea: (value: string) => value }));

import { requireScheduledBusiness, withMetaConnection } from "@/lib/meta/connection-access";

function request(secret = "local-test-secret") {
  return new Request("http://localhost/api/cron/enforce-spend", { headers: { authorization: `Bearer ${secret}` } });
}

function connectionRow() {
  return {
    business_id: "business-1", generation: 4, authorization_status: "connected",
    token_id: "token-1", meta_business_id: null, ad_account_id: "act_1", page_id: "page_1",
    account_name: "Account", page_name: "Page", currency: "INR", timezone_name: "Asia/Kolkata",
    capabilities: {
      canReadInsights: { state: "available", blockers: [] },
      canReadLeads: { state: "available", blockers: [] },
      canCreatePaused: { state: "available", blockers: [] },
      canActivate: { state: "blocked", blockers: [] },
    },
    last_checked_at: null,
  };
}

function tokenRow() {
  return {
    id: "token-1", business_id: "business-1", ciphertext: "ciphertext", nonce: "nonce",
    auth_tag: "tag", key_id: "key", format_version: "v1", expires_at: null,
    data_access_expires_at: null, revoked_at: null, granted_scopes: ["ads_management"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.adminFrom.mockImplementation(table => ({ select: () => ({ eq: () => ({
    maybeSingle: async () => ({ data: table === "businesses" ? { id: "business-1", owner_id: "owner-1" } : connectionRow(), error: null }),
  }) }) }));
  mocks.rpc.mockResolvedValue({ data: [tokenRow()], error: null });
  mocks.decrypt.mockReturnValue("local-fixture-token");
});

describe("scheduled Meta safety boundary", () => {
  it("authorizes cron without calling a user-session client", async () => {
    const context = await requireScheduledBusiness("business-1", request());
    expect(context).toMatchObject({ businessId: "business-1", userId: "owner-1" });
    expect(mocks.sessionClient).not.toHaveBeenCalled();
  });

  it("rejects an invalid scheduler bearer before database access", async () => {
    await expect(requireScheduledBusiness("business-1", request("wrong"))).rejects.toThrow("Verified scheduler context required");
    expect(mocks.adminFrom).not.toHaveBeenCalled();
    expect(mocks.sessionClient).not.toHaveBeenCalled();
  });

  it("allows bound pausing with ads_management even when activation is blocked", async () => {
    const context = await requireScheduledBusiness("business-1", request());
    const execute = vi.fn().mockResolvedValue("paused");
    await expect(withMetaConnection(context, {
      purpose: "pause", binding: { adAccountId: "act_1", pageId: "page_1" }, expectedGeneration: 4,
    }, execute)).resolves.toBe("paused");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("still rejects activation when its capability is blocked", async () => {
    const context = await requireScheduledBusiness("business-1", request());
    await expect(withMetaConnection(context, { purpose: "activate" }, vi.fn())).rejects.toThrow("Meta has not confirmed access");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires management scope before decrypting a pause credential", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...tokenRow(), granted_scopes: [] }], error: null });
    const context = await requireScheduledBusiness("business-1", request());
    await expect(withMetaConnection(context, {
      purpose: "pause", binding: { adAccountId: "act_1", pageId: "page_1" }, expectedGeneration: 4,
    }, vi.fn())).rejects.toThrow("management permission");
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it("rejects expired data access before decrypting the token", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...tokenRow(), data_access_expires_at: "2000-01-01T00:00:00Z" }], error: null });
    const context = await requireScheduledBusiness("business-1", request());
    await expect(withMetaConnection(context, { purpose: "read_insights" }, vi.fn())).rejects.toThrow("credentials are unavailable");
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it("rejects a reconnect between status and token lookup", async () => {
    const context = await requireScheduledBusiness("business-1", request());
    let reads = 0;
    mocks.adminFrom.mockImplementation(() => ({ select: () => ({ eq: () => ({
      maybeSingle: async () => ({ data: { ...connectionRow(), generation: ++reads === 1 ? 4 : 5 }, error: null }),
    }) }) }));
    await expect(withMetaConnection(context, { purpose: "read_insights" }, vi.fn())).rejects.toThrow("connection changed");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
});