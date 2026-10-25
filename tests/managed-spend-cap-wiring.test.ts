import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpendCapState, SpendCapStore } from "@/lib/managed/spend-cap-store";

// #522 wiring around syncChildSpendCap: real dependencies (the parent token on the child ad account,
// the customer balance), AdBrain's side of "stop", the activation gate and the payment trigger.
const mocks = vi.hoisted(() => ({
  getManagedAccount: vi.fn(), getCustomerBalance: vi.fn(), confirmCustomerCampaign: vi.fn(), after: vi.fn(),
  adminFrom: vi.fn(), adminRpc: vi.fn(), clients: [] as Array<Record<string, unknown>>, campaignUpdates: [] as unknown[],
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.adminFrom, rpc: mocks.adminRpc }) }));
vi.mock("@/lib/payments/customer-balance", () => ({ getCustomerBalance: mocks.getCustomerBalance, confirmCustomerCampaign: mocks.confirmCustomerCampaign }));
vi.mock("@/lib/meta/managed-account", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/meta/managed-account")>(), getManagedAccount: mocks.getManagedAccount,
}));
vi.mock("@/lib/meta/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...actual, MetaClient: vi.fn(function (this: Record<string, unknown>, creds: unknown) {
    Object.assign(this, {
      creds,
      readAccountFunding: vi.fn(async () => ({ spendCapPaise: 33_898, amountSpentPaise: 0, roomPaise: 33_898 })),
      setAccountSpendCap: vi.fn(async () => ({})),
      listCampaignsPage: vi.fn(async () => ({ campaigns: [{ id: "120330000000000001", status: "ACTIVE" }], nextCursor: null })),
      updateCampaignStatus: vi.fn(async () => {}),
    });
    mocks.clients.push(this);
  }) };
});

const actor = { businessId: "7d2a5b1f-6b54-4d66-8c2a-4a8b4a1d3b21", userId: "6c1f4f0e-5a43-4c55-9b1f-3f7a3f0c2a10" };
const ready = { business_id: actor.businessId, state: "ready", child_business_id: "2000000000000001", ad_account_id: "act_3000000000000001",
  page_id: "4000000000000001", funding_state: "card_attached", generation: 1 };
const balance = { advertisingAllocationPaise: 40_000, advertisingRefundedPaise: 0, held: false, reservations: [] };

