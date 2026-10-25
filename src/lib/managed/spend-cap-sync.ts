import { randomUUID } from "node:crypto";
import { MetaError } from "@/lib/meta/client";
import { childSpendCap, SpendCapInputError, type ChildSpendCapDecision } from "./spend-cap";
import { SpendCapLeaseLostError, type RecordedSpendCapDecision, type SpendCapStore } from "./spend-cap-store";

/**
 * Applies the child ad account's spending limit decision (#522) on Meta, one writer at a time per
 * ad account. A payment, refund or hold event (or the sweep) requests a pass; if another writer
 * holds the lease, the request marks the limit stale and that writer runs again with fresh
 * figures before releasing. So the last limit written comes from the latest balance.
 */

/** Meta charges 18% GST on ads in India; a higher rate in Meta's own evidence wins. */
export const META_GST_RATE_BPS = 1800;
/** "stop" lowers the limit to the smallest positive one; Meta's real minimum is recorded by #527. */
export const STOP_SPEND_CAP_PAISE = 100;
const MAX_PASSES = 5;

export interface SpendCapBalance { advertisingAllocationPaise: number; advertisingRefundedPaise: number; held: boolean }

export interface SpendCapMeta {
  readAccountFunding(): Promise<{ spendCapPaise: number; amountSpentPaise: number }>;
  setAccountSpendCap(capPaise: number, maxRoomPaise: number): Promise<unknown>;
  /** Pauses every active campaign on the child ad account; returns their Meta ids. */
  pauseActiveCampaigns(): Promise<string[]>;
}

export interface SpendCapSyncDeps {
  store: SpendCapStore;
  meta: SpendCapMeta;
  balance(): Promise<SpendCapBalance>;
  /** Bookkeeping after "stop" paused campaigns on Meta (AdBrain status, reservations, audit). */
  onStopped?(metaCampaignIds: string[], reason: "held" | "no_allowance"): Promise<void>;
}

export type SpendCapSyncResult =
  | { status: "applied"; decision: ChildSpendCapDecision; passes: number }
  /** Another writer holds the lease and will apply this event's figures. */
  | { status: "queued" }
  /** Events kept arriving; the limit stays stale (no activation) until the next sweep. */
  | { status: "busy" };

export async function syncChildSpendCap(
  target: { businessId: string; adAccountId: string },
  deps: SpendCapSyncDeps,
  token: string = randomUUID(),
): Promise<SpendCapSyncResult> {
  const { store } = deps;
  if (!await store.request(target.businessId, target.adAccountId, token)) return { status: "queued" };
  for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
    if (!await store.begin(target.adAccountId, token)) return { status: "queued" };
    let applied: { decision: ChildSpendCapDecision; record: RecordedSpendCapDecision };
    try {
      applied = await applyOnce(target, deps);
    } catch (error) {
      await store.abandon(target.adAccountId, token).catch(() => {});
      throw error;
    }
    let again: boolean;
    try {
      again = await store.finish(target.adAccountId, token, applied.record);
    } catch (error) {
      if (!(error instanceof SpendCapLeaseLostError)) throw error;
      // Another writer took over mid-pass. Mark the limit stale so the latest figures are written
      // last: by that writer, or by this one if the lease is free again.
      if (!await store.request(target.businessId, target.adAccountId, token)) return { status: "queued" };
      continue;
    }
    if (!again) return { status: "applied", decision: applied.decision, passes: pass };
  }
  await store.abandon(target.adAccountId, token).catch(() => {});
  return { status: "busy" };
}

async function applyOnce(target: { businessId: string; adAccountId: string }, deps: SpendCapSyncDeps) {
  const [balance, inputs, funding] = await Promise.all([
    deps.balance(), deps.store.inputs(target.businessId, target.adAccountId), deps.meta.readAccountFunding(),
  ]);
  // Assuming no refund would overstate the allowance: a balance without the figure is refused.
  if (!Number.isSafeInteger(balance.advertisingRefundedPaise)) throw new SpendCapInputError();
  const decision = childSpendCap({
    advertisingAllocationPaise: balance.advertisingAllocationPaise,
    advertisingRefundedPaise: balance.advertisingRefundedPaise,
    held: balance.held,
    taxRateBps: Math.max(META_GST_RATE_BPS, inputs.taxRateBps),
    mediaOnOtherAccountsPaise: inputs.mediaOtherAccountsPaise,
    lifetimeMediaSpentPaise: inputs.mediaThisAccountPaise,
    account: { spendCapPaise: funding.spendCapPaise, amountSpentPaise: funding.amountSpentPaise },
  });
  switch (decision.action) {
    case "set":
      await deps.meta.setAccountSpendCap(decision.capPaise, decision.roomPaise);
      return { decision, record: { action: "set", capPaise: decision.capPaise, roomPaise: decision.roomPaise } as const };
    case "keep":
      return { decision, record: { action: "keep", capPaise: decision.capPaise, roomPaise: decision.roomPaise } as const };
    case "freeze":
      if (funding.spendCapPaise !== decision.capPaise) await deps.meta.setAccountSpendCap(decision.capPaise, 0);
      return { decision, record: { action: "freeze", capPaise: decision.capPaise, roomPaise: 0 } as const };
    case "stop": {
      // Pausing is what stops delivery; the lower limit is defence in depth, and the last decision
      // (no room) keeps anything from activating whether or not Meta accepts it.
      const paused = await deps.meta.pauseActiveCampaigns();
      if (paused.length) await deps.onStopped?.(paused, decision.reason);
      const lowered = await deps.meta.setAccountSpendCap(STOP_SPEND_CAP_PAISE, STOP_SPEND_CAP_PAISE).then(() => true, (error: unknown) => {
        if (error instanceof MetaError) return false;
        throw error;
      });
      return { decision, record: { action: "stop", capPaise: lowered ? STOP_SPEND_CAP_PAISE : funding.spendCapPaise, roomPaise: 0 } as const };
    }
  }
}
