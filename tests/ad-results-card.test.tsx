// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdResults } from "@/components/ad-results";

// #783: "Which ad worked" on the campaign card (CPO + Designer notes): one quiet row per ad, "Best" as a word,
// "—" before an ad's first enquiry, "Early" while no winner, the rest behind "All ads", hidden while off.
const ad = (adId: string, over: Record<string, unknown> = {}) => ({
  adId, name: `Ad ${adId}`, delivered: true, replaced: false, best: false, impressions: 100, results: 0, spend: 0, costPerResult: null, ...over,
});
const open = async (body: unknown, status = 200, onRunAgain?: () => void) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(body, { status })));
  const view = render(<AdResults campaignId="c1" onRunAgain={onRunAgain} />);
  const details = view.container.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  return view;
};

afterEach(() => vi.unstubAllGlobals());

describe("<AdResults> (#783)", () => {
  it("lists the Best ad first, shows — before an ad's first enquiry and the ads Meta hasn't shown", async () => {
    await open({ ok: true, syncedAt: new Date().toISOString(), ads: [
      ad("1", { best: true, results: 6, spend: 600, costPerResult: 100 }),
      ad("2", { results: 0, spend: 120 }),
      ad("3", { delivered: false, impressions: 0 }),
    ] });
    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Best")).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent("6 enquiries");
    expect(rows[0]).toHaveTextContent("₹100 per enquiry");
    expect(rows[1]).toHaveTextContent("— per enquiry");
    expect(rows[1]).not.toHaveTextContent("₹120");
    expect(rows[2]).toHaveTextContent("Meta hasn't shown this ad yet");
    expect(screen.queryByText(/too few enquiries/)).not.toBeInTheDocument();
    expect(screen.getByText("Updated just now")).toBeInTheDocument();
  });

  it("says it's early when there's no winner, and keeps more than 3 ads behind All ads", async () => {
    await open({ ok: true, syncedAt: null, ads: [ad("1", { results: 1, spend: 70, costPerResult: 70 }), ad("2"), ad("3"), ad("4"), ad("5")] });
    expect(await screen.findByText("Early: too few enquiries to pick a winner.")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "All ads (5)" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });

  it("marks a replaced ad and hides itself while the feature is off", async () => {
    await open({ ok: true, syncedAt: null, ads: [ad("1", { replaced: true, results: 2, spend: 300, costPerResult: 150 })] });
    expect(await screen.findByText("(replaced)")).toBeInTheDocument();
    const off = await open({ error: "Not found" }, 404);
    await vi.waitFor(() => expect(off.container.querySelector("details")).toBeNull());
  });

  it("offers Run this again only when there's a Best ad (#1050)", async () => {
    const runAgain = vi.fn();
    await open({ ok: true, syncedAt: null, ads: [ad("1", { best: true, results: 6, spend: 600, costPerResult: 100 }), ad("2", { results: 1, spend: 300, costPerResult: 300 })] }, 200, runAgain);
    fireEvent.click(await screen.findByRole("button", { name: "Run this again" }));
    expect(runAgain).toHaveBeenCalledOnce();
    expect(screen.getByText(/Nothing goes to Meta until you review and send it, paused/)).toBeInTheDocument();
  });

  it("doesn't offer it without a winner", async () => {
    await open({ ok: true, syncedAt: null, ads: [ad("1", { results: 1, spend: 70, costPerResult: 70 })] }, 200, vi.fn());
    expect(await screen.findByText("Early: too few enquiries to pick a winner.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run this again" })).not.toBeInTheDocument();
  });
});