function memoryStore(state: SpendCapState = { dirty: true, action: null, capPaise: null, roomPaise: null }) {
  const store: SpendCapStore & { current: SpendCapState } = {
    current: state,
    request: vi.fn(async () => { store.current = { ...store.current, dirty: true }; return true; }),
    begin: vi.fn(async () => { store.current = { dirty: false, action: null, capPaise: null, roomPaise: null }; return true; }),
    finish: vi.fn(async (_account, _token, decision) => { store.current = { dirty: false, ...decision }; return false; }),
    abandon: vi.fn(async () => { store.current = { dirty: true, action: null, capPaise: null, roomPaise: null }; }),
    inputs: vi.fn(async () => ({ mediaThisAccountPaise: 0, mediaOtherAccountsPaise: 0, taxRateBps: 1800 })),
    state: vi.fn(async () => store.current),
  };
  return store;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.clients.length = 0;
  mocks.campaignUpdates.length = 0;
  vi.stubEnv("MANAGED_ACCOUNTS_ENABLED", "true");
  vi.stubEnv("META_PARENT_SYSTEM_TOKEN", "parent-system-token");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://core-test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  mocks.getManagedAccount.mockResolvedValue(ready);
  mocks.getCustomerBalance.mockResolvedValue(balance);
  mocks.adminRpc.mockResolvedValue({ data: null, error: null });
  mocks.adminFrom.mockImplementation((table: string) => {
    if (table !== "campaigns") throw new Error(`unexpected table ${table}`);
    const filters: unknown[] = [];
    const query = {
      select: () => query,
      eq: (...filter: unknown[]) => { filters.push(filter); return query; },
      update: (values: unknown) => { mocks.campaignUpdates.push(values); return query; },
      then: (resolve: (value: unknown) => void) => resolve(filters.length === 3
        ? { data: [{ id: "campaign-1", meta_campaign_id: "120330000000000001" }], error: null } : { data: null, error: null }),
    };
    return query;
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("pauseActiveCampaigns (#522 stop)", () => {
  it("pauses every ACTIVE campaign across pages and leaves paused ones alone", async () => {
    const { pauseActiveCampaigns } = await import("@/lib/managed/spend-cap-wiring");
    const meta = {
      listCampaignsPage: vi.fn(async (after?: string) => after
        ? { campaigns: [{ id: "c3", status: "ACTIVE" }], nextCursor: null }
        : { campaigns: [{ id: "c1", status: "ACTIVE" }, { id: "c2", status: "PAUSED" }], nextCursor: "page-2" }),
      updateCampaignStatus: vi.fn(async () => {}),
    };
    expect(await pauseActiveCampaigns(meta as never)).toEqual(["c1", "c3"]);
    expect(meta.updateCampaignStatus.mock.calls).toEqual([["c1", "PAUSED"], ["c3", "PAUSED"]]);
  });

  it("tries every campaign before failing closed when one can't be paused", async () => {
    const { pauseActiveCampaigns } = await import("@/lib/managed/spend-cap-wiring");
    const meta = {
      listCampaignsPage: vi.fn(async () => ({ campaigns: [{ id: "c1", status: "ACTIVE" }, { id: "c2", status: "ACTIVE" }], nextCursor: null })),
      updateCampaignStatus: vi.fn(async (id: string) => { if (id === "c1") throw new Error("Meta refused"); }),
    };
    await expect(pauseActiveCampaigns(meta as never)).rejects.toThrow("Meta refused");
    expect(meta.updateCampaignStatus).toHaveBeenCalledTimes(2);
  });
});

describe("syncManagedSpendCap (#522)", () => {
  it("does nothing with the flag off, without reading the ledger", async () => {
    vi.stubEnv("MANAGED_ACCOUNTS_ENABLED", "false");
    const { syncManagedSpendCap } = await import("@/lib/managed/spend-cap-wiring");
    expect(await syncManagedSpendCap(actor, memoryStore())).toEqual({ status: "disabled" });
    expect(mocks.getManagedAccount).not.toHaveBeenCalled();
  });

  it("skips a business without a managed child ad account", async () => {
    mocks.getManagedAccount.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...ready, state: "page_linked", ad_account_id: null });
    const { syncManagedSpendCap } = await import("@/lib/managed/spend-cap-wiring");
    expect(await syncManagedSpendCap(actor, memoryStore())).toEqual({ status: "unmanaged" });
    expect(await syncManagedSpendCap(actor, memoryStore())).toEqual({ status: "unmanaged" });
    expect(mocks.clients).toHaveLength(0);
  });

  it("writes the child account's limit with the parent token, from the customer's own balance", async () => {
    const store = memoryStore();
    const { syncManagedSpendCap } = await import("@/lib/managed/spend-cap-wiring");
    // Meta already holds 33,898 for a ₹500 customer: kept, nothing written.
    expect(await syncManagedSpendCap(actor, store)).toMatchObject({ status: "applied", decision: { action: "keep", capPaise: 33_898 } });
    expect(mocks.clients[0].creds).toEqual({ adAccountId: "act_3000000000000001", pageId: "4000000000000001", accessToken: "parent-system-token" });
    expect(mocks.getCustomerBalance).toHaveBeenCalledWith(actor);
    expect(store.request).toHaveBeenCalledWith(actor.businessId, "act_3000000000000001", expect.any(String));
  });

  it("stops a refunded account: pauses on Meta, then marks its AdBrain campaigns paused with an audit and the reserve paused", async () => {
    mocks.getCustomerBalance.mockResolvedValue({ ...balance, advertisingRefundedPaise: 40_000,
      reservations: [{ campaignId: "campaign-1", reservationId: "a3c0d9a2-1f2b-4c3d-9e4f-5a6b7c8d9e0f", state: "active" }] });
    const store = memoryStore();
    const { syncManagedSpendCap } = await import("@/lib/managed/spend-cap-wiring");
    expect(await syncManagedSpendCap(actor, store)).toMatchObject({ decision: { action: "stop", reason: "no_allowance" } });
    const client = mocks.clients[0] as { updateCampaignStatus: ReturnType<typeof vi.fn>; setAccountSpendCap: ReturnType<typeof vi.fn> };
    expect(client.updateCampaignStatus).toHaveBeenCalledWith("120330000000000001", "PAUSED");
    expect(client.setAccountSpendCap).toHaveBeenCalledWith(100, 100);
    expect(mocks.campaignUpdates).toEqual([{ status: "paused" }]);
    expect(mocks.confirmCustomerCampaign).toHaveBeenCalledWith(actor, "campaign-1", "a3c0d9a2-1f2b-4c3d-9e4f-5a6b7c8d9e0f", "paused");
    expect(mocks.adminRpc).toHaveBeenCalledWith("append_verified_audit_event", expect.objectContaining({
      p_system_actor: "worker", p_action: "spend.auto_paused", p_entity_id: "campaign-1", p_meta_object_id: "120330000000000001" }));
    expect(store.current).toEqual({ dirty: false, action: "stop", capPaise: 100, roomPaise: 0 });
  });

  it("refuses to cap from a balance that doesn't say how much ad share was refunded", async () => {
    mocks.getCustomerBalance.mockResolvedValue({ advertisingAllocationPaise: 40_000, held: false, reservations: [] });
    const store = memoryStore();
    const { syncManagedSpendCap } = await import("@/lib/managed/spend-cap-wiring");
    await expect(syncManagedSpendCap(actor, store)).rejects.toThrow(/cannot be verified/);
    expect(store.abandon).toHaveBeenCalled();
  });
});

describe("managedSpendCapGate (#522, QA #527 T4)", () => {
  const account = ready as never;
  it("allows activation on a current limit with room, without another Meta call", async () => {
    const { managedSpendCapGate } = await import("@/lib/managed/spend-cap-wiring");
    expect(await managedSpendCapGate(actor, account, memoryStore({ dirty: false, action: "set", capPaise: 33_898, roomPaise: 33_898 }))).toBe("allowed");
    expect(mocks.clients).toHaveLength(0);
  });

  it.each([
    [{ dirty: false, action: "stop", capPaise: 100, roomPaise: 0 }],
    [{ dirty: false, action: "freeze", capPaise: 20_000, roomPaise: 0 }],
  ] as const)("blocks activation when the last decision left no room: %j", async (state) => {
    const { managedSpendCapGate } = await import("@/lib/managed/spend-cap-wiring");
    expect(await managedSpendCapGate(actor, account, memoryStore(state))).toBe("no_room");
  });

  it("refreshes a stale limit first, then decides on the fresh one", async () => {
    const store = memoryStore({ dirty: true, action: "set", capPaise: 33_898, roomPaise: 33_898 });
    mocks.getCustomerBalance.mockResolvedValue({ ...balance, held: true });
    const { managedSpendCapGate } = await import("@/lib/managed/spend-cap-wiring");
    expect(await managedSpendCapGate(actor, account, store)).toBe("no_room");
    expect(store.request).toHaveBeenCalledOnce();
  });

  it("blocks while another writer's pass is in flight, or died before recording its decision (review)", async () => {
    // Postgres clears the last decision when a pass begins (scripts/check-meta-connect-db.mjs).
    const store = memoryStore({ dirty: false, action: null, capPaise: null, roomPaise: null });
    store.request = vi.fn(async () => false);
    const { managedSpendCapGate } = await import("@/lib/managed/spend-cap-wiring");
    expect(await managedSpendCapGate(actor, account, store)).toBe("updating");
  });

  it("blocks while another writer is still applying a payment or refund", async () => {
    const store = memoryStore({ dirty: true, action: "set", capPaise: 33_898, roomPaise: 33_898 });
    store.request = vi.fn(async () => false);
    const { managedSpendCapGate } = await import("@/lib/managed/spend-cap-wiring");
    expect(await managedSpendCapGate(actor, account, store)).toBe("updating");
  });
});

describe("scheduleManagedSpendCapSync (#522 payment trigger)", () => {
  it("refreshes the limit after the response with the flag on, and never with it off", async () => {
    const { scheduleManagedSpendCapSync } = await import("@/lib/managed/spend-cap-wiring");
    vi.stubEnv("MANAGED_ACCOUNTS_ENABLED", "false");
    scheduleManagedSpendCapSync(actor);
    expect(mocks.after).not.toHaveBeenCalled();
    vi.stubEnv("MANAGED_ACCOUNTS_ENABLED", "true");
    scheduleManagedSpendCapSync(actor);
    expect(mocks.after).toHaveBeenCalledOnce();
  });

  it("logs a failed refresh instead of failing the payment request", async () => {
    mocks.getManagedAccount.mockRejectedValue(new Error("ledger down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { scheduleManagedSpendCapSync } = await import("@/lib/managed/spend-cap-wiring");
    scheduleManagedSpendCapSync(actor);
    await mocks.after.mock.calls[0][0]();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("SPEND_CAP_SYNC_FAILED"));
    warn.mockRestore();
  });
});
