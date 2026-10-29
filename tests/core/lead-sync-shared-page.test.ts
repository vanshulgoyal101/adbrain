import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// #2022 (regression guard for #1775): when a Page is bound to two AdBrain businesses, a synced lead lands only in
// the business whose campaign it came from. metadb checks this right after 20261028 is applied, but a later
// migration re-creating lead_sync_checkpoint (as #1789 nearly did) would silently drop the filter; this checks the
// definition production ends up with.
const dir = join(process.cwd(), "db/migrations");
const files = readdirSync(dir).filter((file) => file.endsWith(".sql")).sort();
const define = /create\s+or\s+replace\s+function\s+public\.lead_sync_checkpoint\s*\(/i;

function body(file: string): string {
  const sql = readFileSync(join(dir, file), "utf8");
  const start = sql.search(define);
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end).replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").toLowerCase();
}

function keepsSharedPageFilter(sql: string): boolean {
  const shared = /(\w+) := exists \(select 1 from public\.meta_connections (\w+) where (?=[^)]*\b\2\.page_id = p_page_id\b)(?=[^)]*\b\2\.business_id (?:<>|!=) p_business_id\b)/.exec(sql);
  const join = /left join public\.campaigns (\w+) on (?=[^]*?\b\1\.business_id = p_business_id\b)(?=[^]*?\b\1\.meta_campaign_id = incoming\.meta_campaign_id\b)/.exec(sql);
  if (!shared || !join) return false;
  return new RegExp(`where not ${shared[1]} or ${join[1]}\\.id is not null`).test(sql);
}

describe("lead sync keeps a shared Page's leads in their own business (#1775, #2022)", () => {
  const latest = files.filter((file) => define.test(readFileSync(join(dir, file), "utf8"))).at(-1)!;

  it("the last migration defining lead_sync_checkpoint still filters a shared Page's leads to this business's campaigns", () => {
    expect(latest >= "20261028_lead_sync_shared_page.sql").toBe(true);
    expect(keepsSharedPageFilter(body(latest))).toBe(true);
  });

  it("no later migration drops it", () => {
    const later = files.filter((file) => file > latest);
    expect(later.filter((file) => /drop\s+function[^;]*lead_sync_checkpoint/i.test(readFileSync(join(dir, file), "utf8")))).toEqual([]);
  });

  it("control: the pre-#1775 definition (20261026) fails the check", () => {
    expect(keepsSharedPageFilter(body("20261026_lead_campaign_link.sql"))).toBe(false);
  });
});
