import { describe, expect, it } from "vitest";
import { activeHours, changeFailureRate, deployFrequency, formatMinutes, leadTimes, median, p90, timeToRestore } from "../scripts/lib/team-metrics.mjs";

// #620 (#573 D8): the four DORA keys plus active hours per role, from read-only gh data.
const at = (hhmm: string) => `2026-10-25T${hhmm}:00Z`;
const H = 3600e3;

describe("team metrics: DORA four keys and active hours (#620)", () => {
  it("counts deploys as merges to main, trains and direct PRs alike, per day", () => {
    const merges = [{ merged_at: at("10:00") }, { merged_at: at("12:00") }, { merged_at: at("18:00") }];
    expect(deployFrequency(merges, 48)).toEqual({ deploys: 3, perDay: 1.5 });
  });

  it("ships a PR into next with the deploy train whose commits contain its squash commit (#2796)", () => {
    const trains = [
      { number: 10, merged_at: at("11:00"), shas: ["aaa"] },
      { number: 11, merged_at: at("15:00"), shas: ["bbb", "ccc"] },
    ];
    const prs = [
      { number: 1, created_at: at("09:00"), merged_at: at("10:30"), merge_commit_sha: "aaa", base: { ref: "next" }, title: "feat: a" }, // train 10 → 2 h
      // Merged before train 10 but not in it (train cut earlier): ships with train 11, not the first main merge after it.
      { number: 2, created_at: at("10:00"), merged_at: at("10:50"), merge_commit_sha: "bbb", base: { ref: "next" }, title: "fix: b" },
      { number: 3, created_at: at("12:00"), merged_at: at("13:00"), merge_commit_sha: "ddd", base: { ref: "main" }, title: "db: c" }, // straight to main → 1 h
      { number: 4, created_at: at("15:30"), merged_at: at("16:00"), merge_commit_sha: "eee", base: { ref: "next" }, title: "feat: d" }, // in no train yet
      { number: 10, created_at: at("10:50"), merged_at: at("11:00"), merge_commit_sha: "t10", base: { ref: "main" }, title: "Deploy train 11:00Z: next → main" },
    ];
    expect(leadTimes(prs, trains)).toEqual({
      times: [2 * H, 5 * H, H],
      shipped: [{ number: 1, train: 10, ms: 2 * H }, { number: 2, train: 11, ms: 5 * H }, { number: 3, train: null, ms: H }],
      pending: 1,
    });
  });

  const failed = (hhmm: string, done: string, coreSmokeFailed = true) => ({ event: "deployment_status", conclusion: "failure", created_at: at(hhmm), updated_at: at(done), coreSmokeFailed });
  const passed = (hhmm: string, done: string, event = "deployment_status") => ({ event, conclusion: "success", created_at: at(hhmm), updated_at: at(done) });

  it("rates change failures as core-smoke failures per production deploy, with any-job failures reported apart (#2796)", () => {
    const runs = [
      passed("10:00", "10:20"), failed("11:00", "11:20"), passed("12:00", "12:20"),
      failed("13:00", "13:25", false), // WS1 walk failed after a passing core smoke
      { event: "deployment_status", conclusion: "skipped", created_at: at("13:30") },
      { event: "deployment_status", conclusion: "cancelled", created_at: at("14:00") },
      { event: "workflow_dispatch", conclusion: "failure", created_at: at("15:00") },
      passed("03:30", "03:50", "schedule"),
    ];
    expect(changeFailureRate(runs)).toEqual({ deploys: 4, coreFailures: 1, rate: 0.25, anyFailures: 2, anyRate: 0.5 });
  });

  it("reports n/a, never 0%, when no production deploy was smoked (#2796)", () => {
    expect(changeFailureRate([{ event: "deployment_status", conclusion: "skipped", created_at: at("10:00") }]))
      .toEqual({ deploys: 0, coreFailures: 0, rate: null, anyFailures: 0, anyRate: null });
    expect(median([])).toBeNull();
    expect(p90([])).toBeNull();
    expect(formatMinutes(null, 0)).toBe("n/a (n=0)");
    expect(formatMinutes(90 * 60e3, 3)).toBe("90 min");
  });

  it("restores only on a passing smoke created after the failure finished (#2796)", () => {
    const runs = [
      failed("10:00", "10:30"),
      passed("10:10", "10:35"), // started while the failure was still running: doesn't restore
      failed("10:20", "10:45"), // same incident; the restore must start after this one finishes too
      passed("10:50", "11:10"), // restores: 10:00 → 11:10
      failed("12:00", "12:20"),
      passed("13:30", "13:50", "schedule"), // the daily smoke restores too: 12:00 → 13:50
      failed("18:00", "18:20"), // still open
    ];
    expect(timeToRestore(runs)).toEqual({ times: [70 * 60e3, 110 * 60e3], open: 1 });
  });

  it("counts each role's active hours as the distinct hours it posted in", () => {
    const posts = [
      { who: "Dev", t: Date.parse(at("10:05")) }, { who: "Dev", t: Date.parse(at("10:55")) }, { who: "Dev", t: Date.parse(at("12:10")) },
      { who: "QA", t: Date.parse(at("10:30")) }, { who: "?", t: Date.parse(at("11:00")) },
    ];
    expect(activeHours(posts)).toEqual({ Dev: 2, QA: 1 });
  });
});
