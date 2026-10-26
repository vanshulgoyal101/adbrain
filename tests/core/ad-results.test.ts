import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/ad-results.json";
import { MetaClient } from "@/lib/meta/client";
import { bestAd, decodeAdResults, type AdResult } from "@/lib/meta/insights";
import { adResultViews, saveAdResults, type StoredAdResult } from "@/lib/campaign/ad-results-store";

// #783/#789: per-ad results. Meta's real read-only answers for Solaride's live WhatsApp campaign (#499), recorded
// by scripts/record-meta-ad-results.ts: 6 ads, of which Meta lists insights only for the 3 that delivered.
type Exchange = { method: string; path: string; status: number; body: unknown };
const tape = recorded.tape as Exchange[];
const creds = { adAccountId: "act_2398686420592052", pageId: "885223068001054", accessToken: "test-token" };

function replay() {
  const pending = [...tape];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const method = init?.method ?? "GET";
    if (method !== "GET") throw new Error(`Per-ad results are read-only; got ${method} ${url.pathname}`);
    const path = url.pathname.replace("/v21.0/", "") + url.search;
    const index = pending.findIndex(exchange => exchange.path === path);
    if (index < 0) throw new Error(`Unrecorded Graph call: ${path}`);
    const [exchange] = pending.splice(index, 1);
    return Response.json(exchange.body, { status: exchange.status });
  });
  return pending;
}

afterEach(() => vi.restoreAllMocks());

describe("core: results per ad (#783)", () => {
  it("lists every ad, including the ones Meta hasn't delivered, and the ads add up to the campaign total", async () => {
    const pending = replay();
    const meta = new MetaClient(creds);
    const ads = await meta.getAdResults(recorded.campaignId);
    const total = await meta.getCampaignInsights(recorded.campaignId);
    expect(pending).toEqual([]);
    expect(ads).toHaveLength(6);
    expect(ads.filter(ad => ad.delivered)).toHaveLength(3);
    for (const ad of ads.filter(item => !item.delivered)) expect(ad).toMatchObject({ impressions: 0, clicks: 0, spend: 0, results: 0, costPerResult: null });
    const sum = (pick: (ad: AdResult) => number) => ads.reduce((acc, ad) => acc + pick(ad), 0);
    expect(sum(ad => ad.spend)).toBeCloseTo(total.spend, 2);
    expect(sum(ad => ad.results)).toBe(total.conversations);
    // Meta's per-ad counts can differ from the campaign's by rounding (recorded: 1985 vs 1984 impressions), #789's 2%.
    const within2Percent = (value: number, reference: number) => expect(Math.abs(value - reference)).toBeLessThanOrEqual(Math.max(1, reference * 0.02));
    within2Percent(sum(ad => ad.impressions), total.impressions);
    within2Percent(sum(ad => ad.whatsappOpens ?? 0), total.whatsappOpens ?? 0);
    // One chat in the whole campaign: far too early to call a winner.
    expect(bestAd(ads)).toBeNull();
    expect(ads.some(ad => ad.replaced)).toBe(false);
  });

  // QA on #943: Meta's default listing leaves out ARCHIVED ads (an audience rebuild archives them) and can't list
  // DELETED ones, but level=ad insights keep their delivery. The listing now asks for every status; an insights row
  // for an ad still missing from it is kept as "replaced", so totals add up. No such ad exists on the account
  // today (25 campaigns probed read-only, Oct 26), so this case reuses the recorded bodies with one ad removed
  // from the listing and one marked ARCHIVED.
  it("keeps an archived or deleted ad's delivery as a replaced ad instead of failing", () => {
    const body = (fragment: string) => tape.find(exchange => exchange.path.includes(fragment))!.body as { data: Array<{ id?: string; ad_id?: string; effective_status?: string }> };
    const listing = body("/ads?");
    const insights = body("/insights?level=ad");
    const [deleted, archived] = insights.data.map(row => row.ad_id!);
    const ads = decodeAdResults(
      { data: listing.data.filter(ad => ad.id !== deleted).map(ad => ad.id === archived ? { ...ad, effective_status: "ARCHIVED" } : ad) },
      insights, "whatsapp",
    );
    expect(ads).toHaveLength(6);
    expect(ads.find(ad => ad.adId === deleted)).toMatchObject({ replaced: true, name: null, delivered: true });
    expect(ads.find(ad => ad.adId === archived)).toMatchObject({ replaced: true, effectiveStatus: "ARCHIVED" });
    expect(ads.filter(ad => ad.replaced)).toHaveLength(2);
  });
});

