import { describe, expect, it } from "vitest";
import {
  ASSUMED_CPL_HIGH,
  ASSUMED_CPL_LOW,
  BUDGET_PRESETS,
  describeBudget,
  estimateLeadsPerWeek,
  spendHealth,
} from "@/lib/campaign/budget";

describe("estimateLeadsPerWeek", () => {
  it("returns null for non-positive or invalid budgets", () => {
    expect(estimateLeadsPerWeek(0)).toBeNull();
    expect(estimateLeadsPerWeek(-100)).toBeNull();
    expect(estimateLeadsPerWeek(Number.NaN)).toBeNull();
  });

  it("estimates a range from the assumed CPL band when no CPL is known", () => {
    const est = estimateLeadsPerWeek(500)!;
    expect(est.exact).toBe(false);
    expect(est.weeklyBudget).toBe(3500);
    expect(est.low).toBe(Math.floor(3500 / ASSUMED_CPL_HIGH));
    expect(est.high).toBe(Math.round(3500 / ASSUMED_CPL_LOW));
    expect(est.low).toBeLessThanOrEqual(est.high);
  });

  it("gives an exact figure when a real CPL is provided", () => {
    const est = estimateLeadsPerWeek(700, 100)!;
    expect(est.exact).toBe(true);
    expect(est.low).toBe(est.high);
    expect(est.low).toBe(Math.round((700 * 7) / 100));
  });
});

describe("describeBudget", () => {
  it("prompts for input when there's no budget", () => {
    expect(describeBudget(0)).toMatch(/enter a daily budget/i);
  });

  it("shows a range for the estimate case", () => {
    expect(describeBudget(500)).toMatch(/leads\/week/i);
    expect(describeBudget(500)).toMatch(/estimate/i);
  });

  it("shows an exact, singular-aware figure with a known CPL", () => {
    expect(describeBudget(700, 100)).toMatch(/about \d+ leads?\/week/i);
    expect(describeBudget(20, 140)).toMatch(/about 1 lead\/week/i);
  });

  it("warns when the budget is too low for steady leads", () => {
    expect(describeBudget(5)).toMatch(/too low/i);
  });

  it("exposes sane presets", () => {
    expect(BUDGET_PRESETS).toContain(500);
    expect([...BUDGET_PRESETS].every((n) => n > 0)).toBe(true);
  });
});

describe("spendHealth", () => {
  it("is idle before any spend", () => {
    expect(spendHealth({ spend: 0, leads: 0 }).tone).toBe("idle");
  });

  it("warns when money is spent but no leads came in", () => {
    const h = spendHealth({ spend: 900, leads: 0 });
    expect(h.tone).toBe("warn");
    expect(h.label).toBe("No leads yet");
    expect(h.detail).toContain("900");
  });

  it("flags cheap leads as good", () => {
    const h = spendHealth({ spend: 300, leads: 10, cpl: ASSUMED_CPL_LOW - 10 });
    expect(h.tone).toBe("good");
  });

  it("marks mid-band CPL as on track", () => {
    const mid = (ASSUMED_CPL_LOW + ASSUMED_CPL_HIGH) / 2;
    expect(spendHealth({ spend: 500, leads: 3, cpl: mid }).tone).toBe("ok");
  });

  it("warns on expensive leads above the band", () => {
    const h = spendHealth({ spend: 5000, leads: 2, cpl: ASSUMED_CPL_HIGH + 100 });
    expect(h.tone).toBe("warn");
    expect(h.label).toBe("Pricey leads");
  });

  it("derives CPL from spend/leads when cpl is missing, and uses the money formatter", () => {
    const h = spendHealth({ spend: 1000, leads: 5 }, (n) => `$${n}`);
    expect(h.tone).toBe("ok"); // 200/lead is within the band
    expect(h.detail).toContain("$200");
  });
});
