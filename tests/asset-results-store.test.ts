import { beforeEach, describe, expect, it, vi } from "vitest";
import { readAssetResults, recordAdAssetLinks, backfillAdAssetLinks, refreshAdAssetResults } from "@/lib/campaign/asset-results-store";

vi.mock("@/lib/observability/logger", () => ({ recordProductEvent: vi.fn() }));
import { recordProductEvent } from "@/lib/observability/logger";

type Row = Record<string, unknown>;
function database(tables: Record<string, Row[]>, failed?: string) {
  const reads: { table: string; filters: [string, unknown][]; columns?: string }[] = [];
  const writes: { table: string; rows: Row[]; options: unknown }[] = [];
  return {
    reads, writes,
    client: { from: (table: string) => {
      const read: (typeof reads)[number] = { table, filters: [] };
      reads.push(read);
      let after: string | null = null, size = 100;
      const sets = new Map<string, readonly unknown[]>();
      const data = () => (tables[table] ?? []).filter(row => read.filters.every(([field, value]) => row[field] === value)
        && [...sets].every(([field, values]) => values.includes(row[field]))
        && (after === null || String(row.id) > after)).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, size);
      const response = () => ({ data: data(), error: table === failed ? { code: "down" } : null });
      const query = {
        select: (columns: string) => { read.columns = columns; return query; },
        eq: (field: string, value: unknown) => { read.filters.push([field, value]); return query; },
        is: (field: string, value: null) => { read.filters.push([field, value]); return query; },
        in: (field: string, values: readonly unknown[]) => { sets.set(field, values); return query; },
        order: () => query,
        limit: (count: number) => { size = count; return query; },
        gt: (_field: string, value: string) => { after = value; return query; },
        maybeSingle: async () => ({ ...response(), data: data()[0] ?? null }),
        upsert: async (rows: Row[], options: unknown) => {
          writes.push({ table, rows, options });
          return { error: table === failed ? { code: "down" } : null };
        },
        then: (resolve: (value: ReturnType<typeof response>) => unknown) => Promise.resolve(response()).then(resolve),
      };
      return query;
    } },
  };
}
const campaign = { id: "c1", business_id: "b1", destination: "whatsapp" as const, objective: "OUTCOME_ENGAGEMENT", creative_ids: ["creative1"] };
const link = { id: "l1", business_id: "b1", campaign_id: "c1", meta_ad_id: "101", creative_id: "creative1", media_asset_id: "photo1" };
const result = { id: "r1", business_id: "b1", campaign_id: "c1", meta_ad_id: "101", delivered: true, conversations: 3, leads: 8, spend_paise: 28_800, synced_at: "2026-11-02T10:00:00Z", period_start: null, period_end: null };
beforeEach(() => vi.clearAllMocks());

