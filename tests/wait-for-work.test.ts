import { describe, expect, it } from "vitest";
import { linkedIssues, lowQueues, matchers, offTrack, roleCard, unsavedWork, waitingOnMe } from "../scripts/wait-for-work.mjs";

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
    expect(low).toEqual([{ role: "dev2", count: 1 }, { role: "devops", count: 0 }]);
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
