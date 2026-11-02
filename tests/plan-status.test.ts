import { describe, expect, it } from "vitest";
import { addMonth, PLAN_PRICE_PAISE, planStatus, type PlanPeriod } from "@/lib/plan/status";

const paid = (startsAt: string, endsAt: string): PlanPeriod => ({ kind: "paid", state: "paid", startsAt, endsAt, paidAt: startsAt });
const at = (iso: string) => new Date(iso);

describe("planStatus (#718 slice 2)", () => {
  it("charges ₹999", () => {
    expect(PLAN_PRICE_PAISE).toBe(99_900);
  });

  it("never gates an exempt business or one that hasn't gone live", () => {
    expect(planStatus({ exempt: true, firstLaunchAt: "2026-01-01T00:00:00Z", periods: [], now: at("2026-10-28T00:00:00Z") })).toEqual({ state: "exempt" });
    expect(planStatus({ exempt: false, firstLaunchAt: null, periods: [], now: at("2026-10-28T00:00:00Z") })).toEqual({ state: "trial_not_started" });
  });

  it("is free for one calendar month from the first Go live, due soon in its last 7 days", () => {
    const base = { exempt: false, firstLaunchAt: "2026-10-10T09:00:00.000Z", periods: [] };
    expect(planStatus({ ...base, now: at("2026-10-20T00:00:00Z") })).toEqual({ state: "free", until: "2026-11-10T09:00:00.000Z", dueSoon: false });
    expect(planStatus({ ...base, now: at("2026-11-04T09:00:00Z") })).toEqual({ state: "free", until: "2026-11-10T09:00:00.000Z", dueSoon: true });
    expect(planStatus({ ...base, now: at("2026-11-10T09:00:01Z") })).toEqual({ state: "unpaid", since: "2026-11-10T09:00:00.000Z" });
  });

  it("extends through paid months and ignores open or expired ones", () => {
    const periods: PlanPeriod[] = [
      paid("2026-11-10T09:00:00.000Z", "2026-12-10T09:00:00.000Z"),
      { kind: "paid", state: "open", startsAt: null, endsAt: null, paidAt: null },
      { kind: "paid", state: "expired", startsAt: "2026-12-10T09:00:00.000Z", endsAt: "2027-01-10T09:00:00.000Z", paidAt: null },
    ];
    expect(planStatus({ exempt: false, firstLaunchAt: "2026-10-10T09:00:00.000Z", periods, now: at("2026-11-20T00:00:00Z") }))
      .toEqual({ state: "paid", until: "2026-12-10T09:00:00.000Z", dueSoon: false });
    expect(planStatus({ exempt: false, firstLaunchAt: "2026-10-10T09:00:00.000Z", periods, now: at("2026-12-11T00:00:00Z") }))
      .toEqual({ state: "unpaid", since: "2026-12-10T09:00:00.000Z" });
  });

  it("clamps month ends (Jan 31 → Feb 28, leap Feb 29)", () => {
    expect(addMonth("2027-01-31T10:00:00.000Z")).toBe("2027-02-28T10:00:00.000Z");
    expect(addMonth("2028-01-31T10:00:00.000Z")).toBe("2028-02-29T10:00:00.000Z");
    expect(addMonth("2026-12-15T00:00:00.000Z")).toBe("2027-01-15T00:00:00.000Z");
  });
});
