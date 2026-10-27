import { describe, expect, it } from "vitest";
import { adResultsEnabled, adResultViews, saveAdResults, type StoredAdResult } from "@/lib/campaign/ad-results-store";

// #783: the flag and the card's view of stored per-ad results.
const row = (id: string, over: Partial<StoredAdResult> = {}): StoredAdResult => ({
  meta_ad_id: id, ad_name: `Ad ${id}`, effective_status: "ACTIVE", delivered: true, impressions: 100, link_clicks: 5,
  conversations: 0, leads: 0, spend_paise: 0, synced_at: "2026-10-26T17:00:00.000Z", ...over,
});

describe("per-ad results view (#783)", () => {
  it("is off unless AD_RESULTS_ENABLED is exactly true", () => {
    expect(adResultsEnabled({})).toBe(false);
    expect(adResultsEnabled({ AD_RESULTS_ENABLED: "1" })).toBe(false);
    expect(adResultsEnabled({ AD_RESULTS_ENABLED: "true" })).toBe(true);
  });

  it("names the Best ad first, then live ads by results, archived ads last; chats for WhatsApp, enquiries otherwise", () => {
    const rows = [
      row("1", { conversations: 6, spend_paise: 60_000 }),
      row("2", { conversations: 5, spend_paise: 100_000, synced_at: "2026-10-26T17:05:00.000Z" }),
      row("3", { effective_status: "ARCHIVED", conversations: 9, spend_paise: 270_000 }),
      row("4", { delivered: false, impressions: 0 }),
    ];
    const whatsapp = adResultViews(rows, true);
    expect(whatsapp.ads.map(ad => [ad.adId, ad.best, ad.replaced])).toEqual([["1", true, false], ["2", false, false], ["4", false, false], ["3", false, true]]);
    expect(whatsapp.ads[0]).toMatchObject({ results: 6, spend: 600, costPerResult: 100 });
    expect(whatsapp.syncedAt).toBe("2026-10-26T17:05:00.000Z");
    // The same rows on a form campaign count enquiries (leads), so there are none and no Best.
    expect(adResultViews(rows, false).ads.every(ad => ad.results === 0 && !ad.best)).toBe(true);
  });

  it("has no Best ad and no update time with no rows", () => {
    expect(adResultViews([], true)).toEqual({ ads: [], syncedAt: null });
  });

  // Reviewer on #960: an ad gone from Meta's listing (deleted) is stored as DELETED, so it is replaced, never Best.
  it("stores an ad gone from the listing as DELETED and keeps it out of Best", async () => {
    let stored: StoredAdResult[] = [];
    const database = { from: () => ({ upsert: async (rows: StoredAdResult[]) => { stored = rows; return { error: null }; } }) };
    await saveAdResults(database as never, { businessId: "b", campaignId: "c", ads: [
      { adId: "9", name: null, effectiveStatus: null, creativeId: null, delivered: true, impressions: 10, clicks: 1, spend: 50, results: 9, costPerResult: 50 / 9, whatsappOpens: 1, replaced: true },
      { adId: "1", name: "Live", effectiveStatus: "ACTIVE", creativeId: null, delivered: true, impressions: 10, clicks: 1, spend: 600, results: 6, costPerResult: 100, whatsappOpens: 1, replaced: false },
    ] });
    expect(stored.map(row => row.effective_status)).toEqual(["DELETED", "ACTIVE"]);
    const view = adResultViews(stored, true);
    expect(view.ads.find(ad => ad.adId === "9")).toMatchObject({ replaced: true, best: false });
  });
});
