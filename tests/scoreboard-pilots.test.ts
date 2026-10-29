import { describe, expect, it } from "vitest";
import { pilotData, pilotRows, type PilotData } from "@/lib/observability/core-scoreboard";

// #1697 (CPO #1685): the pilot funnel as counts only: prepared → handed over → live → Day 7 → Day 7 answer.
const now = new Date("2026-11-10T03:30:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const base: PilotData = {
  prospectBusinessIds: [], handedOverBusinessIds: [], firstLaunch: {}, day7Answers: {}, recentEnquiries: [], excludedBusinessIds: ["smoke-biz"], now,
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
      expect.objectContaining({ step: "Pilots: enquiries in 24 h", now: "0" }),
    ]);
  });

  it("counts only handed-over businesses as live, and leaves the smoke out", () => {
    const rows = pilotRows({ ...base, prospectBusinessIds: ["a", "smoke-biz"], handedOverBusinessIds: ["smoke-biz"], firstLaunch: { a: daysAgo(10), "smoke-biz": daysAgo(10) } });
    expect(rows[0].now).toBe("1 prepared → 0 handed over → 0 live → 0 at Day 7 (answers: yes 0, maybe 0, no 0)");
  });

  it("says nothing until there's a pilot", () => {
    expect(pilotRows(base)).toEqual([]);
  });

  // #1965: the CEO's fourth morning number, real enquiries on live pilots in the last 24 h.
  it("counts real enquiries from the last 24 h on live pilots, without Meta test leads", () => {
    const hoursAgo = (n: number) => new Date(now.getTime() - n * 3_600_000).toISOString();
    const lead = (business_id: string, created_at: string, full_name: string | null = null) => ({ business_id, created_at, full_name });
    const data = pilotData({
      prospectCreatives: [{ business_id: "prep" }],
      pilotEvents: ["live", "handed", "smoke-biz"].map((business_id) => ({ business_id, name: "prospect.handed_over", attributes: null, created_at: daysAgo(4) })),
      launchedRows: [{ business_id: "live", launched_at: daysAgo(3) }, { business_id: "prep", launched_at: daysAgo(3) }, { business_id: "smoke-biz", launched_at: daysAgo(3) }],
      leads: [
        lead("live", hoursAgo(2), "Ravi"), lead("live", hoursAgo(23)), lead("live", hoursAgo(5), "Asha"),
        lead("live", hoursAgo(25)),
        lead("live", hoursAgo(1), "<test lead: dummy data for full_name>"),
        lead("handed", hoursAgo(1)), lead("prep", hoursAgo(1)), lead("smoke-biz", hoursAgo(1)),
      ],
      excludedBusinessIds: ["smoke-biz"],
      now,
    });
    expect(pilotRows(data).map((row) => [row.step, row.now])).toEqual([
      ["Pilots", "3 prepared → 2 handed over → 1 live → 0 at Day 7 (answers: yes 0, maybe 0, no 0)"],
      ["Pilots: Day 7 due in 48 h", "0"],
      ["Pilots: enquiries in 24 h", "3"],
    ]);
  });
});
