import { describe, expect, it } from "vitest";
import { readyPool, boardRow, systemicFailures, snoozedUntil, latestWord, linkedIssues, lowQueues, matchers, offTrack, roleCard, unsavedWork, waitingOnMe } from "../scripts/wait-for-work.mjs";

describe("PR reviews count as the latest word (#423)", () => {
  it("picks a review posted after the last comment, and ignores empty approvals", () => {
    const comments = [{ body: "DevOps: → CTO: please review", created_at: "2026-10-24T16:40:00Z", html_url: "c1" }];
    const reviews = [
      { body: "", submitted_at: "2026-10-24T16:50:00Z", html_url: "r0" },
      { body: "CTO review of e22d633: approved. → DevOps: release", submitted_at: "2026-10-24T16:45:00Z", html_url: "r1" },
    ];
    expect(latestWord(comments, reviews)).toEqual({ body: "CTO review of e22d633: approved. → DevOps: release", at: "2026-10-24T16:45:00Z", url: "r1" });
    expect(waitingOnMe(latestWord(comments, reviews)!.body, matchers("cto"))).toBe(false);
    expect(waitingOnMe(latestWord(comments, reviews)!.body, matchers("devops"))).toBe(true);
    expect(latestWord([], [])).toBeNull();
  });

  it("skips the advisory AI review bot, so a push doesn't wake the PR owner (#587)", () => {
    const comments = [
      { body: "DevOps: resolved at 07b2fec. → QA: please post a verdict", created_at: "2026-10-25T17:00:00Z", html_url: "c1" },
      { body: "<!-- ai-review -->\n**AI review (advisory, not a verdict)**", created_at: "2026-10-25T17:05:00Z", html_url: "c2" },
    ];
    expect(latestWord(comments, [])?.url).toBe("c1");
    expect(waitingOnMe(latestWord(comments, [])!.body, matchers("devops"))).toBe(false);
  });

  it("skips the daily core scoreboard, so it doesn't wake every role on #681", () => {
    const comments = [
      { body: "QA: walk done. → Dev: #692", created_at: "2026-10-26T03:00:00Z", html_url: "c1" },
      { body: "<!-- core-scoreboard -->\nDevOps (scheduled): **Core scoreboard** (production, 24 h)", created_at: "2026-10-26T03:37:00Z", html_url: "c2" },
    ];
    expect(latestWord(comments, [])?.url).toBe("c1");
  });
});

describe("restart-proof start (#384)", () => {
  const md = [
    "| Role | Owns | Hands off |",
    "| --- | --- | --- |",
    "| **Dev** | Create and its tests | Migrations, config |",
    "| **Dev 2** | Editing ads | Same as Dev |",
  ].join("\n");

  it("reads the role card from the docs and resolves 'Same as'", () => {
    expect(roleCard(md, "dev")).toBe("Dev owns: Create and its tests. Hand off: Migrations, config");
    expect(roleCard(md, "dev2")).toBe("Dev 2 owns: Editing ads. Hand off: Migrations, config");
    expect(roleCard(md, "qa")).toBeNull();
  });

  it("lists only your worktrees that hold uncommitted or unpushed work", () => {
    const trees = [
      { path: "/x/adbrain-wt/281", branch: "fix/281-claim", dirty: 2, ahead: 0 },
      { path: "/x/adbrain-wt/dev2-282", branch: "fix/282-confirm", dirty: 0, ahead: 1 },
      { path: "/x/adbrain-wt/371", branch: "dev/371-results", dirty: 0, ahead: 0 },
    ];
    expect(unsavedWork(trees, new Set([281, 371]))).toEqual([trees[0]]);
  });
});

describe("CTO on-track check", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");
  const at = (min: number) => new Date(now - min * 60_000).toISOString();
  const issue = (...labels: string[]) => ({ labels: labels.map((name) => ({ name })) });

  it("flags workers with queued work and no recent signed comment, and stale PRs", () => {
    const result = offTrack({
      now,
      issues: [issue("owner:dev"), issue("owner:dev2"), issue("owner:qa")],
      comments: [
        { body: "Dev: PR #365 is ready", created_at: at(20) },
        { body: "CTO: → Dev 2: yours", created_at: at(5) },
        { body: "Dev 2: built in #357", created_at: at(120) },
        { body: "QA verdict at f16e852: approved", created_at: at(30) },
      ],
      prs: [
        { number: 357, title: "#334 Advantage+", updated_at: at(75), draft: false },
        { number: 365, title: "#335 enquiries", updated_at: at(10), draft: false },
      ],
    });
    expect(result.quiet).toEqual([{ role: "dev2", minutes: 120 }]);
    expect(result.stale).toEqual([{ number: 357, title: "#334 Advantage+", minutes: 75 }]);
  });
});

