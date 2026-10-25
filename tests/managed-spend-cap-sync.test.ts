import { describe, expect, it, vi } from "vitest";
import { MetaError } from "@/lib/meta/client";
import { SpendCapLeaseLostError, SpendCapStoreError, type RecordedSpendCapDecision, type SpendCapStore } from "@/lib/managed/spend-cap-store";
import { STOP_SPEND_CAP_PAISE, syncChildSpendCap, type SpendCapBalance, type SpendCapMeta } from "@/lib/managed/spend-cap-sync";

// #522 wiring: the decision (#534) applied with one writer per child ad account. The in-memory store
// has the semantics `managed_spend_caps` has in Postgres (scripts/check-meta-connect-db.mjs).
const target = { businessId: "7d2a5b1f-6b54-4d66-8c2a-4a8b4a1d3b21", adAccountId: "act_73001" };

function memoryStore(inputs = { mediaThisAccountPaise: 0, mediaOtherAccountsPaise: 0, taxRateBps: 1800 }) {
  const row = { dirty: true, token: null as string | null, decision: null as RecordedSpendCapDecision | null };
  const store: SpendCapStore & { row: typeof row } = {
    row,
    async request(_businessId, _adAccountId, token) {
      row.dirty = true;
      if (row.token) return false;
      row.token = token;
      return true;
    },
    async begin(_adAccountId, token) {
      if (row.token !== token) return false;
      Object.assign(row, { dirty: false, decision: null });
      return true;
    },
    async finish(_adAccountId, token, decision) {
      if (row.token !== token) throw new SpendCapLeaseLostError();
      row.decision = decision;
      if (!row.dirty) row.token = null;
      return row.dirty;
    },
    async abandon(_adAccountId, token) {
      if (row.token !== token) return;
      Object.assign(row, { dirty: true, token: null, decision: null });
    },
    async inputs() { return inputs; },
    async state() { return { dirty: row.dirty, action: row.decision?.action ?? null, capPaise: row.decision?.capPaise ?? null, roomPaise: row.decision?.roomPaise ?? null }; },
  };
  return store;
}

/** Meta's ad account: amount_spent moves only by spend; spend_cap is what was last written. */
function metaAccount(account: { spendCapPaise: number; amountSpentPaise: number }, writeGate?: () => Promise<void>) {
  const writes: number[] = [];
  const paused: string[] = [];
  const meta: SpendCapMeta = {
    readAccountFunding: vi.fn(async () => ({ ...account, roomPaise: Math.max(0, account.spendCapPaise - account.amountSpentPaise) })),
    setAccountSpendCap: vi.fn(async (capPaise: number, maxRoomPaise: number) => {
      await writeGate?.();
      account.spendCapPaise = capPaise;
      writes.push(capPaise);
      const roomPaise = Math.max(0, capPaise - account.amountSpentPaise);
      if (roomPaise > maxRoomPaise) throw new MetaError("Meta allows more than the customer has left on this ad account.");
      return { ...account, roomPaise };
    }),
    pauseActiveCampaigns: vi.fn(async () => { paused.push("120330000000000001", "120330000000000002"); return ["120330000000000001", "120330000000000002"]; }),
  };
  return { meta, writes, paused, account };
}

// ₹500 annual quote: ₹400 ad share (40,000 paise) buys 33,898 paise of media at 18% GST.
const paid: SpendCapBalance = { advertisingAllocationPaise: 40_000, advertisingRefundedPaise: 0, held: false };

