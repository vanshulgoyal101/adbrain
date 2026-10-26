import { describe, expect, it } from "vitest";
import { activeHours, changeFailureRate, deployFrequency, leadTimes, timeToRestore } from "../scripts/lib/team-metrics.mjs";

// #620 (#573 D8): the four DORA keys plus active hours per role, from read-only gh data.
const at = (hhmm: string) => `2026-10-25T${hhmm}:00Z`;
const H = 3600e3;

describe("team metrics: DORA four keys and active hours (#620)", () => {
  it("counts deploys as merges to main, trains and direct PRs alike, per day", () => {
    const merges = [{ merged_at: at("10:00") }, { merged_at: at("12:00") }, { merged_at: at("18:00") }];
    expect(deployFrequency(merges, 48)).toEqual({ deploys: 3, perDay: 1.5 });
  });

  it("measures lead time from PR open to the first merge to main that shipped it", () => {
    const mainMerges = [{ merged_at: at("11:00") }, { merged_at: at("15:00") }];
    const prs = [
      { number: 1, created_at: at("09:00"), merged_at: at("10:30"), base: { ref: "next" }, title: "feat: a" }, // shipped by 11:00 → 2 h
      { number: 2, created_at: at("10:00"), merged_at: at("11:00"), base: { ref: "next" }, title: "fix: b" },  // same-minute train → 1 h
      { number: 3, created_at: at("12:00"), merged_at: at("13:00"), base: { ref: "main" }, title: "db: c" },   // straight to main → 1 h
      { number: 4, created_at: at("15:30"), merged_at: at("16:00"), base: { ref: "next" }, title: "feat: d" }, // not shipped yet
      { number: 5, created_at: at("10:50"), merged_at: at("11:00"), base: { ref: "main" }, title: "Deploy train 11:00Z: next → main" },
    ];
    expect(leadTimes(prs, mainMerges)).toEqual({ times: [2 * H, H, H], pending: 1 });
  });

  it("rates change failures as failed guard smokes per production deploy, ignoring cancelled runs and drills", () => {
    const runs = [
      { event: "deployment_status", conclusion: "success", created_at: at("10:00") },
      { event: "deployment_status", conclusion: "failure", created_at: at("11:00") },
      { event: "deployment_status", conclusion: "success", created_at: at("12:00") },
      { event: "deployment_status", conclusion: "success", created_at: at("13:00") },
      { event: "deployment_status", conclusion: "cancelled", created_at: at("14:00") },
      { event: "workflow_dispatch", conclusion: "failure", created_at: at("15:00") },
      { event: "schedule", conclusion: "success", created_at: at("03:30") },
    ];
    expect(changeFailureRate(runs)).toEqual({ deploys: 4, failures: 1, rate: 0.25 });
  });

  it("times restores from a failed smoke to the next passing one, and leaves an open failure out", () => {
    const runs = [
      { event: "deployment_status", conclusion: "failure", created_at: at("10:00") },
      { event: "deployment_status", conclusion: "failure", created_at: at("10:20") },
      { event: "deployment_status", conclusion: "success", created_at: at("10:40") },
      { event: "deployment_status", conclusion: "failure", created_at: at("12:00") },
      { event: "schedule", conclusion: "success", created_at: at("13:30") },
      { event: "deployment_status", conclusion: "failure", created_at: at("18:00") },
    ];
    // One incident 10:00 → 10:40 (a second failure inside it doesn't restart the clock), one 12:00 → 13:30.
    expect(timeToRestore(runs)).toEqual({ times: [40 * 60e3, 90 * 60e3], open: 1 });
  });

  it("counts each role's active hours as the distinct hours it posted in", () => {
    const posts = [
      { who: "Dev", t: Date.parse(at("10:05")) }, { who: "Dev", t: Date.parse(at("10:55")) }, { who: "Dev", t: Date.parse(at("12:10")) },
      { who: "QA", t: Date.parse(at("10:30")) }, { who: "?", t: Date.parse(at("11:00")) },
    ];
    expect(activeHours(posts)).toEqual({ Dev: 2, QA: 1 });
  });
});
