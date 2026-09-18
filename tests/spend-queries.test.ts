import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  failedTable: "", campaigns: [{ id: "campaign", status: "active", daily_budget: 500 }],
  latest: [{ id: "campaign", campaign_results: [{ id: "result", campaign_id: "campaign", spend: 42 }] }, { id: "empty", campaign_results: [] }],
  select: vi.fn(), order: vi.fn(), limit: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: (table: string) => {
    let embedded = false;
    const result = () => (embedded ? "campaign_results" : table) === mocks.failedTable
      ? { data: null, error: { message: "private database detail" } }
      : { data: embedded ? mocks.latest : table === "campaigns" ? mocks.campaigns : table === "spend_limits" ? null : [], error: null };
    const query = {
      select: (columns: string) => { embedded = columns.includes("campaign_results"); mocks.select(columns); return query; },
      eq: () => query, in: () => query,
      order: (...args: unknown[]) => { mocks.order(...args); return query; },
      limit: (...args: unknown[]) => { mocks.limit(...args); return query; },
      maybeSingle: async () => result(),
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  },
}) }));

beforeEach(() => { mocks.failedTable = ""; vi.clearAllMocks(); });

describe("spend query failures", () => {
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