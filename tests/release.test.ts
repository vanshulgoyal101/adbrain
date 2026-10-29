import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { managementMigrationSql, migrationChecksum } from "../scripts/database-migrations.mjs";
import { changedLines, ctoApproval, ctoReviews, failingChecks, moneyPath, qaApproval, releaseMigrations, reviewVerdicts, smokeCounts, supersededBy, backupFresh, commitStatuses } from "../scripts/release.mjs";

const head = "c30aabaf55338d92d4f0ac9ca01eac027190aceb";
const comment = (body: string, createdAt: string) => ({ body, createdAt, url: `https://example.test/${createdAt}` });

describe("QA approval", () => {
  it("accepts QA's approval of the exact head and keeps its reviewed hashes", () => {
    const qa = qaApproval([
      comment("DevOps dry run again at c30aaba: release runs once QA approves.", "2026-10-23T12:49:05Z"),
      comment("**QA recheck of c30aaba: approved.**\n- Migration sha256 `40de9dc8ceec570e…`", "2026-10-23T12:56:35Z"),
    ], head);
    expect(qa.approved).toBe(true);
    expect(qa.text).toContain("40de9dc8");
  });

  it("ignores other roles' comments that mention QA and approval", () => {
    expect(qaApproval([comment("DevOps: ready to release once QA approves c30aaba.", "2026-10-23T12:49:05Z")], head).approved).toBe(false);
    expect(qaApproval([comment("CTO review of c30aaba: approved. QA rechecks next.", "2026-10-23T12:54:09Z")], head).approved).toBe(false);
  });

  it("requires the exact head and lets the latest QA verdict win", () => {
    expect(qaApproval([comment("QA approved PR #219 at 16dcfca.", "2026-10-23T12:30:00Z")], head).approved).toBe(false);
    expect(qaApproval([
      comment("QA approved c30aaba.", "2026-10-23T12:56:00Z"),
      comment("QA: c30aaba changes requested, P1 in observe.", "2026-10-23T13:05:00Z"),
    ], head).approved).toBe(false);
    expect(qaApproval([comment("QA: please approve c30aaba soon", "2026-10-23T12:56:00Z")], head).approved).toBe(false);
  });

  it("carries a QA approval of an earlier head with the same patch, not of a different one", () => {
    const same = (sha: string) => sha === "16dcfca";
    const approvedEarlier = [comment("QA approved 16dcfca. Migration sha256 `40de9dc8`.", "2026-10-23T12:30:00Z")];
    const carried = qaApproval(approvedEarlier, head, same);
    expect(carried.approved).toBe(true);
    expect(carried.text).toContain("40de9dc8");
    expect(qaApproval(approvedEarlier, head, () => false).approved).toBe(false);
    expect(qaApproval([...approvedEarlier, comment("QA: 16dcfca changes requested.", "2026-10-23T13:00:00Z")], head, same).approved).toBe(false);
    // A sha mentioned after the verdict sentence doesn't make the comment a verdict on it.
    expect(qaApproval([comment("QA approved 1234567. Earlier 16dcfca failed.", "2026-10-23T12:30:00Z")], head, same).approved).toBe(false);
  });

  it("accepts QA's other approval wordings and refuses their negations", () => {
    const verdict = (body: string) => qaApproval([comment(body, "2026-10-23T15:52:35Z")], head).approved;
    expect(verdict("**QA review of c30aaba (tenant boundary): fine to merge for #157, with one follow-up.**")).toBe(true);
    expect(verdict("QA → DevOps: PR #248 approved at c30aaba (details on the PR). Ready to ship.")).toBe(true);
    expect(verdict("QA: PR #217 is re-approved at the rebased head c30aaba; nothing changed versus 3917f32.")).toBe(true);
    expect(verdict("QA: ready at c30aaba (PR #256: money + migration, no auto-merge).")).toBe(false);
    expect(verdict("QA: ready to ship at c30aaba once you approve.")).toBe(false);
    expect(verdict("QA: c30aaba is approved if you agree with the hold logic.")).toBe(false);
    expect(verdict("QA: re-review at c30aaba; the SQL you approved is unchanged.")).toBe(false);
    expect(verdict("QA: live at d34d32d, ready for the re-measure. PR #248 (QA-approved c30aaba) was released.")).toBe(false);
    expect(verdict("QA: c30aaba is not fine to merge yet.")).toBe(false);
    expect(verdict("QA: please hold c30aaba; it conflicts with main.")).toBe(false);
    expect(verdict("QA verdict at c30aaba: **approved.** The tenant-boundary findings from my earlier review still hold.")).toBe(true);
    expect(verdict("QA: c30aaba approved but on hold until #370 lands.")).toBe(false);
    expect(verdict("QA: c30aaba approved; hold off the release until Monday.")).toBe(false);
  });
});

