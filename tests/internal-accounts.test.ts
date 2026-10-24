import { describe, expect, it } from "vitest";
import { INTERNAL_DOMAINS, INTERNAL_USER_IDS, internalUserIdsSql, isInternalUserSql } from "../scripts/lib/internal-accounts.mjs";
import { eventsSql } from "../scripts/product-events.mjs";

describe("internal accounts (#379)", () => {
  it("lists team domains and owner user ids as plain data", () => {
    expect(INTERNAL_DOMAINS).toEqual(["adbrain.vanshul.com", "adbrain.local"]);
    for (const id of INTERNAL_USER_IDS) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("builds one predicate over auth.users: team domain, listed id or local email", () => {
    const sql = isInternalUserSql("u", ["Smoke@Example.com", "o'brien@example.com"]);
    expect(sql).toContain("split_part(lower(coalesce(u.email, '')), '@', 2) = any(array['adbrain.vanshul.com','adbrain.local']::text[])");
    expect(sql).toContain("u.id = any(array[");
    expect(sql).toContain("lower(coalesce(u.email, '')) = any(array['smoke@example.com','o''brien@example.com']::text[])");
    expect(isInternalUserSql("x", [])).toContain("array[]::text[]");
    expect(internalUserIdsSql([])).toMatch(/^select u\.id from auth\.users u where /);
  });
});

describe("product events helper (#379)", () => {
  it("wraps a query in a customer-only events CTE by default", () => {
    const sql = eventsSql("select name, count(*) from events group by 1", []);
    expect(sql).toMatch(/^with events as \(select \* from public\.product_events where coalesce\(user_id, \(select b\.owner_id from public\.businesses b where b\.id = business_id\)\) not in \(select u\.id from auth\.users u where /);
    expect(sql.endsWith("select name, count(*) from events group by 1")).toBe(true);
    expect(eventsSql("select 1 from events", [], { includeInternal: true })).toBe("with events as (select * from public.product_events) select 1 from events");
  });

  it("joins a caller's own WITH clause and allows only one read statement", () => {
    expect(eventsSql("with x as (select 1) select * from x, events", [])).toContain("), x as (select 1) select * from x, events");
    for (const bad of ["delete from events", "select 1; drop table x", ""]) expect(() => eventsSql(bad, [])).toThrow();
  });
});