// #783 PR 3: what the refresh stores and what the card reads back, on the same recorded campaign.
describe("core: stored per-ad results round-trip (#783)", () => {
  it("stores one lifetime row per ad and reads back the same totals, with no 'Best' at one chat", async () => {
    replay();
    const meta = new MetaClient(creds);
    const ads = await meta.getAdResults(recorded.campaignId);
    const total = await meta.getCampaignInsights(recorded.campaignId);
    let stored: StoredAdResult[] = [];
    const database = { from: () => ({ upsert: async (rows: StoredAdResult[]) => { stored = rows; return { error: null }; } }) };
    expect(await saveAdResults(database as never, { businessId: "b", campaignId: "c", ads })).toBe(true);
    expect(stored).toHaveLength(6);
    const view = adResultViews(stored, true);
    expect(view.ads.reduce((sum, ad) => sum + ad.spend, 0)).toBeCloseTo(total.spend, 2);
    expect(view.ads.reduce((sum, ad) => sum + ad.results, 0)).toBe(total.conversations);
    expect(view.ads.some(ad => ad.best)).toBe(false);
    expect(view.ads.filter(ad => !ad.delivered)).toHaveLength(3);
    expect(view.ads[0].results).toBe(1);
    expect(view.syncedAt).toEqual(expect.any(String));
  });
});

describe("the 'Best so far' rule (#783 CPO spec)", () => {
  const ad = (adId: string, results: number, spend: number): AdResult => ({
    adId, name: null, effectiveStatus: "ACTIVE", creativeId: null, delivered: spend > 0, impressions: 0, clicks: 0, spend,
    results, costPerResult: results > 0 ? spend / results : null, replaced: false,
  });

  it("never names a winner under 5 results", () => {
    expect(bestAd([ad("a", 4, 200), ad("b", 1, 500)])).toBeNull();
  });

  it("names the cheapest ad with at least 5 results when it is at least 30% cheaper than the next", () => {
    expect(bestAd([ad("a", 5, 500), ad("b", 4, 600), ad("c", 0, 0)])?.adId).toBe("a"); // ₹100 vs ₹150
    expect(bestAd([ad("a", 5, 500), ad("b", 4, 520)])).toBeNull(); // ₹100 vs ₹130: not 30% cheaper
  });

  it("never names a replaced (archived) ad, though it still counts as a comparison", () => {
    expect(bestAd([{ ...ad("a", 9, 450), replaced: true }, ad("b", 5, 1000)])).toBeNull(); // b ₹200 vs a's ₹50
    expect(bestAd([ad("a", 6, 600), { ...ad("b", 2, 400), replaced: true }])?.adId).toBe("a"); // ₹100 vs ₹200
  });

  it("counts an ad that spent without results as costing at least its spend, and ignores ads Meta never showed", () => {
    expect(bestAd([ad("a", 6, 600), ad("b", 0, 200)])?.adId).toBe("a"); // ₹100 vs at least ₹200
    expect(bestAd([ad("a", 6, 600), ad("b", 0, 120)])).toBeNull(); // ₹100 vs at least ₹120: can't tell yet
    expect(bestAd([ad("a", 6, 600), ad("b", 0, 0)])).toBeNull(); // nothing to compare with
  });
});
