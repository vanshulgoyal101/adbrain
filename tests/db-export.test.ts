import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportPlan, lostData } from "../scripts/db-export.mjs";

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

  // #1113: launchd gives the supervisor no locale, and macOS Postgres then dies with
  // "postmaster became multithreaded during startup" unless LC_ALL is set.
  it.each(["db-export.mjs", "restore-drill.mjs", "check-meta-connect-db.mjs"])("%s starts its throwaway Postgres with LC_ALL set", (file) => {
    const starts = readFileSync(join("scripts", file), "utf8").split("\n").filter((line) => line.includes('"pg_ctl"') && line.includes('"start"'));
    expect(starts.length).toBeGreaterThan(0);
    for (const line of starts) expect(line).toMatch(/LC_ALL: "C"/);
  });
});
