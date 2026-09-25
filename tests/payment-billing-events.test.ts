import { beforeEach, describe, expect, it, vi } from "vitest";
import { assessMetaCharge, type MetaBillingEvent } from "@/lib/payments/meta-billing-events";
import { getStoredMetaChargeAssessment, recordMetaBillingEvent } from "@/lib/payments/meta-funding-store";

const storage = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: storage.rpc }) }));

const event: MetaBillingEvent = {
  version: 1, businessId: "11111111-1111-4111-8111-111111111111", environment: "test",
  accountId: "act_123", sourceEventId: "event_1", chargeId: "charge_1", status: "succeeded",
  amountPaise: 100_000, taxPaise: null, currency: "INR", occurredAt: "2026-09-24T10:00:00Z", payloadHash: "a".repeat(64),
};
const context = { businessId: event.businessId, environment: "test", accountId: event.accountId,
  chargeId: event.chargeId, now: "2026-09-24T11:00:00Z" };
const ingestionContext = { ...context, actorId: "22222222-2222-4222-8222-222222222222",
  source: "test_fixture", sourceReference: "33333333-3333-4333-8333-333333333333" };

describe("observed Meta charges", () => {
  it("does not equate provider success with settled cash, customer credit or activation", () => {
    expect(assessMetaCharge([event], context)).toEqual({
      status: "awaiting_settlement", observedAmountPaise: 100_000, blockers: [],
      canCreditCustomerBalance: false, canActivateCampaign: false, canRetryCharge: false,
    });
  });

  it("deduplicates identical deliveries and different event IDs for the same charge without summing", () => {
    expect(assessMetaCharge([event, { ...event }, { ...event, sourceEventId: "event_2" }], context).observedAmountPaise).toBe(100_000);
  });

  it("does not let late pending events overwrite success", () => {
    const pending = { ...event, status: "pending", sourceEventId: "event_pending" };
    expect(assessMetaCharge([pending, event], context)).toEqual(assessMetaCharge([event, pending], context));
    expect(assessMetaCharge([event, pending], context).status).toBe("awaiting_settlement");
  });

  it.each(["pending", "failed", "reversed"] as const)("keeps %s observations non-spendable", status => {
    const result = assessMetaCharge([{ ...event, status }], context);
    expect(result.status).toBe(status === "pending" ? "awaiting_provider" : status === "failed" ? "failed" : "needs_reconciliation");
    expect(result.canCreditCustomerBalance).toBe(false);
    expect(result.canRetryCharge).toBe(false);
  });

  it("requires reconciliation for a reversal even after a success", () => {
    expect(assessMetaCharge([event, { ...event, status: "reversed", sourceEventId: "reversal_1" }], context).status).toBe("needs_reconciliation");
  });

  it.each([
    [{ sourceEventId: "event_1", payloadHash: "b".repeat(64) }, "EVENT_CONFLICT"],
    [{ sourceEventId: "event_2", amountPaise: 100_001 }, "AMOUNT_CONFLICT"],
    [{ sourceEventId: "event_2", taxPaise: 0 }, "AMOUNT_CONFLICT"],
    [{ sourceEventId: "event_2", status: "failed" }, "STATUS_CONFLICT"],
    [{ businessId: "22222222-2222-4222-8222-222222222222" }, "SCOPE_MISMATCH"],
    [{ environment: "live" }, "SCOPE_MISMATCH"],
    [{ accountId: "act_456" }, "SCOPE_MISMATCH"],
    [{ chargeId: "charge_2" }, "SCOPE_MISMATCH"],
    [{ occurredAt: "2026-09-24T12:00:00Z" }, "FUTURE_EVENT"],
  ])("quarantines inconsistent evidence %j", (override, blocker) => {
    const result = assessMetaCharge([event, { ...event, ...override }], context);
    expect(result.status).toBe("needs_reconciliation");
    expect(result.blockers).toContain(blocker);
    expect(result.observedAmountPaise).toBeNull();
  });

  it.each([0, -1, 0.1, Infinity, Number.MAX_SAFE_INTEGER + 1, "100000", null])("rejects invalid amount %s", amountPaise => {
    expect(assessMetaCharge([{ ...event, amountPaise }], context).blockers).toEqual(["INVALID_EVIDENCE"]);
  });

  it.each([{ taxPaise: -1 }, { taxPaise: 100_001 }, { currency: "USD" }, { status: "settled" },
    { sourceEventId: "" }, { payloadHash: "unverified" }, { occurredAt: "bad-date" }, { accessToken: "not-a-real-token" },
  ])("rejects malformed evidence %j", override => {
    expect(assessMetaCharge([{ ...event, ...override }], context).blockers).toEqual(["INVALID_EVIDENCE"]);
  });

  it("fails closed for absent evidence or invalid context", () => {
    expect(assessMetaCharge([], context).blockers).toEqual(["NO_EVIDENCE"]);
    expect(assessMetaCharge(null, context).blockers).toEqual(["INVALID_EVIDENCE"]);
    expect(assessMetaCharge([event], { ...context, now: "bad-date" }).blockers).toEqual(["INVALID_EVIDENCE"]);
  });
});

