import { describe, expect, it } from "vitest";
import { checkBudgetEdit, type BudgetEditInput } from "@/lib/campaign/budget-edit";

// #774: the money rules for editing a launched campaign's daily budget, total cap and end date, checked
// before any Meta call. Figures are #157's capped Solaride run (₹280 a day, ₹840 cap, 3 days, ₹168 spent).
const now = Date.parse("2026-10-24T14:24:00Z");
function input(over: Partial<BudgetEditInput> = {}): BudgetEditInput {
  return {
    current: { status: "active", dailyRupees: 280, capRupees: 840, endTime: "2026-10-26T14:24:00Z", spentRupees: 168 },
    approved: { dailyRupees: 280, capRupees: 840 },
    change: {},
    otherActive: [],
    weeklyLimitRupees: null,
    fundingRoomPaise: null,
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

  it("refuses a cap rise the ad account can't fund, counting Meta's 18% GST", () => {
    // ₹100 more cap needs ₹118 of room.
    expect(checkBudgetEdit(input({ change: { capRupees: 940 }, fundingRoomPaise: 11_700 })).ok).toBe(false);
    expect(checkBudgetEdit(input({ change: { capRupees: 940 }, fundingRoomPaise: 11_800 })).ok).toBe(true);
  });
});
