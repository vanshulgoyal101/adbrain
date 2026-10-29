import { describe, expect, it } from "vitest";
import { compare, report, violationsOf } from "../scripts/check-boundaries.mjs";

const edge = (rule: string, from: string, to: string) => ({ rule, from, to });
const ui = edge("R1-ui-no-channels", "src/components/a.tsx", "src/lib/meta/client.ts");
const money = edge("R6-money-not-in-adapters", "src/lib/meta/connection-access.ts", "src/lib/managed/spend-cap-wiring.ts");

describe("check-boundaries (#2070)", () => {
  it("reads dependency-cruiser JSON into sorted, de-duplicated edges", () => {
    const raw = { summary: { violations: [
      { rule: { name: money.rule }, from: money.from, to: money.to },
      { rule: { name: ui.rule }, from: ui.from, to: ui.to },
      { rule: { name: ui.rule }, from: ui.from, to: ui.to },
      { rule: {}, from: "x", to: "y" },
    ] } };
    expect(violationsOf(raw)).toEqual([ui, money]);
    expect(violationsOf({})).toEqual([]);
  });

  it("passes when the code matches the baseline", () => {
    const result = compare([ui, money], [ui, money], [ui, money]);
    expect(result.ok).toBe(true);
    expect(result.perRule).toEqual([
      { rule: ui.rule, now: 1, baseline: 1, base: 1 },
      { rule: money.rule, now: 1, baseline: 1, base: 1 },
    ]);
  });

  it("fails a new edge that the baseline doesn't list", () => {
    const fresh = edge("R1-ui-no-channels", "src/components/b.tsx", "src/lib/meta/client.ts");
    const result = compare([ui, fresh], [ui]);
    expect(result.ok).toBe(false);
    expect(result.added).toEqual([fresh]);
    expect(report(result)).toContain("New violations (1)");
  });

  it("fails a fixed edge still in the baseline, so every fix shows as −N", () => {
    const result = compare([ui], [ui, money]);
    expect(result.ok).toBe(false);
    expect(result.fixed).toEqual([money]);
    expect(report(result)).toContain("baseline −1");
  });

  it("fails a baseline that grew against the base branch, even when it matches the code", () => {
    const result = compare([ui, money], [ui, money], [ui]);
    expect(result.ok).toBe(false);
    expect(result.grown).toEqual([money]);
    expect(report(result)).toContain("| R6-money-not-in-adapters | 1 | 1 | +1 |");
  });

  it("passes a slice that shrinks the baseline and prints the shrink", () => {
    const result = compare([ui], [ui], [ui, money]);
    expect(result.ok).toBe(true);
    expect(report(result)).toContain("| R6-money-not-in-adapters | 0 | 0 | −1 |");
  });
});
