import { describe, expect, it } from "vitest";
import { pilotRows, type PilotData } from "@/lib/observability/core-scoreboard";

// #1697 (CPO #1685): the pilot funnel as counts only: prepared → handed over → live → Day 7 → Day 7 answer.
const now = new Date("2026-11-10T03:30:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const base: PilotData = {
  prospectBusinessIds: [], handedOverBusinessIds: [], firstLaunch: {}, day7Answers: {}, excludedBusinessIds: ["smoke-biz"], now,
};

describe("scoreboard: pilots (#1697)", () => {
  it("counts each stage cumulatively, with the Day 7 answers split", () => {
    const rows = pilotRows({
      ...base,
      // a, b still with the rep (prepared only); c handed over, never live; d live 3 days; e live 9 days, answered; f live 6 days.
      prospectBusinessIds: ["a", "b"],
      handedOverBusinessIds: ["c", "d", "e", "f"],
      firstLaunch: { d: daysAgo(3), e: daysAgo(9), f: daysAgo(6), a: daysAgo(20) },
      day7Answers: { e: "maybe" },
    });
    expect(rows).toEqual([
      expect.objectContaining({ step: "Pilots", now: "6 prepared → 4 handed over → 3 live → 1 at Day 7 (answers: yes 0, maybe 1, no 0)", met: null }),
      expect.objectContaining({ step: "Pilots: Day 7 due in 48 h", now: "1" }),
    ]);
  });

  it("counts only handed-over businesses as live, and leaves the smoke out", () => {
    const rows = pilotRows({ ...base, prospectBusinessIds: ["a", "smoke-biz"], handedOverBusinessIds: ["smoke-biz"], firstLaunch: { a: daysAgo(10), "smoke-biz": daysAgo(10) } });
    expect(rows[0].now).toBe("1 prepared → 0 handed over → 0 live → 0 at Day 7 (answers: yes 0, maybe 0, no 0)");
  });

  it("says nothing until there's a pilot", () => {
    expect(pilotRows(base)).toEqual([]);
  });
});