describe("owner-scoped asset result storage", () => {
  it("reads beyond 1000 rows and scopes every page/relationship to the business and lifetime period", async () => {
    const ads = Array.from({ length: 1001 }, (_, index) => ({ ...result, id: `r${String(index).padStart(4, "0")}`, meta_ad_id: String(1000 + index) }));
    const links = ads.map((row, index) => ({ ...link, id: `l${String(index).padStart(4, "0")}`, meta_ad_id: row.meta_ad_id }));
    const db = database({ campaigns: [campaign], campaign_ads: links, ad_results: [...ads, { ...result, id: "foreign", business_id: "b2" }] });
    const totals = await readAssetResults(db.client as never, "b1", 1);
    expect(totals.state).toBe("ready");
    if (totals.state !== "ready") throw new Error("expected scoped totals");
    expect(totals.byMedia.photo1[0]).toMatchObject({ results: 3003, spendPaise: 28_828_800 });
    expect(db.reads.every(read => read.filters.some(([field, value]) => field === "business_id" && value === "b1"))).toBe(true);
    expect(db.reads.filter(read => read.table === "ad_results").every(read => read.filters.some(([field, value]) => field === "period_start" && value === null)
      && read.filters.some(([field, value]) => field === "period_end" && value === null))).toBe(true);
  });

  it("reports unavailable rather than an empty success when a relation cannot be read", async () => {
    const db = database({ campaigns: [campaign], campaign_ads: [link], ad_results: [result] }, "ad_results");
    expect(await readAssetResults(db.client as never, "b1", 1)).toEqual({ state: "unavailable" });
    expect(recordProductEvent).toHaveBeenCalledWith(expect.objectContaining({ name: "campaign.asset_results", outcome: "failed" }));
  });

  it("inserts missing bindings without overwriting an earlier launch/media identity, and surfaces write failures", async () => {
    const db = database({});
    await recordAdAssetLinks(db.client as never, [link]);
    expect(db.writes).toEqual([{ table: "campaign_ads", rows: [link], options: { onConflict: "campaign_id,meta_ad_id", ignoreDuplicates: true } }]);
    const down = database({}, "campaign_ads");
    await expect(recordAdAssetLinks(down.client as never, [link])).rejects.toThrow();
  });

  it("does not backfill an ambiguous layout or consult a creative's current mutable media link", async () => {
    const db = database({});
    await backfillAdAssetLinks(db.client as never, { campaign: { ...campaign, meta_ad_ids: ["101"], meta_adset_id: "1", meta_campaign_id: "2", raw: null }, businessId: "b1", ads: [] });
    expect(db.writes).toEqual([]);
    expect(db.reads.some(read => read.table === "creatives" && read.columns !== "id")).toBe(false);
  });

  it("backfills exact capped layouts from immutable v3 media, never a creative's new photo", async () => {
    const creativeId = "00000000-0000-4000-8000-000000000001";
    const mediaId = "00000000-0000-4000-8000-000000000002";
    const db = database({
      campaign_learnings: [{ id: "s1", business_id: "b1", campaign_id: "c1", snapshot: { version: 3, creatives: [{ id: creativeId, mediaAssetId: mediaId }] } }],
      media_assets: [{ id: mediaId, business_id: "b1" }],
      creatives: [{ id: creativeId, business_id: "b1", media_asset_id: "a-different-photo" }],
    });
    await backfillAdAssetLinks(db.client as never, {
      businessId: "b1", campaign: { ...campaign, creative_ids: [creativeId], meta_campaign_id: "1", meta_adset_id: "2", meta_ad_ids: ["101", "102"],
        raw: { source: "campaign_operation", metaResult: { campaignId: "1", adSetIds: ["2", "3"], adIds: ["101", "102"] }, cappedAdSetIds: ["3"] } },
      ads: [{ adId: "101", creativeId: "501" }, { adId: "102", creativeId: "501" }],
    });
    expect(db.writes[0].rows.map(row => [row.meta_ad_id, row.creative_id, row.media_asset_id])).toEqual([["101", creativeId, mediaId], ["102", creativeId, mediaId]]);
    expect(db.reads.some(read => read.table === "creatives" && read.columns !== "id")).toBe(false);
    expect(db.reads.every(read => read.table === "campaign_ads" || read.filters.some(([field, value]) => field === "business_id" && value === "b1"))).toBe(true);
  });

  it("surfaces snapshot failures instead of permanently writing unknown media", async () => {
    const db = database({}, "campaign_learnings");
    await expect(backfillAdAssetLinks(db.client as never, {
      businessId: "b1", campaign: { ...campaign, meta_campaign_id: "1", meta_adset_id: "2", meta_ad_ids: ["101"],
        raw: { source: "campaign_operation", metaResult: { campaignId: "1", adSetIds: ["2"], adIds: ["101"] } } },
      ads: [{ adId: "101", creativeId: "501" }],
    })).rejects.toThrow("Launch attribution could not be loaded.");
    expect(db.writes).toEqual([]);
  });

  it("does not race a pending launch by permanently binding missing snapshot media to null", async () => {
    const db = database({});
    await backfillAdAssetLinks(db.client as never, {
      businessId: "b1", campaign: { ...campaign, meta_campaign_id: "1", meta_adset_id: "2", meta_ad_ids: ["101"],
        raw: { source: "campaign_operation", metaResult: { campaignId: "1", adSetIds: ["2"], adIds: ["101"] } } },
      ads: [{ adId: "101", creativeId: "501" }],
    });
    expect(db.writes).toEqual([]);
    expect(recordProductEvent).toHaveBeenCalledWith(expect.objectContaining({ name: "campaign.ad_attribution", outcome: "partial" }));
  });

  describe("an unverified launch photo (#789 QA holds)", () => {
    const [first, second, third] = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000005"];
    const [launchPhoto, newPhoto] = ["00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000004"];
    const launchedAt = "2026-11-03T08:00:00.000Z";
    const before = "2026-11-03T07:00:00.000Z";
    const tables = (creatives: Record<string, unknown>[], assets = [launchPhoto, newPhoto]) => ({
      campaign_learnings: [{ business_id: "b1", campaign_id: "c1", snapshot: { version: 3, mediaUnknownAt: launchedAt, creatives: [first, second, third].map(id => ({ id, mediaAssetId: null })) } }],
      creatives: creatives.map(row => ({ business_id: "b1", ...row })),
      media_assets: assets.map(id => ({ id, business_id: "b1", kind: "image", source: "upload" })),
    });
    const input = {
      businessId: "b1", campaign: { ...campaign, creative_ids: [first, second, third], meta_campaign_id: "1", meta_adset_id: "2", meta_ad_ids: ["101", "102", "103"],
        raw: { source: "campaign_operation", metaResult: { campaignId: "1", adSetIds: ["2"], adIds: ["101", "102", "103"] } } },
      ads: ["101", "102", "103"].map(adId => ({ adId, creativeId: `5${adId}`, ...result })),
    };
    const links = (db: ReturnType<typeof database>) => db.writes.filter(write => write.table === "campaign_ads").flatMap(write => write.rows as { meta_ad_id: string; media_asset_id: string | null }[]);

    it("writes nothing while the photos can't be read, then links only creatives untouched since launch", async () => {
      const rows = [
        { id: first, media_asset_id: launchPhoto, updated_at: before },
        { id: second, media_asset_id: null, updated_at: before },
        { id: third, media_asset_id: launchPhoto, updated_at: before },
      ];
      const down = database(tables(rows), "creatives");
      await refreshAdAssetResults(down.client as never, input as never);
      expect(links(down)).toEqual([]);
      expect(recordProductEvent).toHaveBeenCalledWith(expect.objectContaining({ name: "campaign.ad_attribution", outcome: "failed" }));

      const healthy = database(tables(rows));
      await refreshAdAssetResults(healthy.client as never, input as never);
      expect(links(healthy)).toEqual([
        expect.objectContaining({ meta_ad_id: "101", creative_id: first, media_asset_id: launchPhoto }),
        expect.objectContaining({ meta_ad_id: "102", creative_id: second, media_asset_id: null }),
        expect.objectContaining({ meta_ad_id: "103", creative_id: third, media_asset_id: launchPhoto }),
      ]);
      expect(healthy.reads.filter(read => !["campaign_ads", "ad_results"].includes(read.table)).every(read => read.filters.some(([field, value]) => field === "business_id" && value === "b1"))).toBe(true);
    });

    it("keeps unknown an ad whose creative was relinked or edited after (or just before) launch, never giving it the new photo", async () => {
      const db = database(tables([
        { id: first, media_asset_id: launchPhoto, updated_at: before },
        { id: second, media_asset_id: newPhoto, updated_at: "2026-11-03T09:00:00.000Z" },
        { id: third, media_asset_id: newPhoto, updated_at: "2026-11-03T07:59:30.000Z" },
      ]));
      await refreshAdAssetResults(db.client as never, input as never);
      expect(links(db)).toEqual([expect.objectContaining({ meta_ad_id: "101", media_asset_id: launchPhoto })]);
      expect(recordProductEvent).toHaveBeenCalledWith(expect.objectContaining({ name: "campaign.ad_attribution", outcome: "partial", attributes: { errorCode: "media_unverified" } }));
    });

    it("keeps unknown an ad whose photo is missing from the asset read, instead of binding it to no photo", async () => {
      const db = database(tables([
        { id: first, media_asset_id: launchPhoto, updated_at: before },
        { id: second, media_asset_id: newPhoto, updated_at: before },
      ], [newPhoto]));
      await refreshAdAssetResults(db.client as never, input as never);
      expect(links(db)).toEqual([expect.objectContaining({ meta_ad_id: "102", creative_id: second, media_asset_id: newPhoto })]);
    });
  });

  it("keeps historical media results when the creative or its photo was deleted or moved to another business", async () => {
    const creativeId = "00000000-0000-4000-8000-000000000001";
    const mediaId = "00000000-0000-4000-8000-000000000002";
    const db = database({
      campaign_learnings: [{ business_id: "b1", campaign_id: "c1", snapshot: { version: 3, creatives: [{ id: creativeId, mediaAssetId: mediaId }] } }],
      creatives: [{ id: creativeId, business_id: "b2" }],
      media_assets: [{ id: mediaId, business_id: "b2" }],
    });

    await backfillAdAssetLinks(db.client as never, {
      businessId: "b1", campaign: { ...campaign, creative_ids: [creativeId], meta_campaign_id: "1", meta_adset_id: "2", meta_ad_ids: ["101"],
        raw: { source: "campaign_operation", metaResult: { campaignId: "1", adSetIds: ["2"], adIds: ["101"] } } },
      ads: [{ adId: "101", creativeId: "501" }],
    });
    expect(db.writes[0].rows[0]).toMatchObject({ creative_id: null, media_asset_id: null, meta_ad_id: "101" });
  });

  it("backfills legacy creative-only bindings even when the per-ad result save fails, logging the failure", async () => {
    const db = database({
      campaign_learnings: [{ business_id: "b1", campaign_id: "c1", snapshot: { version: 2 } }],
      creatives: [{ id: "creative1", business_id: "b1" }],
    }, "ad_results");
    await refreshAdAssetResults(db.client as never, {
      businessId: "b1", campaign: { ...campaign, meta_campaign_id: "1", meta_adset_id: "2", meta_ad_ids: ["101"],
        raw: { source: "campaign_operation", metaResult: { campaignId: "1", adSetIds: ["2"], adIds: ["101"] } } },
      ads: [{ adId: "101", name: null, effectiveStatus: "PAUSED", creativeId: "501", delivered: true, impressions: 100, clicks: 4, whatsappOpens: 4, spend: 96, results: 3, costPerResult: 32, replaced: false }],
    });
    expect(db.writes.find(write => write.table === "campaign_ads")?.rows[0]).toMatchObject({ creative_id: "creative1", media_asset_id: null });
    expect(recordProductEvent).toHaveBeenCalledWith(expect.objectContaining({ name: "campaign.ad_results", outcome: "failed" }));
  });
});
