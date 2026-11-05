import { describe, expect, it } from "vitest";
import { buildAdAssetLinks, poolAssetResults, type AssetCampaign, type AssetAdLink, type AssetAdResult } from "@/lib/campaign/asset-results";

const campaign = (over: Partial<AssetCampaign> = {}): AssetCampaign => ({
  id: "c1", business_id: "b1", destination: "whatsapp", objective: "OUTCOME_ENGAGEMENT",
  creative_ids: ["creative1", "creative2"], ...over,
});
const link = (over: Partial<AssetAdLink> = {}): AssetAdLink => ({
  business_id: "b1", campaign_id: "c1", meta_ad_id: "101", creative_id: "creative1", media_asset_id: "photo1", ...over,
});
const result = (over: Partial<AssetAdResult> = {}): AssetAdResult => ({
  id: "r1", business_id: "b1", campaign_id: "c1", meta_ad_id: "101", ad_name: null, effective_status: "PAUSED",
  delivered: true, impressions: 100, link_clicks: 9, conversations: 3, leads: 20, landing_page_views: 90,
  spend_paise: 28_800, synced_at: "2026-11-02T10:00:00Z", period_start: null, period_end: null, ...over,
});
const asOf = Date.parse("2026-11-02T12:00:00Z");

describe("immutable launch asset bindings", () => {
  it("uses explicit checkpoint indices, including the last placement fallback creative", () => {
    const rows = buildAdAssetLinks({
      businessId: "b1", campaignId: "c1", creativeIds: ["creative1", "creative2"],
      mediaByCreative: new Map([["creative1", "photo1"]]),
      events: [
        { phase: "creative", externalId: "501", variantIndex: 0, creativeIndex: 1 },
        { phase: "creative", externalId: "502", variantIndex: 0, creativeIndex: 1 },
        { phase: "ad", externalId: "102", variantIndex: 0, creativeIndex: 1 },
        { phase: "creative", externalId: "503", variantIndex: 1, creativeIndex: 0 },
        { phase: "ad", externalId: "103", variantIndex: 1, creativeIndex: 0 },
      ],
    });
    expect(rows).toEqual([
      { business_id: "b1", campaign_id: "c1", meta_ad_id: "102", meta_creative_id: "502", creative_id: "creative2", media_asset_id: null, variant_index: 0, position: 1 },
      { business_id: "b1", campaign_id: "c1", meta_ad_id: "103", meta_creative_id: "503", creative_id: "creative1", media_asset_id: "photo1", variant_index: 1, position: 2 },
    ]);
  });

  it("does not guess a creative for legacy or malformed checkpoint metadata", () => {
    expect(buildAdAssetLinks({ businessId: "b1", campaignId: "c1", creativeIds: ["creative1"], mediaByCreative: new Map(), events: [
      { phase: "ad", externalId: "101" },
      { phase: "ad", externalId: "102", variantIndex: 0, creativeIndex: 8 },
      { phase: "ad", externalId: "103", variantIndex: -1, creativeIndex: 0 },
    ] })).toEqual([]);
  });
});

describe("asset result pooling", () => {
  it("sums shared media across ads/campaigns once, keeps creatives separate, and uses the oldest latest read", () => {
    const pooled = poolAssetResults("b1", [campaign(), campaign({ id: "c2" })], [
      link(), link({ meta_ad_id: "102", creative_id: "creative2" }), link({ campaign_id: "c2", meta_ad_id: "101" }),
    ], [result(), result(), result({ id: "r2", meta_ad_id: "102", conversations: 2, spend_paise: 19_200, synced_at: "2026-11-02T11:00:00Z" }),
      result({ id: "r3", campaign_id: "c2", conversations: 1, spend_paise: 9_600 })], asOf);
    expect(pooled.byMedia.photo1).toEqual([{ destination: "whatsapp", objective: "OUTCOME_ENGAGEMENT", results: 6, spendPaise: 57_600, delivered: true, syncedAt: "2026-11-02T10:00:00Z" }]);
    expect(pooled.byCreative.creative1[0].results).toBe(4);
    expect(pooled.byCreative.creative2[0].results).toBe(2);
    expect(pooled).toMatchObject({ state: "ready", unmatched: 0, asOf });
  });

  it("never pools chats, form leads and website visits together", () => {
    const pooled = poolAssetResults("b1", [campaign(), campaign({ id: "c2", destination: "instant_form", objective: "leads" }),
      campaign({ id: "c3", destination: "website", objective: "traffic" })], [
      link(), link({ campaign_id: "c2" }), link({ campaign_id: "c3" }),
    ], [result(), result({ id: "r2", campaign_id: "c2" }), result({ id: "r3", campaign_id: "c3" })], asOf);
    expect(pooled.byMedia.photo1.map((row) => [row.destination, row.results])).toEqual([["whatsapp", 3], ["instant_form", 20], ["website", 90]]);
  });

  it("uses a legacy snapshot's destination and pools equivalent objective aliases without losing newer zeroes", () => {
    const pooled = poolAssetResults("b1", [
      campaign({ destination: "unknown", raw: { metaResult: { destination: "whatsapp" } } }),
      campaign({ id: "c2", objective: "messages" }),
    ], [link(), link({ campaign_id: "c2" })], [
      result(), result({ id: "new", conversations: 0, synced_at: "2026-11-02T11:00:00Z" }),
      result({ id: "other", campaign_id: "c2", conversations: 2 }),
    ], asOf);
    expect(pooled.byMedia.photo1).toHaveLength(1);
    expect(pooled.byMedia.photo1[0]).toMatchObject({ results: 2, spendPaise: 57_600, syncedAt: "2026-11-02T10:00:00Z" });
  });

  it("joins by business, campaign and ad; ignores dated rows and retains deleted-creative media history", () => {
    const pooled = poolAssetResults("b1", [campaign()], [
      link({ creative_id: null }), link({ business_id: "b2", media_asset_id: "foreign" }),
    ], [result(), result({ business_id: "b2" }), result({ campaign_id: "c2" }), result({ period_start: "2026-11-01" })], asOf);
    expect(Object.keys(pooled.byMedia)).toEqual(["photo1"]);
    expect(pooled.byMedia.photo1[0].results).toBe(3);
    expect(pooled.byCreative).toEqual({});
  });

  it("keeps no delivery, genuine zero, absent attribution and unsupported outcomes distinct", () => {
    const zero = poolAssetResults("b1", [campaign()], [link()], [result({ conversations: 0, delivered: false, impressions: 0, spend_paise: 0 })], asOf);
    expect(zero.byMedia.photo1[0]).toMatchObject({ results: 0, spendPaise: 0, delivered: false });
    const unmatched = poolAssetResults("b1", [campaign()], [], [result()], asOf);
    expect(unmatched).toMatchObject({ byMedia: {}, unmatched: 1 });
    expect(poolAssetResults("b1", [campaign({ destination: "unknown", objective: "unknown" })], [link()], [result()], asOf).byMedia).toEqual({});
  });

  it("does not silently round unsafe pooled totals", () => {
    expect(() => poolAssetResults("b1", [campaign()], [link(), link({ meta_ad_id: "102" })], [
      result({ conversations: Number.MAX_SAFE_INTEGER }), result({ id: "r2", meta_ad_id: "102" }),
    ], asOf)).toThrow();
  });
});
