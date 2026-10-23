import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { managementMigrationSql, migrationChecksum } from "../scripts/database-migrations.mjs";
import { failingChecks, qaApproval, releaseMigrations, smokeCounts, supersededBy } from "../scripts/release.mjs";

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
    expect(supersededBy("2026-10-23T13:02:08.45Z Superseded: production serves newer d34d32d; skipping smoke for 4202350")).toBe("d34d32d");
    expect(supersededBy(log)).toBeNull();
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
