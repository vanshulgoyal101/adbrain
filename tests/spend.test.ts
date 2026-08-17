import { describe, expect, it } from "vitest";
import {
  campaignsToAutoPause,
  evaluateSpend,
  projectedWeeklySpend,
  trackedSpend,
  wouldExceedCap,
  type CampaignSpend,
  type SpendLimits,
} from "@/lib/campaign/spend";

const limits = (over: Partial<SpendLimits> = {}): SpendLimits => ({
  weeklyCapRupees: 7000,
  alertPct: 80,
  autoPause: false,
  ...over,
});

const c = (
  id: string,
  status: string,
  dailyBudget: number | null,
  spend = 0,
): CampaignSpend => ({ id, status, dailyBudget, spend });

describe("projectedWeeklySpend", () => {
  it("sums only active campaigns' daily budget × 7", () => {
    const campaigns = [
      c("a", "active", 200),
      c("b", "paused", 500),
      c("c", "active", 300),
    ];
    expect(projectedWeeklySpend(campaigns)).toBe((200 + 300) * 7);
  });

  it("ignores null/zero budgets", () => {
    expect(projectedWeeklySpend([c("a", "active", null), c("b", "active", 0)])).toBe(0);
  });
});

describe("trackedSpend", () => {
  it("sums spend across all campaigns regardless of status", () => {
    expect(
      trackedSpend([c("a", "paused", 200, 1200), c("b", "active", 300, 800)]),
    ).toBe(2000);
  });
});

describe("evaluateSpend", () => {
  it("is off when there is no cap", () => {
    const e = evaluateSpend([c("a", "active", 200)], limits({ weeklyCapRupees: null }));
    expect(e.status).toBe("off");
    expect(e.pct).toBe(0);
  });

  it("is ok below the alert threshold", () => {
    // active 200/day → 1400/week, cap 7000 → 20%
    const e = evaluateSpend([c("a", "active", 200)], limits());
    expect(e.status).toBe("ok");
    expect(e.pct).toBe(20);
    expect(e.headroomRupees).toBe(7000 - 1400);
  });

  it("is approaching at/above the alert threshold", () => {
    // 800/day → 5600/week → 80%
    const e = evaluateSpend([c("a", "active", 800)], limits());
    expect(e.status).toBe("approaching");
    expect(e.pct).toBe(80);
  });

  it("is over at/above the cap and gauges against the larger of projected/tracked", () => {
    // paused campaign but real tracked spend exceeds the cap
    const e = evaluateSpend([c("a", "paused", 0, 7500)], limits());
    expect(e.trackedSpend).toBe(7500);
    expect(e.status).toBe("over");
    expect(e.headroomRupees).toBe(0);
  });
});

describe("wouldExceedCap", () => {
  it("never exceeds when there is no cap", () => {
    expect(wouldExceedCap([c("a", "active", 900)], 900, null).exceeds).toBe(false);
  });

  it("blocks when the new active budget pushes projected past the cap", () => {
    const active = [c("a", "active", 500)]; // 3500/week
    const res = wouldExceedCap(active, 600, 7000); // +4200 → 7700 > 7000
    expect(res.projectedAfter).toBe(7700);
    expect(res.exceeds).toBe(true);
  });

  it("allows when it stays within the cap", () => {
    expect(wouldExceedCap([c("a", "active", 500)], 400, 7000).exceeds).toBe(false);
  });
});

describe("campaignsToAutoPause", () => {
  it("returns nothing when auto-pause is off", () => {
    expect(
      campaignsToAutoPause([c("a", "active", 0, 9000)], limits({ autoPause: false })),
    ).toEqual([]);
  });

  it("returns nothing when tracked spend is under the cap", () => {
    expect(
      campaignsToAutoPause([c("a", "active", 0, 5000)], limits({ autoPause: true })),
    ).toEqual([]);
  });

  it("returns active campaign ids when over the cap and auto-pause is on", () => {
    const campaigns = [
      c("a", "active", 0, 5000),
      c("b", "paused", 0, 3000),
      c("d", "active", 0, 0),
    ];
    expect(
      campaignsToAutoPause(campaigns, limits({ autoPause: true })).sort(),
    ).toEqual(["a", "d"]);
  });
});
