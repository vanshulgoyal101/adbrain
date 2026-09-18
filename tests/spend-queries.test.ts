import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  failedTable: "", campaigns: [{ id: "campaign", status: "active", daily_budget: 500 }],
  latest: [{ id: "campaign", campaign_results: [{ id: "result", campaign_id: "campaign", spend: 42 }] }, { id: "empty", campaign_results: [] }],
  select: vi.fn(), order: vi.fn(), limit: vi.fn(), eq: vi.fn(), or: vi.fn(), ilike: vi.fn(), in: vi.fn(),
  pageSize: 1000, failAfter: "",
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: (table: string) => {
    let embedded = false;
    let after = "";
    let ids: string[] | undefined;
    let requestedLimit = 1000;
    const rows = () => (embedded ? mocks.latest : table === "campaigns" ? mocks.campaigns : [])
      .filter(row => row.id > after && (!ids || ids.includes(row.id)))
      .sort((left, right) => left.id.localeCompare(right.id));
    const result = () => (embedded ? "campaign_results" : table) === mocks.failedTable || (mocks.failAfter && after === mocks.failAfter)
      ? { data: null, error: { message: "private database detail" } }
      : { data: table === "spend_limits" ? null : rows().slice(0, Math.min(requestedLimit, mocks.pageSize)), count: rows().length, error: null };
    const query = {
      select: (columns: string) => { embedded = columns.includes("campaign_results"); mocks.select(columns); return query; },
      eq: (...args: unknown[]) => { mocks.eq(...args); return query; },
      or: (value: string) => { mocks.or(value); return query; },
      ilike: (...args: unknown[]) => { mocks.ilike(...args); return query; },
      in: (column: string, values: string[]) => { mocks.in(column, values); ids = values; return query; },
      gt: (_column: string, value: string) => { after = value; return query; },
      order: (...args: unknown[]) => { mocks.order(...args); return query; },
      limit: (count: number, options?: unknown) => { mocks.limit(count, options); if (!options) requestedLimit = count; return query; },
      maybeSingle: async () => result(),
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  },
}) }));

beforeEach(() => { mocks.failedTable = ""; mocks.failAfter = ""; mocks.pageSize = 1000; vi.clearAllMocks(); });

