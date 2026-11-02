import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportPlan, exportRows, insertFailure, loadPg, lostData, pageQuery } from "../scripts/db-export.mjs";

describe("db export and restore drill (#883)", () => {
  it("exports Supabase's auth and storage rows first, then every table", () => {
    expect(exportPlan([{ schema: "public", table: "businesses", key: ["id"] }]).map((t) => `${t.schema}.${t.table}:${t.columns}:${t.key}`)).toEqual([
      "auth.users:id, email:id", "storage.buckets:*:id", "storage.objects:id, bucket_id, name:id", "public.businesses:*:id",
    ]);
  });

  // #2537: `order by ctid offset` across separate queries returned an updated lead_sync_runs row twice (and lost
  // another), so the drill's insert hit the primary key and exited 1. Keyset paging on the primary key can't.
  it("pages a keyed table after the last row's primary key, not by ctid offset", () => {
    const target = { schema: "public", table: "lead_sync_runs", columns: "*", key: ["id"] };
    const first = pageQuery(target, { size: 2000 });
    expect(first).not.toMatch(/ctid|offset/i);
    expect(first).toMatch(/order by t\."id" limit 2000/);
    expect(first).not.toMatch(/where/);
    const next = pageQuery({ ...target, key: ["business_id", "meta_lead_hash"] }, { size: 2000, after: { business_id: "b", meta_lead_hash: "it's" } });
    expect(next).toContain(`where (t."business_id", t."meta_lead_hash") > (select k."business_id", k."meta_lead_hash" from json_populate_record(null::"public"."lead_sync_runs", '{"business_id":"b","meta_lead_hash":"it''s"}'::json) k)`);
  });

  it("keeps ctid paging only for a table with no primary key", () => {
    expect(pageQuery({ schema: "public", table: "rate_limit_hits", columns: "*", key: [] }, { size: 2000, offset: 2000 }))
      .toMatch(/order by ctid offset 2000 limit 2000/);
  });

  it("walks keyed pages until a short page, passing only the last row's key", async () => {
    const seen: (Record<string, unknown> | undefined)[] = [];
    const pages = [[{ id: 1, v: "a" }, { id: 2, v: "b" }], [{ id: 3, v: "c" }, { id: 4, v: "d" }], [{ id: 5, v: "e" }]];
    const rows = await exportRows({ schema: "public", table: "x", columns: "*", key: ["id"] }, async (_sql: string, after?: Record<string, unknown>) => {
      seen.push(after);
      return pages.shift() ?? [];
    }, 2);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect(seen).toEqual([undefined, { id: 2 }, { id: 4 }]);
  });

  // #2537: the failure was sealed in the encrypted archive with nothing safe outside it. The drill now names the table
  // and Postgres's code and constraint, never the message or DETAIL, which can quote a customer's row.
  it("describes a failed insert by code and constraint only", () => {
    const error = Object.assign(new Error('invalid input syntax for type uuid: "someone@example.com"'), { code: "22P02", constraint: undefined, column: "owner_id" });
    expect(insertFailure(error)).toBe("insert failed: 22P02 column owner_id");
    expect(insertFailure(Object.assign(new Error("duplicate key value"), { code: "23505", constraint: "lead_sync_runs_pkey" })))
      .toBe("insert failed: 23505 lead_sync_runs_pkey");
    expect(insertFailure(new Error("boom"))).toBe("insert failed: unknown");
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
