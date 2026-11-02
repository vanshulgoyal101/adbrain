// @vitest-environment jsdom
import { fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdResults, useWeakAd } from "@/components/ad-results";
import hi from "../messages/hi.json";

// #783: "Which ad worked" on the campaign card (CPO + Designer notes): one quiet row per ad, "Best" as a word,
// "—" before an ad's first enquiry, "Early" while no winner, the rest behind "All ads", hidden while off.
const ad = (adId: string, over: Record<string, unknown> = {}) => ({
  adId, name: `Ad ${adId}`, delivered: true, replaced: false, best: false, creative: null, earlier: false, impressions: 100, results: 0, spend: 0, costPerResult: null, ...over,
});
const open = async (body: unknown, status = 200, onRunAgain?: () => void, runAgainError?: string) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(body, { status })));
  const view = render(<AdResults campaignId="c1" onRunAgain={onRunAgain} runAgainError={runAgainError} />);
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

  const ours = { headline: "Free site survey", imageUrl: null };
  it("offers Run this again only when there's a Best ad (#1050)", async () => {
    const runAgain = vi.fn();
    await open({ ok: true, syncedAt: null, ads: [ad("1", { best: true, creative: ours, results: 6, spend: 600, costPerResult: 100 }), ad("2", { results: 1, spend: 300, costPerResult: 300 })] }, 200, runAgain);
    fireEvent.click(await screen.findByRole("button", { name: "Run this again" }));
    expect(runAgain).toHaveBeenCalledOnce();
    expect(screen.getByText(/Nothing goes to Meta until you review and send it, paused/)).toBeInTheDocument();
  });

  it("doesn't offer it when the Best ad wasn't made in AdBrain: there's nothing to copy (Designer, #1050)", async () => {
    await open({ ok: true, syncedAt: null, ads: [ad("1", { best: true, results: 6, spend: 600, costPerResult: 100 })] }, 200, vi.fn());
    expect(await screen.findByText("Best")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run this again" })).not.toBeInTheDocument();
  });

  it("shows a copy error under the button, where the tap was (Designer, #1050)", async () => {
    await open({ ok: true, syncedAt: null, ads: [ad("1", { best: true, creative: ours, results: 6, spend: 600, costPerResult: 100 })] }, 200, vi.fn(), "This campaign couldn't be copied. Try again.");
    const button = await screen.findByRole("button", { name: "Run this again" });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("This campaign couldn't be copied. Try again.");
    expect(button.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("doesn't offer it without a winner", async () => {
    await open({ ok: true, syncedAt: null, ads: [ad("1", { results: 1, spend: 70, costPerResult: 70 })] }, 200, vi.fn());
    expect(await screen.findByText("Early: too few enquiries to pick a winner.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run this again" })).not.toBeInTheDocument();
  });
});

describe("<AdResults> pause offer (#1045)", () => {
  const ads: (Omit<ReturnType<typeof ad>, "name" | "creative"> & { name: string; creative: { headline: string; imageUrl: string | null } | null })[] = [
    ad("1", { best: true, status: "ACTIVE", results: 6, spend: 600, costPerResult: 100 }),
    ad("2", { status: "ACTIVE", results: 2, spend: 500, costPerResult: 250 }),
  ];
  const openWith = (answers: Response[], whatsapp = false) => {
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => String(input).endsWith("/ads") ? Response.json({ ok: true, syncedAt: null, ads }) : answers.shift()!);
    vi.stubGlobal("fetch", fetch);
    const view = render(<AdResults campaignId="c1" whatsapp={whatsapp} />);
    const details = view.container.querySelector("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    return fetch;
  };
  afterEach(() => window.localStorage.clear());

  it("names the ads in the offer by headline, like the rows (Designer on #783)", async () => {
    ads[0] = { ...ads[0], creative: { headline: "Cut power bills", imageUrl: null } };
    ads[1] = { ...ads[1], name: "Solaride | Lever 2 | WhatsApp | Ad 3", creative: { headline: "Free site survey", imageUrl: null } };
    try {
      openWith([], true);
      expect(await screen.findByText("“Free site survey” costs ₹250 per chat vs ₹100 for “Cut power bills”. Pause it?")).toBeInTheDocument();
    } finally {
      ads[0] = { ...ads[0], creative: null };
      ads[1] = { ...ads[1], name: "Ad 2", creative: null };
    }
  });

  it("says chats on a WhatsApp campaign, with Pause as an outline button (Designer on #1048)", async () => {
    openWith([], true);
    expect(await screen.findByText("“Ad 2” costs ₹250 per chat vs ₹100 for “Ad 1”. Pause it?")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("per chat");
    expect(screen.getByRole("button", { name: "Pause this ad" }).className).toContain("border-slate-300");
    expect(screen.getByRole("button", { name: "Pause this ad" }).className).not.toContain("bg-slate-900");
  });

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

  // Designer on #783: AdBrain's own ads read by picture and headline; outside ads keep Meta's name.
  it("shows an AdBrain ad's thumbnail and headline, and Meta's name for an outside ad", async () => {
    const original = "https://p.supabase.co/storage/v1/object/public/creatives/b/c/originals-v1/value-ad.png";
    await open({ ok: true, syncedAt: null, ads: [
      ad("1", { name: "Solaride | Lever 2 | Ad 4", creative: { headline: "Your rooftop could cut power bills", imageUrl: original } }),
      ad("2", { name: "Ad - कॉपी", earlier: true, creative: { headline: "Rooftop solar, planned before install", imageUrl: null } }),
      ad("3", { name: "Outside ad" }),
    ] });
    const rows = await screen.findAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Your rooftop could cut power bills");
    expect(rows[0]).not.toHaveTextContent("Lever 2");
    const image = rows[0].querySelector("img")!;
    expect(image.getAttribute("src")).toBe("https://p.supabase.co/storage/v1/object/public/creatives/b/c/thumbnails-v1/value-ad.webp");
    expect(image).toHaveAttribute("width", "40");
    expect(rows[1]).toHaveTextContent("Rooftop solar, planned before install(earlier run)");
    expect(rows[1].querySelector("img")).toBeNull();
    expect(rows[2]).toHaveTextContent("Outside ad");
  });
});

// #1274 slice 2c: the card's sentence reads the same stored rows to name a weak ad; the details don't offer it twice.
describe("useWeakAd (#1274)", () => {
  const rows = [ad("1", { best: true, status: "ACTIVE", results: 6, spend: 600, costPerResult: 100 }), ad("2", { status: "ACTIVE", results: 2, spend: 600, costPerResult: 300 })];
  afterEach(() => window.localStorage.clear());

  it("returns the ad worth pausing from the stored rows, and nothing while disabled", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true, ads: rows }));
    vi.stubGlobal("fetch", fetch);
    const off = renderHook(() => useWeakAd("c1", false));
    expect(off.result.current[0]).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    const on = renderHook(() => useWeakAd("c1", true));
    await vi.waitFor(() => expect(on.result.current[0]?.ad.adId).toBe("2"));
    expect(fetch).toHaveBeenCalledWith("/api/campaigns/c1/ads");
  });

  it("stays quiet after Keep, when the feature is off, or when the read fails", async () => {
    window.localStorage.setItem("adbrain.keepAd.c1.2", String(Date.now() + 60_000));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, ads: rows })));
    const kept = renderHook(() => useWeakAd("c1", true));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Not found" }, { status: 404 })));
    const off = renderHook(() => useWeakAd("c2", true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(kept.result.current[0]).toBeNull();
    expect(off.result.current[0]).toBeNull();
  });

  it("Which ad worked doesn't repeat the offer the card's sentence already makes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, syncedAt: null, ads: rows })));
    const view = render(<AdResults campaignId="c1" offerPause={false} />);
    const details = view.container.querySelector("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(await screen.findAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Pause this ad" })).not.toBeInTheDocument();
  });
});

