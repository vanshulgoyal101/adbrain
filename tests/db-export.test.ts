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
});