describe("spend query failures", () => {
  it("rejects a later-page failure instead of returning a partial spend total", async () => {
    mocks.pageSize = 1;
    mocks.failAfter = "campaign";
    const { getCampaignSpend } = await import("@/lib/supabase/queries");
    await expect(getCampaignSpend("business")).rejects.toThrow("could not be loaded");
  });

  it("deduplicates and batches more than one hundred snapshot IDs", async () => {
    const { getLatestResults } = await import("@/lib/supabase/queries");
    const ids = Array.from({ length: 205 }, (_, index) => `campaign-${index}`);
    await getLatestResults([...ids, ...ids]);
    expect(mocks.in.mock.calls.map(call => call[1].length)).toEqual([100, 100, 5]);
  });

  it("bounds display pages, escapes literal search, and scopes the cursor to a business", async () => {
    const { getCampaignPage } = await import("@/lib/supabase/queries");
    const cursor = Buffer.from(JSON.stringify({ createdAt: "2026-09-19T01:00:00+00:00", id: "11111111-1111-4111-8111-111111111111" })).toString("base64url");
    await getCampaignPage("business", { cursor, query: "50%_sale", status: "paused" });
    expect(mocks.eq).toHaveBeenCalledWith("business_id", "business");
    expect(mocks.eq).toHaveBeenCalledWith("status", "paused");
    expect(mocks.limit).toHaveBeenCalledWith(50, undefined);
    expect(mocks.ilike).toHaveBeenCalledWith("name", "%50\\%\\_sale%");
    expect(mocks.or).toHaveBeenCalledWith("created_at.lt.2026-09-19T01:00:00+00:00,and(created_at.eq.2026-09-19T01:00:00+00:00,id.lt.11111111-1111-4111-8111-111111111111)");
  });

  it.each(["not-json", Buffer.from(JSON.stringify({ createdAt: "bad),id.gt.0", id: "bad" })).toString("base64url")])("rejects invalid cursors before querying", async cursor => {
    const { getCampaignPage } = await import("@/lib/supabase/queries");
    await expect(getCampaignPage("business", { cursor })).rejects.toThrow();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("keeps a display cursor when the database caps a page below fifty rows", async () => {
    const { getCampaignPage } = await import("@/lib/supabase/queries");
    const original = mocks.campaigns;
    mocks.pageSize = 1;
    mocks.campaigns = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"].map(id => ({ id, status: "paused", daily_budget: 200, created_at: "2026-09-19T01:00:00+00:00" }));
    try {
      const page = await getCampaignPage("business");
      expect(page.campaigns).toHaveLength(1);
      expect(page.nextCursor).not.toBeNull();
      expect(JSON.parse(Buffer.from(page.nextCursor!, "base64url").toString())).toMatchObject({ id: mocks.campaigns[0].id });
    } finally { mocks.campaigns = original; }
  });
  it("reads every campaign even when the server returns a smaller page than requested", async () => {
    mocks.pageSize = 1;
    const original = mocks.campaigns;
    mocks.campaigns = [
      { id: "first", status: "active", daily_budget: 100 },
      { id: "second", status: "active", daily_budget: 200 },
      { id: "third", status: "paused", daily_budget: 300 },
    ];
    try {
      const { getCampaignSpend } = await import("@/lib/supabase/queries");
      expect((await getCampaignSpend("business")).map(row => row.id)).toEqual(["first", "second", "third"]);
    } finally {
      mocks.campaigns = original;
    }
  });

  it("reads every latest snapshot across server-capped pages", async () => {
    mocks.pageSize = 1;
    const original = mocks.latest;
    mocks.latest = [
      { id: "first", campaign_results: [{ id: "result-1", campaign_id: "first", spend: 42 }] },
      { id: "second", campaign_results: [{ id: "result-2", campaign_id: "second", spend: 58 }] },
    ];
    try {
      const { getLatestResults } = await import("@/lib/supabase/queries");
      expect(Object.values(await getLatestResults(["first", "second"])).reduce((sum, row) => sum + row.spend, 0)).toBe(100);
    } finally {
      mocks.latest = original;
    }
  });

  it("requests only the newest result per campaign, not all historical snapshots", async () => {
    const { getLatestResults } = await import("@/lib/supabase/queries");
    expect(await getLatestResults(["campaign", "empty"])).toEqual({ campaign: mocks.latest[0].campaign_results[0] });
    expect(mocks.select).toHaveBeenCalledWith("id, campaign_results!inner(*)");
    expect(mocks.order).toHaveBeenCalledWith("fetched_at", { referencedTable: "campaign_results", ascending: false });
    expect(mocks.limit).toHaveBeenCalledWith(1, { referencedTable: "campaign_results" });
  });

  it("skips the database when there are no campaigns", async () => {
    const { getLatestResults } = await import("@/lib/supabase/queries");
    expect(await getLatestResults([])).toEqual({});
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it.each(["campaigns", "campaign_results"])("does not turn a %s error into zero spend", async (table) => {
    mocks.failedTable = table;
    const { getCampaignSpend } = await import("@/lib/supabase/queries");
    await expect(getCampaignSpend("business")).rejects.toThrow("could not be loaded");
  });

  it("does not turn a failed limits read into an unlimited allowance", async () => {
    mocks.failedTable = "spend_limits";
    const { getSpendLimits } = await import("@/lib/supabase/queries");
    await expect(getSpendLimits("business")).rejects.toThrow("Spend limits could not be loaded.");
  });

  it("keeps defaults when no limits were saved and the query succeeded", async () => {
    const { getSpendLimits } = await import("@/lib/supabase/queries");
    expect((await getSpendLimits("business")).weeklyCapRupees).toBeNull();
  });
});