// #1438 (CPO's Screen 2 table): "Which ad worked" and the pause offer in Hindi.
describe("<AdResults> in Hindi (#1438)", () => {
  afterEach(() => window.localStorage.clear());

  it("words the rows, the age and the pause offer in Hindi; chats stay चैट", async () => {
    const ads = [ad("1", { best: true, status: "ACTIVE", results: 6, spend: 600, costPerResult: 100 }), ad("2", { status: "ACTIVE", results: 2, spend: 500, costPerResult: 250 })];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, syncedAt: new Date(Date.now() - 3 * 3600_000).toISOString(), ads })));
    const view = render(<AdResults campaignId="c1" whatsapp words={{ locale: "hi", messages: hi.verdict }} />);
    expect(view.getByText("कौन सा विज्ञापन काम आया")).toBeInTheDocument();
    const details = view.container.querySelector("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(await screen.findByText("“Ad 2” में हर चैट ₹250 की है, जबकि “Ad 1” में ₹100। इसे रोकें?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "यह विज्ञापन रोकें" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "चलने दें" })).toBeInTheDocument();
    expect(screen.getByText("सबसे अच्छा")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("6 चैट");
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("हर चैट ₹100");
    expect(screen.getByText("3 घंटे पहले अपडेट हुआ")).toBeInTheDocument();
  });
});
