import { describe, expect, it } from "vitest";
import {
  AGE_BOUNDS,
  normalizeAgeRange,
  normalizeTargetingInput,
} from "@/lib/campaign/targeting";

describe("normalizeAgeRange", () => {
  it("keeps a sensible range untouched", () => {
    expect(normalizeAgeRange(30, 55)).toEqual({ min: 30, max: 55 });
  });

  it("collapses an inverted range to the lower bound", () => {
    // The form used to preview "ages 60–25" while the server sent 60–60.
    expect(normalizeAgeRange(60, 25)).toEqual({ min: 60, max: 60 });
  });

  it("clamps to the bounds Meta accepts", () => {
    expect(normalizeAgeRange(2, 120)).toEqual({
      min: AGE_BOUNDS.min,
      max: AGE_BOUNDS.max,
    });
    expect(normalizeAgeRange(70, 80)).toEqual({ min: 65, max: 65 });
  });

  it("falls back to the lower bound for unusable numbers", () => {
    expect(normalizeAgeRange(Number.NaN, 40)).toEqual({
      min: AGE_BOUNDS.min,
      max: 40,
    });
    expect(normalizeAgeRange(30, Number.NaN)).toEqual({ min: 30, max: 30 });
  });

  it("rounds fractional ages", () => {
    expect(normalizeAgeRange(30.4, 54.6)).toEqual({ min: 30, max: 55 });
  });
});

describe("normalizeTargetingInput age handling", () => {
  const manual = (min: number, max: number) =>
    normalizeTargetingInput({ age: { mode: "manual", min, max } });

  it("matches normalizeAgeRange exactly, so form and server agree", () => {
    for (const [min, max] of [
      [30, 55],
      [60, 25],
      [2, 120],
      [18, 18],
    ] as const) {
      const settled = normalizeAgeRange(min, max);
      const normalized = manual(min, max);
      expect({ min: normalized.ageMin, max: normalized.ageMax }).toEqual(settled);
    }
  });

  it("leaves ages to Meta in ai mode", () => {
    const t = normalizeTargetingInput({ age: { mode: "ai" } });
    expect(t.ageMode).toBe("ai");
    expect(t.ageMin).toBeUndefined();
    expect(t.ageMax).toBeUndefined();
  });
});
