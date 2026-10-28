import { describe, expect, it } from "vitest";
import { adCreativeLinks, adResultsEnabled, adResultViews, saveAdResults, type StoredAdResult } from "@/lib/campaign/ad-results-store";

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

  // Designer on #783: "Ad 1…6" can't be told apart. Solaride's live lever-2 WhatsApp campaign as stored in production
  // (read-only, Oct 27): 3 creatives, launched into the source ad set, then copied into a capped ad set.
  const lever2 = {
    meta_campaign_id: "120253727697100526", meta_adset_id: "120253727715030526",
    meta_ad_ids: ["120253727718190526", "120253727719900526", "120253727727100526", "120253729106880526", "120253729109680526", "120253729111000526"],
    raw: { source: "campaign_operation", cappedAdSetIds: ["120253729106020526"], metaResult: {
      campaignId: "120253727697100526", adSetIds: ["120253727715030526", "120253729106020526"],
      adIds: ["120253727718190526", "120253727719900526", "120253727727100526", "120253729106880526", "120253729109680526", "120253729111000526"],
    } },
  };
  const creativeIds = ["856f2b99", "b4de03af", "8758b18d"];
  const creatives = new Map([
    ["856f2b99", { headline: "Your rooftop could cut power bills", imageUrl: "https://x/value.png" }],
    ["b4de03af", { headline: "Rooftop solar, planned before install", imageUrl: "https://x/problem.png" }],
    ["8758b18d", { headline: "Diwali Offer: 10% Off Solar", imageUrl: null }],
  ]);

  it("links each ad to the AdBrain creative it was launched from; a capped run's earlier ad set is not live", () => {
    const links = adCreativeLinks(lever2, creativeIds);
    expect([...links].map(([adId, link]) => [adId.slice(-6), link.creativeId, link.live])).toEqual([
      ["190526", "856f2b99", false], ["900526", "b4de03af", false], ["100526", "8758b18d", false],
      ["880526", "856f2b99", true], ["680526", "b4de03af", true], ["000526", "8758b18d", true],
    ]);
    // Outside or older campaigns (no stored layout, or counts that don't line up) keep Meta's names.
    expect(adCreativeLinks({ ...lever2, raw: null }, creativeIds).size).toBe(0);
    expect(adCreativeLinks(lever2, creativeIds.slice(0, 2)).size).toBe(0);
  });

  it("shows each ad's headline and picture, and hides a capped run's earlier ads that never delivered", () => {
    const links = adCreativeLinks(lever2, creativeIds);
    const rows = lever2.meta_ad_ids.map((id, index) => row(id, { ad_name: index < 3 ? "Ad" : "Ad - कॉपी", delivered: false, impressions: 0, effective_status: index < 3 ? "PAUSED" : "ACTIVE" }));
    const view = adResultViews(rows, true, { links, creatives });
    expect(view.ads.map(ad => [ad.adId.slice(-6), ad.creative?.headline, ad.creative?.imageUrl ?? null, ad.earlier])).toEqual([
      ["880526", "Your rooftop could cut power bills", "https://x/value.png", false],
      ["680526", "Rooftop solar, planned before install", "https://x/problem.png", false],
      ["000526", "Diwali Offer: 10% Off Solar", null, false],
    ]);
    // An earlier ad that did deliver keeps its history, marked as from the earlier run.
    rows[0] = row(lever2.meta_ad_ids[0], { effective_status: "PAUSED", conversations: 2, spend_paise: 20_000 });
    const withHistory = adResultViews(rows, true, { links, creatives });
    expect(withHistory.ads).toHaveLength(4);
    expect(withHistory.ads.find(ad => ad.adId === lever2.meta_ad_ids[0])).toMatchObject({ earlier: true, creative: { headline: "Your rooftop could cut power bills" } });
    // Without links every row stays, under Meta's name.
    expect(adResultViews(rows, true).ads.every(ad => ad.creative === null && !ad.earlier)).toBe(true);
  });
});