describe("verdicts posted as PR reviews (#423)", () => {
  const review = (body: string, submittedAt: string | null, state = "COMMENTED") => ({ body, state, submitted_at: submittedAt, html_url: `https://example.test/r/${submittedAt}` });

  it("reads review bodies like comments, skipping empty and pending reviews", () => {
    expect(reviewVerdicts([
      review("QA verdict at c30aaba: **approved.**", "2026-10-24T12:00:00Z"),
      review("", "2026-10-24T12:01:00Z", "APPROVED"),
      review("QA: draft", null, "PENDING"),
    ])).toEqual([{ body: "QA verdict at c30aaba: **approved.**", createdAt: "2026-10-24T12:00:00Z", url: "https://example.test/r/2026-10-24T12:00:00Z" }]);
  });

  it("lets a review approve, and a later comment still overrides it", () => {
    const fromReview = reviewVerdicts([review("QA verdict at c30aaba: **approved.** Migration abc.", "2026-10-24T12:00:00Z")]);
    expect(qaApproval(fromReview, head).approved).toBe(true);
    expect(qaApproval([...fromReview, comment("QA: c30aaba changes requested.", "2026-10-24T12:05:00Z")], head).approved).toBe(false);
    expect(ctoReviews(reviewVerdicts([review("CTO review of c30aaba: **approved**.", "2026-10-24T12:00:00Z")]))).toHaveLength(1);
  });
});

describe("verdicts are judged on their first sentence (#554)", () => {
  it("doesn't veto an approval for a negative word in a later sentence", () => {
    const cto = ctoReviews([comment("CTO review of c30aaba: **approved** (tenant). Migration sha256 37ac5598. Solaride's own number still works, so #499's next run isn't blocked.", "2026-10-25T10:01:13Z")]);
    expect(cto).toHaveLength(1);
    expect(cto[0].approved).toBe(true);
    expect(qaApproval([comment("QA verdict at c30aaba: **approved**. Migration sha256 abc. → Dev: please merge to next.", "2026-10-25T10:00:00Z")], head).approved).toBe(true);
  });

  it("still vetoes inside the verdict sentence", () => {
    expect(ctoReviews([comment("CTO review of c30aaba: **approved** but blocked on #533 landing first.", "2026-10-25T10:00:00Z")])[0].approved).toBe(false);
    expect(qaApproval([comment("QA verdict at c30aaba: **approved**, please hold until #533 lands.", "2026-10-25T10:00:00Z")], head).approved).toBe(false);
  });
});

