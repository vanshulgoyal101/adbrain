import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ enabled: vi.fn(), readPlan: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/plan/store", () => ({ isPlanBillingEnabled: mocks.enabled, readPlan: mocks.readPlan }));
vi.mock("@/lib/observability/logger", () => ({ recordProductEvent: mocks.record }));

import { planGate, PLAN_UNPAID_MESSAGE } from "@/lib/plan/gate";

const businessId = "55555555-5555-4555-8555-555555555555";
beforeEach(() => { vi.resetAllMocks(); mocks.enabled.mockReturnValue(true); });

// #718 slice 2: billing must never break the core loop. Only an unpaid own-account plan stops a *new* ad or campaign.
describe("plan gate (core, #718)", () => {
  it("does nothing while plan billing is off, without reading the plan", async () => {
    mocks.enabled.mockReturnValue(false);
    expect(await planGate(businessId)).toBeNull();
    expect(mocks.readPlan).not.toHaveBeenCalled();
  });

  it.each([
    [{ state: "exempt" }], [{ state: "trial_not_started" }],
    [{ state: "free", until: "2026-11-10T09:00:00.000Z", dueSoon: true }], [{ state: "paid", until: "2026-12-10T09:00:00.000Z", dueSoon: false }],
  ])("lets %j through", async (status) => {
    mocks.readPlan.mockResolvedValue({ status, payUrl: null });
    expect(await planGate(businessId)).toBeNull();
  });

  it("stops a new ad or campaign when unpaid, with the plain reason", async () => {
    mocks.readPlan.mockResolvedValue({ status: { state: "unpaid", since: "2026-11-10T09:00:00.000Z" }, payUrl: null });
    expect(await planGate(businessId)).toEqual({ status: 402, code: "PLAN_UNPAID", error: PLAN_UNPAID_MESSAGE });
    expect(PLAN_UNPAID_MESSAGE).toBe("Your ₹999 plan payment is due. Running ads keep running. Pay in Settings to make new ads and campaigns.");
  });

  it("fails open and records it when the plan can't be read", async () => {
    mocks.readPlan.mockRejectedValue(new Error("db down"));
    expect(await planGate(businessId)).toBeNull();
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ name: "plan.gate", outcome: "failed" }));
  });
});
