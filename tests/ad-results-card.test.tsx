// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdResults } from "@/components/ad-results";

// #783: "Which ad worked" on the campaign card (CPO + Designer notes): one quiet row per ad, "Best" as a word,
// "—" before an ad's first enquiry, "Early" while no winner, the rest behind "All ads", hidden while off.
const ad = (adId: string, over: Record<string, unknown> = {}) => ({
  adId, name: `Ad ${adId}`, delivered: true, replaced: false, best: false, impressions: 100, results: 0, spend: 0, costPerResult: null, ...over,
});
const open = async (body: unknown, status = 200) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(body, { status })));
  const view = render(<AdResults campaignId="c1" />);
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
});

describe("<AdResults> pause offer (#1045)", () => {
  const ads = [
    ad("1", { best: true, status: "ACTIVE", results: 6, spend: 600, costPerResult: 100 }),
    ad("2", { status: "ACTIVE", results: 2, spend: 500, costPerResult: 250 }),
  ];
  const openWith = (answers: Response[]) => {
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => String(input).endsWith("/ads") ? Response.json({ ok: true, syncedAt: null, ads }) : answers.shift()!);
    vi.stubGlobal("fetch", fetch);
    const view = render(<AdResults campaignId="c1" />);
    const details = view.container.querySelector("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    return fetch;
  };
  afterEach(() => window.localStorage.clear());

  it("names both ads and costs, pauses only on a tap, and offers Undo", async () => {
    const fetch = openWith([Response.json({ ok: true, result: { adId: "2", status: "PAUSED" } }), Response.json({ ok: true, result: { adId: "2", status: "ACTIVE" } })]);
    expect(await screen.findByText("“Ad 2” costs ₹250 per enquiry vs ₹100 for “Ad 1”. Pause it?")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Pause this ad" }));
    expect(await screen.findByText(/Paused “Ad 2”\. The other ads keep running\./)).toBeInTheDocument();
    expect(fetch.mock.calls[1]).toEqual(["/api/campaigns/c1/ads/2/status", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "pause", reason: "expensive" }) })]);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("“Ad 2” is running again.")).toBeInTheDocument();
    expect(JSON.parse(String(fetch.mock.calls[2][1]?.body))).toEqual({ action: "undo" });
  });

  it("Keep hides the offer for 3 days and changes nothing; a refusal is shown, not hidden", async () => {
    const fetch = openWith([]);
    fireEvent.click(await screen.findByRole("button", { name: "Keep" }));
    expect(screen.queryByText(/Pause it\?/)).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    const until = Number(window.localStorage.getItem("adbrain.keepAd.c1.2"));
    expect(until - Date.now()).toBeGreaterThan(3 * 24 * 3600 * 1000 - 5000);
  });

  it("says so, and offers no Undo, when the ad was already paused in Meta", async () => {
    openWith([Response.json({ ok: true, result: { adId: "2", status: "PAUSED", changed: false } })]);
    fireEvent.click(await screen.findByRole("button", { name: "Pause this ad" }));
    expect(await screen.findByText("“Ad 2” is already paused in Meta. AdBrain didn't change it.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("shows Meta's refusal and keeps the offer", async () => {
    openWith([Response.json({ error: "Meta didn't change the ad. Nothing changed." }, { status: 502 })]);
    fireEvent.click(await screen.findByRole("button", { name: "Pause this ad" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Meta didn't change the ad. Nothing changed.");
    expect(screen.getByRole("button", { name: "Pause this ad" })).toBeEnabled();
  });
});
