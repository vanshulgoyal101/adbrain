import { describe, expect, it } from "vitest";
import { activeHours, changeFailureRate, collectWorkflowRuns, deployFrequency, formatMinutes, isMetricPR, leadTimes, median, p90, productionGuardEvidence, roleForPost, rolesFromOwnerLabels, rolesMentionedInHandoff, timeToRestore, verifiedLiveShas } from "../scripts/lib/team-metrics.mjs";

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
      { number: 10, merged_at: at("11:00"), shas: ["aaa"], verified: true },
      { number: 11, merged_at: at("15:00"), shas: ["bbb", "ccc"], verified: false },
    ];
    const prs = [
      { number: 1, created_at: at("09:00"), merged_at: at("10:30"), merge_commit_sha: "aaa", base: { ref: "next" }, title: "feat: a" }, // train 10 → 2 h
      // Merged before train 10 but not in it (train cut earlier): ships with train 11, not the first main merge after it.
      { number: 2, created_at: at("10:00"), merged_at: at("10:50"), merge_commit_sha: "bbb", base: { ref: "next" }, title: "fix: b" },
      { number: 3, created_at: at("12:00"), merged_at: at("13:00"), merge_commit_sha: "ddd", base: { ref: "main" }, title: "db: c" }, // straight to main → 1 h
      { number: 4, created_at: at("15:30"), merged_at: at("16:00"), merge_commit_sha: "eee", base: { ref: "next" }, title: "feat: d" }, // in no train yet
      { number: 5, created_at: at("16:00"), merged_at: at("17:00"), merge_commit_sha: "fff", base: { ref: "main" }, title: "fix: e" }, // main merge not verified live
      { number: 10, created_at: at("10:50"), merged_at: at("11:00"), merge_commit_sha: "t10", base: { ref: "main" }, title: "Deploy train 11:00Z: next → main" },
    ];
    expect(leadTimes(prs, trains, new Set(["ddd"]))).toEqual({
      times: [2 * H, H],
      shipped: [{ number: 1, train: 10, ms: 2 * H }, { number: 3, train: null, ms: H }],
      pending: 3,
    });
  });

  it("verifies live SHAs only after smoke and serving pass without a rollback (#2796)", () => {
    const runs = [
      { head_sha: "live", coreSmokePassed: true, created_at: at("10:00") },
      { head_sha: "ws1-only", coreSmokePassed: true, created_at: at("10:00") },
      { head_sha: "domain-failed", coreSmokePassed: true, servedDomainFailed: true, created_at: at("10:00") },
      { head_sha: "rolled-back", coreSmokePassed: true, created_at: at("10:00") },
      { head_sha: "smoke-failed", coreSmokeFailed: true, created_at: at("10:00") },
      { head_sha: "rolled-back", rolledBack: true, created_at: at("11:00") },
    ];
    expect([...verifiedLiveShas(runs)].sort()).toEqual(["live", "ws1-only"]);
  });

  it("fails explicitly when a guard result has no core-smoke step (#2796)", () => {
    expect(() => productionGuardEvidence([{ steps: [{ name: "WS1 first-timer walk", conclusion: "failure" }] }]))
      .toThrow("Production guard run is missing the Read-only core smoke step");
  });

  it("excludes train-sync and bot PRs from change lead time (#2796)", () => {
    const prs = [
      { title: "fix: user-facing bug", user: { login: "vanshulgoyal101", type: "User" } },
      { title: "Train sync: main → next", user: { login: "vanshulgoyal101", type: "User" } },
      { title: "chore: update dependency", user: { login: "dependabot[bot]", type: "Bot" } },
      { title: "Deploy train 12:00Z: next → main", user: { login: "vanshulgoyal101", type: "User" } },
    ];
    expect(prs.filter(isMetricPR)).toEqual([prs[0]]);
  });

  it("collects each workflow's full paginated run list instead of the global first 1,000 (#2796)", () => {
    const workflows = [{ id: 1, name: "CI" }, { id: 2, name: "Scheduled jobs" }];
    const since = "2026-11-05T00:00:00.000Z";
    const until = "2026-11-06T00:00:00.000Z";
    const runs = collectWorkflowRuns(workflows, (id: number) => ({
      totalCount: id === 1 ? 1_001 : 1,
      runs: id === 1
        ? Array.from({ length: 1_001 }, (_, index) => ({ id: index }))
        : [{ id: 1_001 }],
    }), since, until);
    expect(runs).toHaveLength(1_002);
    expect(runs[0].workflow).toBe("CI");
    expect(runs[1_001]).toEqual({ id: 1_001, workflow: "Scheduled jobs" });
  });

  it("splits a workflow window when Actions caps its runs at 1,000 (#2796)", () => {
    const workflows = [{ id: 1, name: "Busy" }, { id: 2, name: "Other" }];
    const since = "2026-11-05T00:00:00.000Z";
    const until = "2026-11-06T00:00:00.000Z";
    const reads: Array<[number, string, string]> = [];
    const runs = collectWorkflowRuns(workflows, (id: number, from: string, to: string) => {
      reads.push([id, from, to]);
      if (id === 2) return { totalCount: 1, runs: [{ id: 2_000 }] };
      if (from === since && to === until) {
        return { totalCount: 1_001, runs: Array.from({ length: 1_000 }, (_, index) => ({ id: index })) };
      }
      const start = from === since ? 0 : 501;
      const end = from === since ? 501 : 1_001;
      return { totalCount: end - start, runs: Array.from({ length: end - start }, (_, index) => ({ id: start + index })) };
    }, since, until);
    expect(runs).toHaveLength(1_002);
    expect(new Set(runs.map((run: { id: number }) => run.id)).size).toBe(1_002);
    expect(reads).toHaveLength(4);
  });

  it("uses repository owner labels to recognize every signed role", () => {
    const roles = rolesFromOwnerLabels([
      "owner:dev", "owner:dev4", "owner:qa2", "owner:devops3", "owner:cpo", "core",
    ]);
    expect(roles).toEqual(expect.arrayContaining(["Dev", "Dev 4", "QA 2", "DevOps 3", "CPO"]));
    expect(roleForPost("Dev 4: shipped the screen", roles)).toBe("Dev 4");
    expect(rolesMentionedInHandoff("→ Dev 4: ready", roles)).toEqual(["Dev 4"]);
    expect(rolesMentionedInHandoff("→ Dev: ready", roles)).toEqual(["Dev"]);
  });

  const failed = (hhmm: string, done: string, coreSmokeFailed = true) => ({ source: "Production guard", event: "deployment_status", conclusion: "failure", created_at: at(hhmm), updated_at: at(done), coreSmokeFailed });
  const passed = (hhmm: string, done: string, event = "deployment_status") => ({ source: "Production guard", event, conclusion: "success", created_at: at(hhmm), updated_at: at(done), coreSmokePassed: true });

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

  it("keeps an incident open until every failing production check recovers (#2796)", () => {
    const run = (source: string, start: string, end: string, conclusion: string, event = "schedule", extra = {}) => ({
      source, event, conclusion, created_at: at(start), updated_at: at(end), ...extra,
    });
    const runs = [
      run("Create smoke", "10:00", "10:05", "failure"),
      run("Scheduled jobs", "10:10", "10:15", "failure", "workflow_dispatch"),
      run("Production guard", "10:20", "10:25", "failure", "deployment_status", { servedDomainFailed: true }),
      run("Create smoke", "10:02", "10:30", "success"), // overlaps the failure and is not recovery
      run("Create smoke", "10:40", "10:45", "success"),
      run("Scheduled jobs", "10:50", "11:00", "success", "workflow_dispatch"),
      run("Production guard", "11:05", "11:30", "failure", "deployment_status", { coreSmokePassed: true }), // WS1 failed; service recovered
    ];
    expect(timeToRestore(runs)).toEqual({ times: [90 * 60e3], open: 0 });
  });

  it("uses the arithmetic mean for an even-sized median sample (#2796)", () => {
    expect(median([31 * 60e3, 45 * 60e3])).toBe(38 * 60e3);
  });

  it("counts each role's active hours as the distinct hours it posted in", () => {
    const posts = [
      { who: "Dev", t: Date.parse(at("10:05")) }, { who: "Dev", t: Date.parse(at("10:55")) }, { who: "Dev", t: Date.parse(at("12:10")) },
      { who: "QA", t: Date.parse(at("10:30")) }, { who: "?", t: Date.parse(at("11:00")) },
    ];
    expect(activeHours(posts)).toEqual({ Dev: 2, QA: 1 });
  });
});