describe("release inputs", () => {
  it("releases only added migrations, in filename order", () => {
    expect(releaseMigrations([
      { filename: "db/migrations/20261024_b.sql", status: "added" },
      { filename: "src/a.ts", status: "modified" },
      { filename: "db/migrations/20261024_a.sql", status: "added" },
    ])).toEqual(["db/migrations/20261024_a.sql", "db/migrations/20261024_b.sql"]);
    expect(() => releaseMigrations([{ filename: "db/migrations/20261022_x.sql", status: "modified" }])).toThrow(/immutable/);
  });

  it("uses the latest run of each required check", () => {
    const runs = [
      { name: "test", status: "completed", conclusion: "failure", completedAt: "2026-10-23T12:00:00Z" },
      { name: "test", status: "completed", conclusion: "success", completedAt: "2026-10-23T12:10:00Z" },
      { name: "core", status: "in_progress", conclusion: "", completedAt: "" },
    ];
    expect(failingChecks(["test", "core", "build"], runs)).toEqual(["core", "build"]);
  });

  it("reads the guard log like the guard prints it", () => {
    const log = [
      "smoke\tRead-only core smoke\t2026-10-23T13:43:10.26Z   if [ \"$rc\" -eq 124 ]; then echo \"FAIL smoke did not finish in 10 min\"; fi",
      "smoke\tRead-only core smoke\t2026-10-23T13:43:14.76Z PASS Sign in",
      "smoke\tRead-only core smoke\t2026-10-23T13:43:16.78Z PASS Dashboard",
    ].join("\n");
    expect(smokeCounts(log)).toEqual({ pass: 2, fail: 0 });
    const retried = ["2026-10-28T21:17:00.1Z PASS Sign in", "2026-10-28T21:18:44.1Z FAIL Prepare preflight: Sign in required",
      "2026-10-28T21:19:46.1Z PASS Sign in", "2026-10-28T21:20:06.1Z PASS Prepare preflight", "2026-10-28T21:20:38.1Z PASS Step 1"].join("\n");
    expect(smokeCounts(retried)).toEqual({ pass: 3, fail: 0 });
    expect(smokeCounts(`${retried}\n2026-10-28T21:21:00.1Z FAIL Step 2 LCP`)).toEqual({ pass: 3, fail: 1 });
    expect(supersededBy("2026-10-23T13:02:08.45Z Superseded: production serves newer d34d32d; skipping smoke for 4202350")).toBe("d34d32d");
    expect(supersededBy(log)).toBeNull();
  });
});

describe("CTO review (#259)", () => {
  // First lines of the real CTO comments on PR #247, #219, #234 and #256.
  const pr247 = [
    comment("CTO review of 6ee4a62 (only #221's own changes, diffed against #245's 789f071): **approved**, pending QA's delta recheck. It matches the CEO's controls on #221.", "2026-10-23T16:27:54Z"),
    comment("CTO review of 3bafc67: **approved.** The #221 changes match the patch I approved at 6ee4a62 exactly (`git patch-id` against main), and the migration is unchanged (sha256 8e4e57db).", "2026-10-23T16:38:10Z"),
  ];
  const head247 = "3bafc67cc3a7c5a30bab144c5bfc7056b4dc7362";
  const isHead = (head: string) => (sha: string) => head.startsWith(sha);

  it("approves PR #247 at 3bafc67 from the review that names it", () => {
    const cto = ctoApproval(ctoReviews(pr247), isHead(head247));
    expect(cto.approved).toBe(true);
    expect(cto.latest?.sha).toBe("3bafc67");
  });

  it("accepts an earlier head's approval only when its patch against main is the same", () => {
    const [only6ee] = pr247;
    expect(ctoApproval(ctoReviews([only6ee]), isHead(head247)).approved).toBe(false);
    expect(ctoApproval(ctoReviews([only6ee]), (sha: string) => isHead(head247)(sha) || sha === "6ee4a62").approved).toBe(true);
  });

  it("reads the head after an arrow and refuses conditional or non-approving reviews", () => {
    const reviews = ctoReviews([
      comment("CTO review of 16dcfca → c30aaba: **approved.** The only migration change is QA's P1 fix.", "2026-10-23T12:54:09Z"),
      comment("CTO review of bc45602: **approved once the failure proof is posted.**", "2026-10-23T13:19:22Z"),
      comment("CTO post-release review of c5d69ab (it shipped before my review): **sound, nothing to roll back.**", "2026-10-23T16:26:18Z"),
      comment("CTO technical review of PR #219 at 16dcfca. **Verdict: correct and fails closed.**", "2026-10-23T12:23:08Z"),
    ]);
    expect(reviews.map((r: { sha: string; approved: boolean }) => [r.sha, r.approved])).toEqual([["c30aaba", true], ["bc45602", false], ["c5d69ab", false]]);
    expect(ctoApproval(reviews, isHead(head)).approved).toBe(true);
  });

  it("reads a CTO re-review like a review", () => {
    const [review] = ctoReviews([comment("CTO re-review of 56e5af36 (migration sha256 58395f36…): **approved**. Matches the spec.", "2026-10-28T19:25:00Z")]);
    expect([review.sha, review.approved]).toEqual(["56e5af36", true]);
  });

  it("lets a later review of the same patch withdraw an approval", () => {
    const reviews = ctoReviews([...pr247, comment("CTO review of 3bafc67: **changes requested.** The settle window is off by one read.", "2026-10-23T17:00:00Z")]);
    expect(ctoApproval(reviews, isHead(head247)).approved).toBe(false);
  });

  it("treats payments, spend, activation and budget code as money", () => {
    expect(["src/lib/payments/customer-balance.ts", "src/app/api/payments/live/orders/route.ts", "src/app/api/cron/enforce-spend/route.ts",
      "src/lib/campaign/spend-enforce.ts", "src/lib/campaign/activation.ts", "src/lib/campaign/budget.ts", "src/lib/managed/spend-cap.ts"].every((p) => moneyPath.test(p))).toBe(true);
    expect(["src/lib/meta/client.ts", "src/lib/supabase/middleware.ts", "src/components/campaigns.tsx"].some((p) => moneyPath.test(p))).toBe(false);
  });
});

