// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditBudgetDialog, META_WAIT_MS } from "@/components/edit-budget-dialog";
import { applyBudget, budgetChangeFromForm, budgetFormStart, initialBudgetForm, localDay } from "@/lib/campaign/budget-edit-form";

// #774: Manage → Edit budget. Meta checks the change first (nothing written), the owner reads it and
// confirms anything above what they approved, waits out Meta's 30 s limit, then saves with the same key.
const NOW = Date.parse("2026-10-26T14:45:00Z");
const children = { source: "campaign_operation", metaResult: { campaignId: "c", adSetIds: ["daily", "run"], adIds: ["a1", "a2"] } };
const capped = { daily_budget: 200, raw: { ...children, cappedAdSetIds: ["run"], cap: { adSetId: "run", lifetimeBudgetPaise: 60_000, endTime: "2026-10-29T14:27:07.000Z", days: 3 } } };
const uncapped = { daily_budget: 200, raw: { source: "campaign_operation", metaResult: { campaignId: "c", adSetIds: ["daily"], adIds: ["a1"] } } };

describe("budget form", () => {
  it("starts a capped run from its total and end date, an uncapped one from its daily budget, and nothing for an ended run", () => {
    expect(budgetFormStart(capped as never, NOW)).toEqual({ capped: true, dailyRupees: 200, capRupees: 600, endTime: "2026-10-29T14:27:07.000Z" });
    expect(budgetFormStart(uncapped as never, NOW)).toEqual({ capped: false, dailyRupees: 200, capRupees: null, endTime: null });
    expect(budgetFormStart(capped as never, Date.parse("2026-10-30T00:00:00Z"))).toBeNull();
  });

  it("sends only what changed, keeps the run's time of day on a new end date, and refuses no change", () => {
    const start = budgetFormStart(capped as never, NOW)!;
    const end = new Date(start.endTime!);
    end.setDate(end.getDate() + 2);
    expect(budgetChangeFromForm(start, { ...initialBudgetForm(start), cap: "900", endDate: localDay(end.toISOString()) }))
      .toEqual({ change: { capRupees: 900, endTime: end.toISOString() } });
    expect(budgetChangeFromForm(start, initialBudgetForm(start))).toEqual({ error: "Change the total cap or the end date." });
    const daily = budgetFormStart(uncapped as never, NOW)!;
    expect(budgetChangeFromForm(daily, { ...initialBudgetForm(daily), daily: "₹1,000" })).toEqual({ change: { dailyRupees: 1000 } });
    expect(budgetChangeFromForm(daily, { ...initialBudgetForm(daily), daily: "0" })).toEqual({ error: "Enter the daily budget in rupees." });
  });

  it("applies the saved budget to the card", () => {
    expect(applyBudget(uncapped as never, { dailyRupees: 150, capRupees: null, endTime: null })).toMatchObject({ daily_budget: 150 });
    expect(applyBudget(capped as never, { dailyRupees: 200, capRupees: 900, endTime: "2026-10-31T14:27:07.000Z" }))
      .toMatchObject({ daily_budget: 200, raw: { cappedAdSetIds: ["run"], cap: { adSetId: "run", lifetimeBudgetPaise: 90_000, endTime: "2026-10-31T14:27:07.000Z", days: 3 } } });
  });
});

describe("EditBudgetDialog", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const before = { dailyRupees: 200, capRupees: null, endTime: null, spentRupees: 0 };
  const after = { ...before, dailyRupees: 250 };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
    fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return Response.json(body.preview
        ? { ok: true, preview: { before, after, needsConfirmation: true, confirmationDigest: "d".repeat(64), notices: ["This is a big budget change, so it may restart Meta's learning; results can be slower for 2–3 days."] } }
        : { ok: true, result: { before, after, notices: [], replay: false } });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const sent = (index: number) => JSON.parse(String((fetchMock.mock.calls[index][1] as RequestInit).body));

  it("checks with Meta, shows the change, waits out Meta's 30 s, then confirms with the digest and the same key", async () => {
    const onSaved = vi.fn();
    render(<EditBudgetDialog campaignId="c-1" campaignName="Rooftop solar" start={budgetFormStart(uncapped as never, NOW)!} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("Daily budget (₹)"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: /Check with Meta/ }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("₹200 → ₹250 a day");
    expect(status).toHaveTextContent("more than you approved");
    expect(sent(0)).toMatchObject({ change: { dailyRupees: 250 }, preview: true });

    const wait = screen.getByRole("button", { name: /Meta needs a moment/ });
    expect(wait).toBeDisabled();
    await act(async () => { vi.setSystemTime(NOW + META_WAIT_MS); vi.advanceTimersByTime(META_WAIT_MS); });
    const confirm = screen.getByRole("button", { name: "Confirm ₹250 a day" });
    fireEvent.click(confirm);
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sent(1)).toEqual({ change: { dailyRupees: 250 }, idempotencyKey: sent(0).idempotencyKey, confirmationDigest: "d".repeat(64) });
    expect(onSaved).toHaveBeenCalledWith("Budget changed in Meta.", after);
  });

  it("shows the server's refusal and sends nothing more", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Pause the campaign to change its daily budget; it resumes at the new amount after your review." }, { status: 409 }));
    render(<EditBudgetDialog campaignId="c-1" campaignName="Rooftop solar" start={budgetFormStart(uncapped as never, NOW)!} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Daily budget (₹)"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: /Check with Meta/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Pause the campaign to change its daily budget");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("offers the total and end date for a capped run", () => {
    render(<EditBudgetDialog campaignId="c-1" campaignName="Rooftop solar" start={budgetFormStart(capped as never, NOW)!} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText("Total cap (₹)")).toHaveValue(600);
    expect(screen.getByLabelText("Ends on")).toHaveValue(localDay("2026-10-29T14:27:07.000Z"));
    expect(screen.queryByLabelText("Daily budget (₹)")).toBeNull();
  });
});
