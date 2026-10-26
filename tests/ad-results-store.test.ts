import { describe, expect, it } from "vitest";
import { adResultsEnabled, adResultViews, type StoredAdResult } from "@/lib/campaign/ad-results-store";

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
});