describe("Management API migration transaction", () => {
  const sql = "begin;\nset local lock_timeout = '5s';\ncreate function f() returns int language plpgsql as $$\nbegin\n  return 1;\nend;\n$$;\ncommit;\n";

  it("wraps the body once, guards the ledger and ends a dry run in rollback", () => {
    const dry = managementMigrationSql("20261024_x.sql", sql, { commit: false });
    expect(dry.startsWith("begin;\n")).toBe(true);
    expect(dry.endsWith("\nrollback;")).toBe(true);
    expect(dry).not.toMatch(/^commit;$/m);
    expect(dry).toContain("hashtextextended('adbrain:migrations', 0)");
    expect(dry).toContain(`values ('20261024_x.sql', '${migrationChecksum(sql)}')`);
    expect(managementMigrationSql("20261024_x.sql", sql, { commit: true }).endsWith("\ncommit;")).toBe(true);
  });

  it("refuses files that control their own transaction mid-file, and odd names", () => {
    expect(() => managementMigrationSql("20261024_x.sql", "begin;\ncreate table a();\ncommit;\ncreate table b();\ncommit;\n", { commit: false })).toThrow(/own transaction/);
    expect(() => managementMigrationSql("20261024_x.sql", "create table a();\nrollback;\n", { commit: false })).toThrow(/own transaction/);
    expect(() => managementMigrationSql("x'; drop table y; --.sql", sql, { commit: false })).toThrow(/filename/);
  });

  it("builds every migration in the repository with one begin and a final rollback", () => {
    for (const name of readdirSync("db/migrations").filter((file) => file.endsWith(".sql"))) {
      const dry = managementMigrationSql(name, readFileSync(`db/migrations/${name}`, "utf8"), { commit: false });
      const control = dry.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "").match(/^\s*(begin|commit|rollback)\s*;/gim);
      expect(control?.map((line) => line.trim()), name).toEqual(["begin;", "rollback;"]);
    }
  });
});

