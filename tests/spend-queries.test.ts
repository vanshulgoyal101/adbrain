import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ failedTable: "", campaigns: [{ id: "campaign", status: "active", daily_budget: 500 }] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: (table: string) => {
    const result = () => table === mocks.failedTable
      ? { data: null, error: { message: "private database detail" } }
      : { data: table === "campaigns" ? mocks.campaigns : table === "spend_limits" ? null : [], error: null };
    const query = { select: () => query, eq: () => query, in: () => query, order: async () => result(), maybeSingle: async () => result() };
    return query;
  },
}) }));

beforeEach(() => { mocks.failedTable = ""; });

describe("spend query failures", () => {
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