describe("stored Meta charge observations", () => {
  beforeEach(() => { storage.rpc.mockReset(); });

  it.each(["recorded", "duplicate", "conflict"])("preserves the atomic %s outcome", async outcome => {
    storage.rpc.mockResolvedValue({ data: outcome, error: null });
    expect(await recordMetaBillingEvent(event, ingestionContext)).toBe(outcome);
    expect(storage.rpc).toHaveBeenCalledExactlyOnceWith("meta_billing_event_record", {
      p_business_id: context.businessId, p_environment: "test", p_record: event,
      p_actor_id: ingestionContext.actorId, p_source: "test_fixture", p_source_reference: ingestionContext.sourceReference,
    });
  });

  it.each([{ accountId: "act_456" }, { chargeId: "charge_2" }, { environment: "live" },
    { businessId: "44444444-4444-4444-8444-444444444444" },
  ])("rejects a scope mismatch before storage %j", async override => {
    expect(await recordMetaBillingEvent(event, { ...ingestionContext, ...override })).toBe("scope_mismatch");
    expect(storage.rpc).not.toHaveBeenCalled();
  });

  it("rejects test fixtures in live profiles even when account and tenant match", async () => {
    expect(await recordMetaBillingEvent({ ...event, environment: "live" }, { ...ingestionContext, environment: "live" })).toBe("scope_mismatch");
    expect(storage.rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed and future observations before any storage call", async () => {
    expect(await recordMetaBillingEvent({}, ingestionContext)).toBe("invalid_input");
    expect(await recordMetaBillingEvent(event, {})).toBe("invalid_input");
    expect(await recordMetaBillingEvent({ ...event, occurredAt: "2027-01-01T00:00:00Z" }, ingestionContext)).toBe("invalid_input");
    expect(storage.rpc).not.toHaveBeenCalled();
  });

  it.each([{ data: null, error: { message: "private error" } }, { data: "unexpected", error: null }])(
    "does not acknowledge failed or unknown database outcomes", async response => {
      storage.rpc.mockResolvedValue(response);
      expect(await recordMetaBillingEvent(event, ingestionContext)).toBe("unavailable");
    },
  );

  it("treats ambiguous write errors as unavailable rather than success", async () => {
    storage.rpc.mockRejectedValue(new Error("response lost"));
    expect(await recordMetaBillingEvent(event, ingestionContext)).toBe("unavailable");
  });

  it("reads charge-scoped observations without returning raw evidence", async () => {
    storage.rpc.mockResolvedValue({ data: { events: [event], hasConflicts: false }, error: null });
    const result = await getStoredMetaChargeAssessment(context);
    expect(result.status).toBe("available");
    expect(result.assessment.status).toBe("awaiting_settlement");
    expect(result).not.toHaveProperty("events");
    expect(storage.rpc).toHaveBeenCalledExactlyOnceWith("meta_billing_charge_observations", {
      p_business_id: context.businessId, p_environment: "test", p_charge_id: context.chargeId,
    });
  });

  it("a durable conflict prevents the original successful event from looking reconciled", async () => {
    storage.rpc.mockResolvedValue({ data: { events: [event], hasConflicts: true }, error: null });
    const result = await getStoredMetaChargeAssessment(context);
    expect(result.assessment.status).toBe("needs_reconciliation");
    expect(result.assessment.observedAmountPaise).toBeNull();
    expect(result.assessment.blockers).toContain("EVENT_CONFLICT");
    expect(result.assessment.canCreditCustomerBalance).toBe(false);
  });

  it("distinguishes no events from storage failure and rejects invalid context", async () => {
    storage.rpc.mockResolvedValue({ data: { events: [], hasConflicts: false }, error: null });
    expect((await getStoredMetaChargeAssessment(context)).status).toBe("missing");
    storage.rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    expect((await getStoredMetaChargeAssessment(context)).status).toBe("unavailable");
    storage.rpc.mockClear();
    expect((await getStoredMetaChargeAssessment({})).status).toBe("invalid_context");
    expect(storage.rpc).not.toHaveBeenCalled();
  });

  it.each([null, {}, { events: [event], hasConflicts: "false" },
    { events: Array.from({ length: 1001 }, () => event), hasConflicts: false },
  ])("does not assess malformed or truncated stored observations %j", async data => {
    storage.rpc.mockResolvedValue({ data, error: null });
    const result = await getStoredMetaChargeAssessment(context);
    expect(result.status).toBe("unavailable");
    expect(result.assessment.status).toBe("needs_reconciliation");
  });

  it("fails closed when the charge reader throws", async () => {
    storage.rpc.mockRejectedValue(new Error("network failed"));
    expect((await getStoredMetaChargeAssessment(context)).status).toBe("unavailable");
  });
});