describe("CTO queue watch", () => {
  const issue = (...labels: string[]) => ({ labels: labels.map((name) => ({ name })) });

  it("flags workers with fewer than 2 actionable items, ignoring parked ones", () => {
    const low = lowQueues([
      issue("core", "owner:dev"), issue("owner:dev"),
      issue("owner:dev2"), issue("owner:dev2", "waiting-owner"),
      issue("owner:dev3"), issue("owner:dev3"), issue("owner:dev3", "decision"),
      issue("owner:qa", "owner:dev"), issue("owner:qa"),
    ]);
    expect(low).toEqual([{ role: "dev2", count: 1 }, { role: "dev4", count: 0 }, { role: "qa2", count: 0 }, { role: "cpo", count: 0 }]);
  });

  it("counts the worker's lane pool as supply, so a reactive Reviewer with pool audits isn't low", () => {
    const pool = (lane: string) => ({ labels: [{ name: "core" }, { name: "ready" }, { name: `lane:${lane}` }] });
    const low = lowQueues([issue("owner:reviewer"), pool("review"), pool("dev")]).map((l) => l.role);
    expect(low).not.toContain("reviewer");
    expect(low).toContain("dev4");
    expect(low).toContain("qa");
  });
});

describe("wait-for-work handoffs", () => {
  const devops = matchers("devops");
  const dev = matchers("dev");

  it("treats a PR whose title names an owned issue as linked (#309 → #274)", () => {
    expect(linkedIssues("#274 Reliable scheduler: Supabase pg_cron runs enforce-spend")).toEqual([274]);
    expect(linkedIssues("chore(deps): latest dependencies")).toEqual([]);
  });

  it("wakes the owner when someone else spoke last without handing off elsewhere", () => {
    expect(waitingOnMe("QA verdict at d44e9c4: **approved**. Migration sha256 unchanged.", devops)).toBe(true);
    expect(waitingOnMe(null, devops)).toBe(true);
  });

  it("wakes the owner when addressed, even alongside another role", () => {
    expect(waitingOnMe("CTO review: **approved**. → DevOps: release once QA names d44e9c4.", devops)).toBe(true);
  });

  it("stays quiet when the last word is the owner's own or a handoff to someone else", () => {
    expect(waitingOnMe("DevOps: → QA: ready at adbc563.", devops)).toBe(false);
    expect(waitingOnMe("QA: approved at e1f423c. → CTO: review (tenant boundary).", devops)).toBe(false);
  });

  it("resumes an item whose last word is your own progress note without a handoff", () => {
    expect(waitingOnMe("Dev 2: #537 is merged; #538 next.", matchers("dev2"))).toBe(true);
    expect(waitingOnMe("Dev 2: ready at e34663c. → QA: review the tenant check.", matchers("dev2"))).toBe(false);
  });

  it("ignores items parked on the owner or outside the team", () => {
    expect(waitingOnMe("CEO: please submit", devops, ["core", "waiting-owner"])).toBe(false);
  });

  it("keeps Dev distinct from Dev 2, Dev 3 and DevOps", () => {
    expect(dev.writtenByMe("Dev 2: slice 3 is finished")).toBe(false);
    expect(waitingOnMe("CTO: → Dev 2: yours now.", dev)).toBe(false);
    expect(waitingOnMe("CTO: → DevOps: clear the claim.", dev)).toBe(false);
    expect(waitingOnMe("CTO: → Dev: yours, queue #1.", dev)).toBe(true);
  });
});

describe("team board row", () => {
  const board = "## Worker queues (in order)\n\n| Worker | Work, in order |\n| --- | --- |\n| Everyone | When idle: wait. |\n| Dev | 1. #522. 2. #525. |\n| Dev 2 | 1. [#521](https://x/521) provisioning. |\n";
  it("returns the worker's own row, not a prefix match, plus the Everyone row", () => {
    expect(boardRow(board, "dev")).toBe("Everyone: When idle: wait.\nDev: 1. #522. 2. #525.");
    expect(boardRow(board, "dev2")).toBe("Everyone: When idle: wait.\nDev 2: 1. [#521](https://x/521) provisioning.");
    expect(boardRow(board, "qa")).toBe("Everyone: When idle: wait.");
    expect(boardRow("no table", "dev")).toBeNull();
    expect(boardRow("| QA | review |\n| QA 2 | walk |", "qa2")).toBe("QA 2: walk");
  });
});

