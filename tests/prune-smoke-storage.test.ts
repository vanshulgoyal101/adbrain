import { describe, expect, it } from "vitest";
import { planSql, uuidList } from "../scripts/prune-smoke-storage.mjs";

const owner = "11111111-2222-4333-8444-555555555555";

describe("smoke storage prune (#1891)", () => {
  it("accepts only uuids into SQL", () => {
    expect(uuidList([owner])).toBe(`'${owner}'`);
    expect(() => uuidList([])).toThrow();
    expect(() => uuidList(["x'); drop table creatives; --"])).toThrow();
  });
  it("plans only for smoke-owned businesses, keeps the newest and every referenced creative", () => {
    const sql = planSql([owner], 7, 20);
    expect(sql).toContain(`owner_id in ('${owner}')`);
    expect(sql).toContain("r.rn > 20");
    expect(sql).toContain("interval '7 days'");
    for (const ref of ["campaign_ads", "creative_regeneration_claims", "campaign_drafts", "campaign_operations", "public.campaigns"]) expect(sql).toContain(ref);
    expect(sql).toMatch(/split_part\(o\.name, '\/', 1\) in \(select id::text from smoke\)/);
  });
});
