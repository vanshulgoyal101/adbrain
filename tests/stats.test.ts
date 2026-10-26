import { describe, expect, it } from "vitest";
import { customerFilterSql } from "../scripts/lib/internal-accounts.mjs";
import { SECTIONS, VALID_INDIAN_MOBILE, renderSection, sectionSql } from "../scripts/stats.mjs";

describe("customer filter (#451)", () => {
  it("uses the user, or the business owner for background rows, and drops system rows", () => {
    const sql = customerFilterSql("e.user_id", "e.business_id", []);
    expect(sql).toMatch(/^coalesce\(e\.user_id, \(select b\.owner_id from public\.businesses b where b\.id = e\.business_id\)\) not in \(select u\.id from auth\.users u where /);
  });
});

describe("npm run stats (#451)", () => {
  it("has the sections the CEO asked for", () => {
    expect(SECTIONS.map(({ key }) => key)).toEqual(["ai_by_model", "create_runs", "ad_receipts", "run_receipts", "campaign_receipts", "business_days", "failures", "auth", "speed", "plan_checks", "learnings", "managed_accounts", "funnel"]);
  });

  it("gives a receipt for each of the last 20 ads: its own calls, and later changes to it (#451 L1)", () => {
    const sql = sectionSql("ad_receipts", 7, []);
    expect(sql).toContain("c.generation->>'requestId'");
    expect(sql).toContain("e.metadata->>'angle' = c.generation->>'angleId'");
    expect(sql).toContain("e.metadata->>'creativeId' = c.id::text");
    expect(sql).toMatch(/order by c\.created_at desc limit 20$/);
  });

  it("gives a receipt for each of the last 5 Create runs, failed ads included (#451 L1)", () => {
    const sql = sectionSql("run_receipts", 7, []);
    expect(sql).toContain("route = 'creatives.generate'");
    expect(sql).toContain("min(created_at - make_interval(secs => coalesce(latency_ms, 0) / 1000.0))");
    expect(sql).toMatch(/limit 5$/);
  });

  it("gives a receipt for each of the last 5 campaign launches, Meta calls joined by request (#451 L2)", () => {
    const sql = sectionSql("campaign_receipts", 7, []);
    for (const route of ["/api/campaigns/plan", "/api/campaigns/preflight", "/api/campaigns/create", "/api/campaigns/[id]/refresh"]) expect(sql).toContain(`'${route}'`);
    expect(sql).toContain("e.request_id = cr.request_id and e.name = 'meta.graph'");
    expect(sql).toContain("from public.campaign_operations o");
  });

  it("counts launches the plan check ran on, and which rules didn't pass (#419 2a)", () => {
    const sql = sectionSql("plan_checks", 7, []);
    expect(sql).toContain("name = 'campaign.plan_check'");
    expect(sql).toContain("jsonb_array_elements_text(e.attributes->'validationRules')");
    expect(sql).toContain("'all launches checked'");
  });

  it("shows managed accounts now, by state, customers only by default (#527)", () => {
    const sql = sectionSql("managed_accounts", 7, []);
    expect(sql).toContain("from public.managed_meta_accounts m");
    expect(sql).toContain("not in (select u.id from auth.users u where ");
    expect(sql).toContain("interval '30 minutes'");
    expect(sectionSql("managed_accounts", 7, [], { includeInternal: true })).not.toContain("auth.users u where");
  });

  it("compares the last 10 launches from the learning ledger with their latest results, customers only by default (#588)", () => {
    const sql = sectionSql("learnings", 7, []);
    expect(sql).toContain("from public.campaign_learnings l");
    expect(sql).toContain("distinct on (campaign_id)");
    expect(sql).toContain("open_to_chat_pct");
    expect(sql).not.toContain("make_interval");
    expect(sql).toContain("not in (select u.id from auth.users u where ");
    expect(sectionSql("learnings", 7, [], { includeInternal: true })).not.toContain("auth.users u where");
  });

  it("counts real enquiries: WhatsApp chats started plus campaign form leads with a valid Indian mobile (#680)", () => {
    const sql = sectionSql("learnings", 7, []);
    expect(sql).toContain("source = 'meta_form' and campaign_id is not null");
    expect(sql).toContain("regexp_replace(coalesce(phone, ''), '\\D', '', 'g') ~ '^(91|0)?[6-9][0-9]{9}$'");
    expect(sql).toContain("as enquiries");
    expect(sql).toContain("as inr_per_enquiry");
    expect(sql).not.toMatch(/\bphone as\b|l\.phone|full_name/);
    const valid = (phone: string) => new RegExp(VALID_INDIAN_MOBILE).test(phone.replace(/\D/g, ""));
    for (const ok of ["+91 98765 43210", "9876543210", "09876543210", "919876543210", "+91-70097-64842"]) expect(valid(ok)).toBe(true);
    for (const bad of ["<test lead: dummy data for phone_number>", "", "12345", "5876543210", "+1 512 555 0134", "98765432101"]) expect(valid(bad)).toBe(false);
  });

  it("filters every event section to customers by default and opts in to everyone", () => {
    for (const { key } of SECTIONS.filter(({ key }) => !["funnel", "managed_accounts", "learnings"].includes(key))) {
      const sql = sectionSql(key, 7, []);
      expect(sql, key).toContain("make_interval(days => 7)");
      expect(sql, key).toContain("not in (select u.id from auth.users u where ");
      expect(sectionSql(key, 7, [], { includeInternal: true }), key).not.toContain("auth.users u where");
      expect(sql, key).not.toMatch(/;\s*\S/);
    }
  });

  it("counts sign-ins by method and keeps signed-out failures (#451 L4)", () => {
    const sql = sectionSql("auth", 7, []);
    expect(sql).toContain("e.name like 'auth.%'");
    expect(sql).toContain("e.user_id is null or ");
  });

  it("rejects a bad window", () => {
    for (const days of [0, 400, 1.5]) expect(() => sectionSql("speed", days, [])).toThrow();
  });

  it("renders rows as an aligned table, and says when there is nothing", () => {
    const text = renderSection({ title: "AI cost by model" }, [
      { model: "anthropic/claude-haiku-5.5", calls: 12, failed: 1, tokens: 80000, usd: "0.2100" },
    ]);
    expect(text).toContain("AI cost by model");
    expect(text).toMatch(/model\s+calls\s+failed\s+tokens\s+usd/);
    expect(text).toMatch(/anthropic\/claude-haiku-5\.5\s+12\s+1\s+80000\s+0\.2100/);
    expect(renderSection({ title: "Speed" }, [])).toContain("(none)");
  });
});
