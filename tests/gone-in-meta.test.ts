import { describe, expect, it } from "vitest";
import {
  GONE_LINES, OUTSIDE_LINES, budgetChangedInMeta, goneInMeta, metaDailyBudgetPaise, outsideChanges, pausedInMeta, recentlyDeletedInMeta, recentlyRaisedInMeta,
} from "@/lib/campaign/gone-in-meta";
import type { MetaCampaignState } from "@/lib/meta/insights";

// #1600 (CPO #1601): words for a campaign deleted in Meta Ads Manager.
describe("gone in Meta (#721, #1600)", () => {
  it("names DELETED and ARCHIVED only (#1678: a bare 100/33 never ends a campaign)", () => {
    expect(goneInMeta({ raw: { metaStatus: "DELETED" } })).toBe("Deleted in Meta");
    expect(goneInMeta({ raw: { metaStatus: "ARCHIVED" } })).toBe("Archived in Meta");
    expect(goneInMeta({ raw: { metaStatus: "MISSING" } })).toBeNull();
    expect(goneInMeta({ raw: null })).toBeNull();
  });

  it("Home names a deleted campaign for a week after AdBrain found it, and only when Meta said DELETED", () => {
    const now = Date.parse("2026-10-28T18:00:00Z");
    const raw = (metaStatus: string, days: number) => ({ metaStatus, metaGoneAt: new Date(now - days * 86_400_000).toISOString() });
    expect(recentlyDeletedInMeta({ raw: raw("DELETED", 1) }, now)).toBe(true);
    expect(recentlyDeletedInMeta({ raw: raw("DELETED", 8) }, now)).toBe(false);
    expect(recentlyDeletedInMeta({ raw: raw("MISSING", 1) }, now)).toBe(false);
    expect(recentlyDeletedInMeta({ raw: { metaStatus: "DELETED" } }, now)).toBe(false);
  });

  it("the card line is the CPO's", () => {
    expect(GONE_LINES.deleted).toBe("This campaign was deleted in Meta Ads Manager, so it can't run or be changed here. Nothing more will spend. Its results up to then stay below.");
  });
});

