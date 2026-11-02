import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportPlan, loadPg, lostData } from "../scripts/db-export.mjs";

describe("db export and restore drill (#883)", () => {
  it("exports Supabase's auth and storage rows first, then every table", () => {
    expect(exportPlan([{ schema: "public", table: "businesses" }]).map((t) => `${t.schema}.${t.table}:${t.columns}`)).toEqual([
      "auth.users:id, email", "storage.buckets:*", "storage.objects:id, bucket_id, name", "public.businesses:*",
    ]);
  });

  it("fails only on data the restore lost", () => {
    expect(lostData({ table: "public.leads", exported: 2, restored: 1, note: "" })).toBe(true);
    expect(lostData({ table: "public.leads", exported: 2, restored: 2, note: "columns only in production: phone_hash" })).toBe(true);
    expect(lostData({ table: "public.meta_old", exported: 3, restored: 0, note: "table not in git schema" })).toBe(true);
    expect(lostData({ table: "public.meta_old", exported: 0, restored: 0, note: "table not in git schema" })).toBe(false);
    expect(lostData({ table: "private.schema_migrations", exported: 44, restored: 0, note: "table not in git schema" })).toBe(false);
    expect(lostData({ table: "storage.buckets", exported: 2, restored: 2, note: "columns only in production: versioning_status" })).toBe(false);
    expect(lostData({ table: "public.businesses", exported: 8, restored: 8, note: "" })).toBe(false);
  });

  // #2537: the supervisor's worktree lost its node_modules and three nightly drills failed on "Cannot find package 'pg'".
  it("fills a checkout that has no node_modules from wt.sh's lockfile cache, then loads pg", async () => {
    const work = mkdtempSync(join(tmpdir(), "pg-cache-"));
    const cache = join(work, "cache");
    try {
      const fakePg = (name: string, marker: string) => {
        mkdirSync(join(cache, name, "pg"), { recursive: true });
        writeFileSync(join(cache, name, "pg", "package.json"), "{}");
        writeFileSync(join(cache, name, "pg", "index.json"), JSON.stringify({ marker }));
      };
      fakePg("aaa", "other lockfile");
      fakePg("bbb", "this lockfile");
      const loader = (target: string) => async () => {
        try {
          return { default: JSON.parse(readFileSync(join(target, "pg", "index.json"), "utf8")) };
        } catch {
          throw Object.assign(new Error("Cannot find package 'pg'"), { code: "ERR_MODULE_NOT_FOUND" });
        }
      };
      const load = (name: string, lockHash: string, cacheRoot = cache) => {
        const target = join(work, name, "node_modules");
        mkdirSync(join(work, name));
        return loadPg({ importLocal: loader(target), target, cacheRoot, lockHash });
      };
      expect(await load("a", "bbb")).toEqual({ marker: "this lockfile" });
      expect(await load("b", "gone")).toHaveProperty("marker");
      await expect(load("c", "bbb", join(work, "none"))).rejects.toThrow(/wt\.sh/);
      mkdirSync(join(work, "d", "node_modules"), { recursive: true });
      await expect(loadPg({ importLocal: loader(join(work, "d", "node_modules")), target: join(work, "d", "node_modules"), cacheRoot: cache, lockHash: "bbb" }))
        .rejects.toThrow(/Cannot find package/);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  // #1113: launchd gives the supervisor no locale, and macOS Postgres then dies with
  // "postmaster became multithreaded during startup" unless LC_ALL is set.
  it.each(["db-export.mjs", "restore-drill.mjs", "check-meta-connect-db.mjs"])("%s starts its throwaway Postgres with LC_ALL set", (file) => {
    const starts = readFileSync(join("scripts", file), "utf8").split("\n").filter((line) => line.includes('"pg_ctl"') && line.includes('"start"'));
    expect(starts.length).toBeGreaterThan(0);
    for (const line of starts) expect(line).toMatch(/LC_ALL: "C"/);
  });
});
