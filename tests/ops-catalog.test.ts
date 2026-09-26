import { describe, expect, it, vi } from "vitest";
import { collectCatalog } from "../scripts/check-ops-catalog.mjs";

describe("read-only operations catalog", () => {
  it("uses a bounded read-only transaction and does not query application rows", async () => {
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes("to_regclass") ? [{ ledger: null, buckets: null }] : [] }));
    const result = await collectCatalog({ query });
    const statements = query.mock.calls.map(([sql]) => sql);
    expect(statements[0]).toBe("begin read only");
    expect(statements.at(-1)).toBe("rollback");
    expect(statements).toContain("set local statement_timeout = '10s'");
    expect(statements.every(sql => /^(begin read only|set local|select|rollback)/.test(sql))).toBe(true);
    expect(statements.some(sql => /from public\./i.test(sql))).toBe(false);
    expect(statements.some(sql => /rolpassword|auth\.users|storage\.objects/i.test(sql))).toBe(false);
    expect(result.sections.migrations).toBeNull();
    expect(result.sections.storage_buckets).toBeNull();
  });

  it("rolls back a failed catalog inspection", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("select")) throw new Error("catalog unavailable");
      return { rows: [] };
    });
    await expect(collectCatalog({ query })).rejects.toThrow("catalog unavailable");
    expect(query.mock.calls.at(-1)?.[0]).toBe("rollback");
  });

  it("reads only configuration fields from existing ledger and bucket tables", async () => {
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes("to_regclass") ? [{ ledger: "schema_migrations", buckets: "buckets" }] : [] }));
    await collectCatalog({ query });
    expect(query).toHaveBeenCalledWith("select name,checksum,applied_at from private.schema_migrations order by name");
    expect(query).toHaveBeenCalledWith("select id,public,file_size_limit,allowed_mime_types from storage.buckets order by id");
  });
});