describe("Reviewer verdicts (#575)", () => {
  it("count like the CTO's for money and migration PRs", () => {
    const r = ctoReviews([{ body: "Reviewer review of c30aaba: **approved**. Migration sha256 40de9dc8.", createdAt: "2026-10-25T11:00:00Z", url: "u" }]);
    expect(r).toHaveLength(1);
    expect(ctoApproval(r, (sha: string) => sha === "c30aaba").approved).toBe(true);
    expect(ctoReviews([{ body: "Dev: Reviewer review of c30aaba: **approved**.", createdAt: "2026-10-25T11:00:00Z", url: "u" }])).toHaveLength(0);
  });

  it.each([
    ["Reviewer: review of f784739f36d8e2957ccd0497f349c32fe4431a48: **approved** (core-approval).", "f784739f36d8e2957ccd0497f349c32fe4431a48"],
    ["Reviewer: review of 1362ef78fd50276525d8165934d56273e37bf975: **approved** (core-approval).", "1362ef78fd50276525d8165934d56273e37bf975"],
    ["CTO: re-review of 1111111 → c30aaba: **approved**.", "c30aaba"],
  ])("recognizes the required signed verdict %s (#2054)", (body, sha) => {
    const reviews = ctoReviews([comment(body, "2026-10-29T06:00:00Z")]);
    expect(reviews).toMatchObject([{ sha, approved: true }]);
    expect(ctoApproval(reviews, (candidate: string) => candidate === sha).approved).toBe(true);
  });

  it("lets a signed withdrawal supersede a legacy approval and vice versa", () => {
    for (const [first, last] of [
      ["Reviewer review of c30aaba: **approved**.", "Reviewer: review of c30aaba: **changes requested**."],
      ["Reviewer: review of c30aaba: **approved**.", "Reviewer review of c30aaba: **changes requested**."],
    ]) {
      const reviews = ctoReviews([
        comment(first, "2026-10-29T06:00:00Z"),
        comment(last, "2026-10-29T06:01:00Z"),
      ]);
      expect(ctoApproval(reviews, (sha: string) => sha === "c30aaba").approved).toBe(false);
    }
  });

  it.each([
    "Reviewer: review of c30aaba: **not approved**.",
    "Reviewer: review of c30aaba: **approved** but blocked.",
    "Reviewer: review of c30aaba: not approved.",
    "Reviewer: review of c30aaba: ready for a verdict.",
    "CTO: → Reviewer: review of c30aaba: **approved**.",
    "Dev: Reviewer: review of c30aaba: **approved**.",
  ])("does not turn a signed rejection, handoff or non-verdict into approval: %s", (body) => {
    expect(ctoApproval(ctoReviews([comment(body, "2026-10-29T06:00:00Z")]), (sha: string) => sha === "c30aaba").approved).toBe(false);
  });
});

describe("same changes despite moved context (#567)", () => {
  const diff = (at: number, ctx: string) => `diff --git a/x.sql b/x.sql\n--- a/x.sql\n+++ b/x.sql\n@@ -${at},3 +${at},4 @@\n ${ctx}\n+create table lease (id int);\n-drop view v;\n`;
  it("matches edits whose surrounding lines moved, not different edits or empty diffs", () => {
    expect(changedLines(diff(10, "a"))).toBe(changedLines(diff(42, "b")));
    expect(changedLines(diff(10, "a"))).not.toBe(changedLines(diff(10, "a").replace("lease", "leases")));
    expect(changedLines(diff(10, "a"))).not.toBe(changedLines(diff(10, "a").replace("+create table lease (id int);\n-drop view v;", "-drop view v;\n+create table lease (id int);")));
    expect(changedLines("")).toBe("");
  });
});

describe("fresh backup before a migration (#884)", () => {
  const now = Date.parse("2026-10-27T11:00:00Z");
  it("needs a successful db-backup run that finished within the hour", () => {
    expect(backupFresh({ status: "completed", conclusion: "success", updatedAt: "2026-10-27T10:05:00Z" }, now)).toBe(true);
    expect(backupFresh({ status: "completed", conclusion: "success", updatedAt: "2026-10-27T09:59:00Z" }, now)).toBe(false);
    expect(backupFresh({ status: "completed", conclusion: "failure", updatedAt: "2026-10-27T10:55:00Z" }, now)).toBe(false);
    expect(backupFresh({ status: "in_progress", conclusion: "", updatedAt: "2026-10-27T10:59:00Z" }, now)).toBe(false);
    expect(backupFresh(undefined, now)).toBe(false);
  });
});

describe("required commit statuses (#926 core-approval)", () => {
  it("counts the newest status per context like a check run", () => {
    const statuses = commitStatuses([
      { context: "core-approval", state: "success", created_at: "2026-10-27T11:48:57Z" },
      { context: "core-approval", state: "pending", created_at: "2026-10-27T11:11:04Z" },
    ]);
    const runs = [{ name: "build", status: "completed", conclusion: "success", completedAt: "2026-10-27T11:00:00Z" }];
    expect(failingChecks(["build", "core-approval"], [...runs, ...statuses])).toEqual([]);
    expect(failingChecks(["core-approval"], commitStatuses([{ context: "core-approval", state: "pending", created_at: "2026-10-27T12:00:00Z" }]))).toEqual(["core-approval"]);
    expect(failingChecks(["core-approval"], runs)).toEqual(["core-approval"]);
  });
});
