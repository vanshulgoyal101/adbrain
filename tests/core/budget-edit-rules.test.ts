import { describe, expect, it } from "vitest";
import { checkBudgetEdit, type BudgetEditInput } from "@/lib/campaign/budget-edit";

// #774: the money rules for editing a launched campaign's daily budget, total cap and end date, checked
// before any Meta call. Figures are #157's capped Solaride run (₹280 a day, ₹840 cap, 3 days, ₹168 spent).
const now = Date.parse("2026-10-24T14:24:00Z");
function input(over: Partial<BudgetEditInput> = {}): BudgetEditInput {
  return {
    current: { status: "active", dailyRupees: 280, capRupees: 840, endTime: "2026-10-26T14:24:00Z", spentRupees: 168 },
    approved: { dailyRupees: 280, capRupees: 840, capDays: 3 },
    change: {},
    otherActive: [],
    weeklyLimitRupees: null,
    funding: { mode: "own", account: { spendCapPaise: 0, amountSpentPaise: 0, roomPaise: 0, prepay: false } },
    now,
    ...over,
  };
}

describe("core: budget edit money rules (#774)", () => {
  it("lowers the daily budget without a new confirmation, warning that learning may restart", () => {
    const result = checkBudgetEdit(input({ change: { dailyRupees: 150 } }));
    expect(result).toMatchObject({ ok: true, needsConfirmation: false });
    expect(result.ok && result.notices.join(" ")).toMatch(/may restart Meta's learning/);
  });

  it("a small change carries no learning warning", () => {
    const result = checkBudgetEdit(input({ change: { dailyRupees: 300 } }));
    expect(result.ok && result.notices).toEqual([]);
  });

  it("raising above what the owner approved needs a fresh confirmation", () => {
    expect(checkBudgetEdit(input({ change: { dailyRupees: 400 } }))).toMatchObject({ ok: true, needsConfirmation: true });
    expect(checkBudgetEdit(input({ change: { capRupees: 1200 } }))).toMatchObject({ ok: true, needsConfirmation: true });
    expect(checkBudgetEdit(input({ change: { capRupees: 800 } }))).toMatchObject({ ok: true, needsConfirmation: false });
  });

  it("extends the end date with no confirmation and no learning warning", () => {
    expect(checkBudgetEdit(input({ change: { endTime: "2026-10-29T14:24:00Z" } }))).toEqual({ ok: true, needsConfirmation: false, notices: [] });
  });

  it.each([
    ["a cap at or below what's already spent", { capRupees: 168 }, /already spent ₹168/],
    ["an end date in the past", { endTime: "2026-10-24T10:00:00Z" }, /end date in the future/],
    ["a daily budget of ₹0", { dailyRupees: 0 }, /daily budget above ₹0/],
    ["no change", {}, /Nothing to change/],
  ] as const)("refuses %s", (_name, change, message) => {
    const result = checkBudgetEdit(input({ change }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(message);
  });

  it("refuses a running campaign's raise past the weekly limit in Settings", () => {
    const result = checkBudgetEdit(input({ change: { dailyRupees: 400 }, weeklyLimitRupees: 2500, otherActive: [{ id: "c2", status: "active", dailyBudget: 100, spend: 0 }] }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/weekly limit of ₹2,500/);
  });

  it("says it couldn't check, not 'past your limit', when another campaign's budget can't be read", () => {
    const result = checkBudgetEdit(input({ change: { dailyRupees: 300 }, weeklyLimitRupees: 25_000, otherActive: [{ id: "c2", status: "active", dailyBudget: null, spend: 0 }] }));
    expect(!result.ok && result.message).toMatch(/couldn't check this against your weekly limit/);
  });

  // QA on #833: Meta won't switch an ad set from a daily budget to a lifetime one.
  it("refuses adding a total cap to a run that has none", () => {
    const uncapped = { status: "active", dailyRupees: 280, capRupees: null, endTime: null, spentRupees: 168 };
    const result = checkBudgetEdit(input({ current: uncapped, approved: { dailyRupees: 280, capRupees: null }, change: { capRupees: 840 } }));
    expect(!result.ok && result.message).toMatch(/start a new run/i);
  });

  // CTO on #833: an end-date extension adds no spend only because the run is capped.
  it("an uncapped run needs a fresh confirmation to run longer, but not to stop sooner", () => {
    const uncapped = { status: "active", dailyRupees: 280, capRupees: null, endTime: "2026-10-26T14:24:00Z", spentRupees: 168 };
    const edit = (endTime: string) => checkBudgetEdit(input({ current: uncapped, approved: { dailyRupees: 280, capRupees: null }, change: { endTime } }));
    expect(edit("2026-10-29T14:24:00Z")).toMatchObject({ ok: true, needsConfirmation: true });
    expect(edit("2026-10-25T14:24:00Z")).toMatchObject({ ok: true, needsConfirmation: false });
    const endless = checkBudgetEdit(input({ current: { ...uncapped, endTime: null }, approved: { dailyRupees: 280, capRupees: null }, change: { endTime: "2026-10-29T14:24:00Z" } }));
    expect(endless).toMatchObject({ ok: true, needsConfirmation: false });
  });

  // The run may still spend up to the new cap minus what it has spent; Meta's account limit counts spend (no GST).
  it("refuses a cap rise the own account's spending limit can't cover", () => {
    const account = (roomPaise: number) => ({ spendCapPaise: 500_000, amountSpentPaise: 500_000 - roomPaise, roomPaise, prepay: false });
    const result = checkBudgetEdit(input({ change: { capRupees: 940 }, funding: { mode: "own", account: account(77_100) } }));
    expect(!result.ok && result.message).toMatch(/₹771.*₹772/);
    expect(checkBudgetEdit(input({ change: { capRupees: 940 }, funding: { mode: "own", account: account(77_200) } })).ok).toBe(true);
  });

  it("refuses an operator-funded cap rise when the account has no spending limit", () => {
    const result = checkBudgetEdit(input({ change: { capRupees: 940 }, funding: { mode: "operator", account: { spendCapPaise: 0, amountSpentPaise: 0, roomPaise: 0, prepay: false } } }));
    expect(!result.ok && result.message).toMatch(/Set a spending limit on the Meta ad account/);
  });

  it("refuses a managed cap rise past the AdBrain allowance", () => {
    const result = checkBudgetEdit(input({ change: { capRupees: 940 }, funding: { mode: "managed", account: null, allowancePaise: 50_000 } }));
    expect(!result.ok && result.message).toMatch(/advertising funds/);
  });

  // Reviewer on #901: a capped run spends (cap − spent) over the days left, so a shorter end or a bigger cap
  // with the same end raises Meta's daily pace above the approved cap / days.
  describe("a capped run's daily pace", () => {
    it("a shorter end date that speeds spending up needs a fresh confirmation and says the new pace", () => {
      const result = checkBudgetEdit(input({ current: { status: "paused", dailyRupees: 280, capRupees: 840, endTime: "2026-10-26T14:24:00Z", spentRupees: 168 }, change: { endTime: "2026-10-25T14:24:00Z" } }));
      expect(result).toMatchObject({ ok: true, needsConfirmation: true });
      expect(result.ok && result.notices.join(" ")).toContain("about ₹672 a day");
    });

    it("a running capped run's faster pace is checked against the weekly limit in Settings", () => {
      const result = checkBudgetEdit(input({ change: { capRupees: 1_200 }, weeklyLimitRupees: 2_000 }));
      expect(result).toEqual({ ok: false, message: "About ₹516 a day would take your campaigns past your weekly limit of ₹2,000 in Settings." });
      expect(checkBudgetEdit(input({ change: { capRupees: 1_200 }, weeklyLimitRupees: 5_000 }))).toMatchObject({ ok: true, needsConfirmation: true });
    });

    it("a pace at or below the approved one needs no confirmation", () => {
      expect(checkBudgetEdit(input({ change: { capRupees: 700 } }))).toMatchObject({ ok: true, needsConfirmation: false, notices: [] });
    });
  });
});
