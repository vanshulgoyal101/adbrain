import { describe, expect, it } from "vitest";
import {
  ASSUMED_CPL_HIGH,
  ASSUMED_CPL_LOW,
  BUDGET_PRESETS,
  describeBudget,
  estimateLeadsPerWeek,
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