// #1903 (CPO #1601): paused, or the daily budget changed, in Meta Ads Manager.
describe("changed in Meta Ads Manager (#1903)", () => {
  const now = new Date("2026-10-29T08:00:00Z");
  const state = (over: Partial<MetaCampaignState> = {}): MetaCampaignState => ({
    status: "ACTIVE", adSets: [{ id: "as1", status: "ACTIVE", dailyBudget: "50000" }], ...over,
  });
  const row = { status: "active" as const, daily_budget: 500, raw: { keep: 1 } };

  it("counts Meta's daily budget the way AdBrain stores it, and refuses anything else", () => {
    expect(metaDailyBudgetPaise(state(), [])).toBe(50000);
    expect(metaDailyBudgetPaise(state({ dailyBudget: "70000", adSets: [{ id: "as1", status: "ACTIVE" }] }), [])).toBe(70000);
    expect(metaDailyBudgetPaise(state({ adSets: [{ id: "as1", status: "ACTIVE", dailyBudget: "30000" }, { id: "as2", status: "PAUSED", dailyBudget: "20000" }] }), [])).toBe(50000);
    // A capped run's ad set has a lifetime cap; it is not the daily budget.
    expect(metaDailyBudgetPaise(state({ adSets: [{ id: "as1", status: "ACTIVE", dailyBudget: "50000" }, { id: "cap", status: "ACTIVE", lifetimeBudget: "100000" }] }), ["cap"])).toBe(50000);
    expect(metaDailyBudgetPaise(state({ adSets: [{ id: "cap", status: "ACTIVE", lifetimeBudget: "100000" }] }), [])).toBeNull();
    expect(metaDailyBudgetPaise(state({ lifetimeBudget: "900000" }), [])).toBeNull();
    expect(metaDailyBudgetPaise(state({ adSets: [{ id: "as1", status: "ARCHIVED", dailyBudget: "50000" }] }), [])).toBeNull();
    expect(metaDailyBudgetPaise(state({ adSets: [{ id: "as1", status: "ACTIVE", dailyBudget: "5e4" }] }), [])).toBeNull();
    expect(metaDailyBudgetPaise(state({ dailyBudget: "70000" }), [])).toBeNull();
    expect(metaDailyBudgetPaise(state({ adSets: [] }), [])).toBeNull();
  });

  it("marks a pause in Meta without changing AdBrain's status, and clears it once Meta runs it again", () => {
    const paused = outsideChanges(row, state({ status: "PAUSED" }), [], now);
    expect(paused).toEqual({ raw: { keep: 1, metaPausedAt: now.toISOString() }, raised: false });
    expect(paused).not.toHaveProperty("status");
    const marked = { ...row, raw: paused!.raw };
    expect(pausedInMeta(marked)).toBe(true);
    expect(outsideChanges(marked, state({ status: "PAUSED" }), [], new Date(now.getTime() + 60_000))).toBeNull();
    expect(outsideChanges(marked, state(), [], now)).toEqual({ raw: { keep: 1 }, raised: false });
    // AdBrain paused it itself: nothing to say.
    expect(outsideChanges({ ...row, status: "paused" }, state({ status: "PAUSED" }), [], now)).toBeNull();
    expect(pausedInMeta({ status: "paused", raw: { metaPausedAt: now.toISOString() } })).toBe(false);
    expect(OUTSIDE_LINES.paused).toBe("This was paused in Meta Ads Manager. Nothing is spending.");
  });

  it("follows a budget changed in Meta, keeps the first budget as 'was', and drops the line when it goes back", () => {
    const up = outsideChanges(row, state({ adSets: [{ id: "as1", status: "ACTIVE", dailyBudget: "80000" }] }), [], now)!;
    expect(up).toEqual({ daily_budget: 800, raised: true, raw: { keep: 1, metaBudgetChange: { wasRupees: 500, nowRupees: 800, at: now.toISOString() } } });
    const raisedRow = { ...row, daily_budget: 800, raw: up.raw };
    expect(budgetChangedInMeta(raisedRow)).toEqual({ wasRupees: 500, nowRupees: 800, at: now.toISOString(), raised: true });
    expect(OUTSIDE_LINES.budget("₹800", "₹500")).toBe("The daily budget was changed in Meta Ads Manager: now ₹800 a day (was ₹500).");

    expect(recentlyRaisedInMeta(raisedRow, now.getTime() + 6 * 86_400_000)?.nowRupees).toBe(800);
    expect(recentlyRaisedInMeta(raisedRow, now.getTime() + 8 * 86_400_000)).toBeNull();

    const later = new Date(now.getTime() + 3_600_000);
    const down = outsideChanges(raisedRow, state({ adSets: [{ id: "as1", status: "ACTIVE", dailyBudget: "30000" }] }), [], later)!;
    expect(down).toEqual({ daily_budget: 300, raised: false, raw: { keep: 1, metaBudgetChange: { wasRupees: 500, nowRupees: 300, at: later.toISOString() } } });
    expect(budgetChangedInMeta({ daily_budget: 300, raw: down.raw })?.raised).toBe(false);

    const back = outsideChanges(raisedRow, state(), [], later)!;
    expect(back).toEqual({ daily_budget: 500, raised: false, raw: { keep: 1 } });
    // An AdBrain edit since then replaces the budget, so the old line no longer shows.
    expect(budgetChangedInMeta({ daily_budget: 650, raw: up.raw })).toBeNull();
  });

  it("leaves the row alone when Meta matches it or the budget can't be counted", () => {
    expect(outsideChanges(row, state(), [], now)).toBeNull();
    expect(outsideChanges(row, state({ lifetimeBudget: "900000" }), [], now)).toBeNull();
    expect(outsideChanges({ ...row, daily_budget: null }, state({ adSets: [{ id: "as1", status: "ACTIVE", dailyBudget: "80000" }] }), [], now)).toBeNull();
  });
});