describe("Reviewer and QA 2 roles (#575)", () => {
  it("keeps QA distinct from QA 2, and routes Reviewer handoffs", () => {
    const qa = matchers("qa");
    const qa2 = matchers("qa2");
    expect(qa.writtenByMe("QA 2: #157 read at 10:00Z")).toBe(false);
    expect(qa2.writtenByMe("QA 2: #157 read at 10:00Z")).toBe(true);
    expect(waitingOnMe("CTO: → QA 2: walk the run.", qa)).toBe(false);
    expect(waitingOnMe("CTO: → QA 2: walk the run.", qa2)).toBe(true);
    expect(waitingOnMe("Dev: → QA: red test please.", qa2)).toBe(false);
    expect(waitingOnMe("DevOps: → Reviewer: review of abc1234 please.", matchers("reviewer"))).toBe(true);
  });
  it("counts their queues", () => {
    const low = lowQueues([{ labels: [{ name: "owner:qa2" }] }, { labels: [{ name: "owner:reviewer" }] }]).map((x) => x.role);
    expect(low).toContain("qa2");
    expect(low).not.toContain("reviewer"); // self-sourcing (#573)
  });
});

describe("scheduled checks: Next read <time> (QA 2, #575)", () => {
  const qa2 = matchers("qa2");
  const body = "QA 2: read at 10:57Z: safe. Next read 2026-10-25T16:00Z; final report after Oct 26 14:24Z.";
  it("keeps your own scheduled item quiet until its time, then wakes you", () => {
    expect(snoozedUntil(body)).toBe(Date.parse("2026-10-25T16:00Z"));
    expect(waitingOnMe(body, qa2, [], Date.parse("2026-10-25T11:00Z"))).toBe(false);
    expect(waitingOnMe(body, qa2, [], Date.parse("2026-10-25T16:01Z"))).toBe(true);
  });
  it("ignores the marker in someone else's comment, and unparseable times", () => {
    expect(waitingOnMe("Dev 3: → QA 2: gates please. Next read 2026-10-25T16:00Z.", qa2, [], Date.parse("2026-10-25T11:00Z"))).toBe(true);
    expect(snoozedUntil("QA 2: Next read ~16:00Z")).toBeNull();
    expect(snoozedUntil("QA 2: next check 2026-10-26 14:24Z")).toBe(Date.parse("2026-10-26T14:24Z"));
  });
});

describe("ready pool (#573)", () => {
  const issue = (number: number, ...labels: string[]) => ({ number, labels: labels.map((name) => ({ name })) });
  const pool = [
    issue(10, "ready", "lane:dev"),
    issue(11, "ready", "lane:dev", "core"),
    issue(12, "ready", "lane:dev", "owner:dev2"),
    issue(13, "ready", "lane:qa"),
    issue(14, "ready", "lane:dev", "blocked"),
    issue(15, "lane:dev"),
  ];
  it("offers the lane's unclaimed items, core first, to every role in the lane", () => {
    expect(readyPool(pool, "dev3").map((i) => i.number)).toEqual([11, 10]);
    expect(readyPool(pool, "qa2").map((i) => i.number)).toEqual([13]);
    expect(readyPool(pool, "devops")).toEqual([]);
    expect(readyPool(pool, "cto")).toEqual([]);
  });
});

describe("Dev 4 role", () => {
  it("keeps Dev distinct from Dev 4, and routes Dev 4 handoffs", () => {
    const dev = matchers("dev");
    const dev4 = matchers("dev4");
    expect(dev.writtenByMe("Dev 4: Review step plan")).toBe(false);
    expect(dev4.writtenByMe("Dev 4: Review step plan")).toBe(true);
    expect(waitingOnMe("CTO: → Dev 4: take #688.", dev)).toBe(false);
    expect(waitingOnMe("CTO: → Dev 4: take #688.", dev4)).toBe(true);
  });
  it("counts Dev 4's queue", () => {
    expect(lowQueues([]).map((x) => x.role)).toContain("dev4");
  });
});

describe("systemic CI failures (CTO auto-track)", () => {
  const run = (name: string, branch: string, conclusion = "failure", event = "pull_request") => ({ name, head_branch: branch, conclusion, event, html_url: `u-${branch}` });
  it("flags one workflow failing on 2+ PR branches, not a single PR's red run or push runs", () => {
    const lines = systemicFailures([
      run("Core approval", "dev3/701"), run("Core approval", "designer/847"), run("Core approval", "dev3/701"),
      run("CI", "dev2/773"), run("CI", "next", "failure", "push"), run("CI", "x", "success"),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^CI systemic: Core approval failed on 2 PR branches \(dev3\/701, designer\/847\)/);
  });
});