describe("syncChildSpendCap (#522 wiring)", () => {
  it("sets a new customer's child account limit to the media their ad share buys, and records it", async () => {
    const store = memoryStore();
    const { meta, writes } = metaAccount({ spendCapPaise: 0, amountSpentPaise: 0 });
    const result = await syncChildSpendCap(target, { store, meta, balance: async () => paid });
    expect(result).toEqual({ status: "applied", decision: { action: "set", capPaise: 33_898, roomPaise: 33_898 }, passes: 1 });
    expect(meta.setAccountSpendCap).toHaveBeenCalledExactlyOnceWith(33_898, 33_898);
    expect(writes).toEqual([33_898]);
    expect(await store.state(target.businessId, target.adAccountId)).toEqual({ dirty: false, action: "set", capPaise: 33_898, roomPaise: 33_898 });
  });

  it("lowers the limit after a refund, counting what Meta already spent", async () => {
    const store = memoryStore({ mediaThisAccountPaise: 8_000, mediaOtherAccountsPaise: 0, taxRateBps: 1800 });
    const { meta } = metaAccount({ spendCapPaise: 33_898, amountSpentPaise: 10_000 });
    // Half the ad share refunded: 20,000 net buys 16,949 media; 10,000 is already spent.
    const result = await syncChildSpendCap(target, { store, meta, balance: async () => ({ ...paid, advertisingRefundedPaise: 20_000 }) });
    expect(result).toMatchObject({ status: "applied", decision: { action: "set", capPaise: 16_949, roomPaise: 6_949 } });
    expect(meta.setAccountSpendCap).toHaveBeenCalledExactlyOnceWith(16_949, 6_949);
  });

  it("never leaves a stale, higher limit last when a refund lands while a payment's write is in flight", async () => {
    const store = memoryStore();
    let balance: SpendCapBalance = paid;
    let releaseFirstWrite!: () => void;
    const firstWrite = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    let writesStarted = 0;
    const { meta, writes, account } = metaAccount({ spendCapPaise: 0, amountSpentPaise: 0 }, async () => {
      if (++writesStarted === 1) await firstWrite;
    });
    const deps = { store, meta, balance: async () => balance };
    // The payment event reads the full ad share and starts writing 33,898...
    const payment = syncChildSpendCap(target, deps);
    await vi.waitFor(() => expect(writesStarted).toBe(1));
    // ...then the whole ad share is refunded and the refund event arrives mid-write.
    balance = { ...paid, advertisingRefundedPaise: 40_000 };
    const refund = await syncChildSpendCap(target, deps);
    expect(refund).toEqual({ status: "queued" });
    releaseFirstWrite();
    const applied = await payment;
    // The payment's writer saw the refund mark and ran again: with nothing spent it stops the account.
    expect(applied).toMatchObject({ status: "applied", decision: { action: "stop" }, passes: 2 });
    expect(writes).toEqual([33_898, STOP_SPEND_CAP_PAISE]);
    expect(account.spendCapPaise).toBe(STOP_SPEND_CAP_PAISE);
    expect(meta.pauseActiveCampaigns).toHaveBeenCalledOnce();
  });

  it("stops a held account with nothing spent: pauses every campaign on it, then lowers its limit", async () => {
    const store = memoryStore();
    const { meta, writes } = metaAccount({ spendCapPaise: 33_898, amountSpentPaise: 0 });
    const result = await syncChildSpendCap(target, { store, meta, balance: async () => ({ ...paid, held: true }) });
    expect(result).toEqual({ status: "applied", decision: { action: "stop", reason: "held" }, passes: 1 });
    expect(vi.mocked(meta.pauseActiveCampaigns).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(meta.setAccountSpendCap).mock.invocationCallOrder[0]);
    expect(writes).toEqual([STOP_SPEND_CAP_PAISE]);
    expect(store.row.decision).toEqual({ action: "stop", capPaise: STOP_SPEND_CAP_PAISE, roomPaise: 0 });
  });

  it("still stops when Meta refuses the lowest limit: campaigns are paused and nothing can activate", async () => {
    const store = memoryStore();
    const { meta } = metaAccount({ spendCapPaise: 33_898, amountSpentPaise: 0 });
    vi.mocked(meta.setAccountSpendCap).mockRejectedValueOnce(new MetaError("The spending limit must be at least ₹100."));
    const result = await syncChildSpendCap(target, { store, meta, balance: async () => ({ ...paid, advertisingRefundedPaise: 40_000 }) });
    expect(result).toMatchObject({ status: "applied", decision: { action: "stop", reason: "no_allowance" } });
    expect(meta.pauseActiveCampaigns).toHaveBeenCalledOnce();
    expect(store.row.decision).toEqual({ action: "stop", capPaise: 33_898, roomPaise: 0 });
  });

  it("still lowers the limit when a campaign can't be paused, then fails the pass so nothing activates (review)", async () => {
    const store = memoryStore();
    const { meta, writes } = metaAccount({ spendCapPaise: 33_898, amountSpentPaise: 0 });
    vi.mocked(meta.pauseActiveCampaigns).mockRejectedValueOnce(new MetaError("Meta refused to pause a campaign."));
    await expect(syncChildSpendCap(target, { store, meta, balance: async () => ({ ...paid, held: true }) })).rejects.toThrow("refused to pause");
    expect(writes).toEqual([STOP_SPEND_CAP_PAISE]);
    expect(store.row).toMatchObject({ dirty: true, token: null, decision: null });
  });

  it("still lowers the limit when AdBrain's bookkeeping fails after the pause (review)", async () => {
    const store = memoryStore();
    const { meta, writes } = metaAccount({ spendCapPaise: 33_898, amountSpentPaise: 0 });
    const onStopped = vi.fn(async () => { throw new Error("database unavailable"); });
    await expect(syncChildSpendCap(target, { store, meta, onStopped, balance: async () => ({ ...paid, held: true }) })).rejects.toThrow("database unavailable");
    expect(writes).toEqual([STOP_SPEND_CAP_PAISE]);
    expect(store.row).toMatchObject({ token: null, decision: null });
  });

  it("abandons the pass when its decision can't be recorded, so an old one isn't left to activate on (review)", async () => {
    const store = memoryStore();
    const { meta } = metaAccount({ spendCapPaise: 0, amountSpentPaise: 0 });
    store.row.decision = { action: "set", capPaise: 50_000, roomPaise: 50_000 };
    store.finish = vi.fn(async () => { throw new SpendCapStoreError(); });
    await expect(syncChildSpendCap(target, { store, meta, balance: async () => paid })).rejects.toThrow(SpendCapStoreError);
    expect(store.row).toMatchObject({ dirty: true, token: null, decision: null });
  });

  it("freezes a held account that has spent at what it spent", async () => {
    const store = memoryStore({ mediaThisAccountPaise: 20_000, mediaOtherAccountsPaise: 0, taxRateBps: 1800 });
    const { meta } = metaAccount({ spendCapPaise: 33_898, amountSpentPaise: 20_000 });
    const result = await syncChildSpendCap(target, { store, meta, balance: async () => ({ ...paid, held: true }) });
    expect(result).toMatchObject({ decision: { action: "freeze", capPaise: 20_000, reason: "held" } });
    expect(meta.setAccountSpendCap).toHaveBeenCalledExactlyOnceWith(20_000, 0);
    expect(meta.pauseActiveCampaigns).not.toHaveBeenCalled();
  });

  it("writes nothing when Meta already holds the right limit", async () => {
    const store = memoryStore();
    const { meta } = metaAccount({ spendCapPaise: 33_898, amountSpentPaise: 0 });
    expect(await syncChildSpendCap(target, { store, meta, balance: async () => paid })).toMatchObject({ decision: { action: "keep" } });
    expect(meta.setAccountSpendCap).not.toHaveBeenCalled();
  });

  it("counts a higher tax rate from Meta's evidence, never a lower one", async () => {
    const store = memoryStore({ mediaThisAccountPaise: 0, mediaOtherAccountsPaise: 0, taxRateBps: 0 });
    const { meta } = metaAccount({ spendCapPaise: 0, amountSpentPaise: 0 });
    expect(await syncChildSpendCap(target, { store, meta, balance: async () => paid })).toMatchObject({ decision: { capPaise: 33_898 } });
  });

  it("drops the decision and frees the lease when a pass fails, so nothing activates on a stale limit", async () => {
    const store = memoryStore();
    const { meta } = metaAccount({ spendCapPaise: 0, amountSpentPaise: 0 });
    store.row.decision = { action: "set", capPaise: 33_898, roomPaise: 33_898 };
    vi.mocked(meta.readAccountFunding).mockRejectedValueOnce(new MetaError("Meta is unavailable."));
    await expect(syncChildSpendCap(target, { store, meta, balance: async () => paid })).rejects.toThrow("Meta is unavailable.");
    expect(store.row).toMatchObject({ dirty: true, token: null, decision: null });
  });

  it("refuses a balance without its refunded ad share instead of assuming none", async () => {
    const store = memoryStore();
    const { meta } = metaAccount({ spendCapPaise: 0, amountSpentPaise: 0 });
    const balance = async () => ({ advertisingAllocationPaise: 40_000, held: false }) as unknown as SpendCapBalance;
    await expect(syncChildSpendCap(target, { store, meta, balance })).rejects.toThrow(/cannot be verified/);
    expect(meta.setAccountSpendCap).not.toHaveBeenCalled();
    expect(store.row).toMatchObject({ token: null, decision: null });
  });

  it("hands over when its lease was lost mid-pass, and takes the next pass itself if the lease is free", async () => {
    const store = memoryStore();
    const { meta } = metaAccount({ spendCapPaise: 0, amountSpentPaise: 0 });
    const finish = store.finish.bind(store);
    store.finish = vi.fn(async (adAccountId, token, decision) => {
      if (vi.mocked(store.finish).mock.calls.length === 1) { store.row.token = null; throw new SpendCapLeaseLostError(); }
      return finish(adAccountId, token, decision);
    });
    expect(await syncChildSpendCap(target, { store, meta, balance: async () => paid })).toMatchObject({ status: "applied", passes: 2 });
  });
});
