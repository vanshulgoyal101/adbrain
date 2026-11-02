import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AD_RESULT_COLUMNS, adCreativeLinks, saveAdResults } from "@/lib/campaign/ad-results-store";
import { poolAssetResults, type AssetAdLink, type AssetAdResult, type AssetCampaign, type AssetResults } from "@/lib/campaign/asset-results";
import { readAllByCursor } from "@/lib/supabase/queries";
import { recordProductEvent } from "@/lib/observability/logger";
import type { AdResult } from "@/lib/meta/insights";
import type { Campaign } from "@/lib/types";

/** Append only: refreshing or editing a creative cannot reattribute its old ads to a different photo. */
export async function recordAdAssetLinks(database: SupabaseClient, rows: AssetAdLink[]): Promise<void> {
  if (!rows.length) return;
  const { error } = await database.from("campaign_ads").upsert(rows, { onConflict: "campaign_id,meta_ad_id", ignoreDuplicates: true });
  if (error) throw new Error("Ad attribution could not be saved.");
}

type Layout = Pick<Campaign, "id" | "creative_ids" | "meta_campaign_id" | "meta_adset_id" | "meta_ad_ids" | "raw">;
const mediaSnapshot = z.object({
  version: z.literal(3),
  creatives: z.array(z.object({ id: z.uuid(), mediaAssetId: z.uuid().nullable() })).max(100),
});

/** Exact stored layouts only, including capped copies. Legacy runs without v3 media keep an unknown asset. */
export async function backfillAdAssetLinks(database: SupabaseClient, input: {
  businessId: string; campaign: Layout; ads: Pick<AdResult, "adId" | "creativeId">[];
}): Promise<void> {
  const { businessId, campaign, ads } = input;
  const links = adCreativeLinks(campaign, campaign.creative_ids ?? []);
  if (!links.size || !ads.length) return;
  const { data, error } = await database.from("campaign_learnings").select("snapshot")
    .eq("business_id", businessId).eq("campaign_id", campaign.id).maybeSingle();
  if (error) throw new Error("Launch attribution could not be loaded.");
  if (!data) {
    recordProductEvent({ kind: "workflow", name: "campaign.ad_attribution", outcome: "partial", businessId, attributes: { errorCode: "snapshot_missing" } });
    return;
  }
  const parsed = mediaSnapshot.safeParse(data?.snapshot);
  if (!parsed.success && data?.snapshot?.version === 3) throw new Error("Launch attribution is invalid.");
  const media = new Map(parsed.success ? parsed.data.creatives.map(row => [row.id, row.mediaAssetId]) : []);
  const ids = [...new Set([...media.values()].filter((id): id is string => id !== null))];
  if (ids.length) {
    const { data: assets, error: assetError } = await database.from("media_assets").select("id").eq("business_id", businessId).in("id", ids);
    if (assetError || !assets) throw new Error("Launch photos could not be loaded.");
    const available = new Set(assets.map((asset: { id: string }) => asset.id));
    for (const [creative, id] of media) if (id && !available.has(id)) media.set(creative, null);
  }
  const { data: creatives, error: creativeError } = await database.from("creatives").select("id")
    .eq("business_id", businessId).in("id", [...new Set(campaign.creative_ids ?? [])]);
  if (creativeError || !creatives) throw new Error("Launch ads could not be loaded.");
  const availableCreatives = new Set(creatives.map((creative: { id: string }) => creative.id));
  const byAd = new Map(ads.map(ad => [ad.adId, ad]));
  const perSet = campaign.creative_ids?.length ?? 0;
  const rows = [...links].flatMap(([adId, link], position): AssetAdLink[] => {
    const ad = byAd.get(adId);
    return ad ? [{
      business_id: businessId, campaign_id: campaign.id, meta_ad_id: adId, meta_creative_id: ad.creativeId,
      creative_id: availableCreatives.has(link.creativeId) ? link.creativeId : null, media_asset_id: media.get(link.creativeId) ?? null,
      variant_index: Math.floor(position / perSet), position,
    }] : [];
  });
  await recordAdAssetLinks(database, rows);
}

/** Use the owner's RLS client, not the service role. Every page also names the business explicitly. */
export async function readAssetResults(database: SupabaseClient, businessId: string, asOf = Date.now()): Promise<AssetResults> {
  try {
    const [campaigns, links, results] = await Promise.all([
      readAllByCursor<AssetCampaign>(after => {
        const query = database.from("campaigns").select("id, business_id, destination, objective, creative_ids, raw")
          .eq("business_id", businessId).order("id").limit(100);
        return after ? query.gt("id", after) : query;
      }, "Campaign attribution could not be loaded.", row => row.id),
      readAllByCursor<AssetAdLink & { id: string }>(after => {
        const query = database.from("campaign_ads").select("id, business_id, campaign_id, meta_ad_id, creative_id, media_asset_id")
          .eq("business_id", businessId).order("id").limit(100);
        return after ? query.gt("id", after) : query;
      }, "Ad attribution could not be loaded.", row => row.id),
      readAllByCursor<AssetAdResult>(after => {
        const query = database.from("ad_results").select(`id, business_id, campaign_id, period_start, period_end, ${AD_RESULT_COLUMNS}`)
          .eq("business_id", businessId).is("period_start", null).is("period_end", null).order("id").limit(100);
        return after ? query.gt("id", after) : query;
      }, "Ad results could not be loaded.", row => row.id),
    ]);
    return poolAssetResults(businessId, campaigns, links, results, asOf);
  } catch {
    recordProductEvent({ kind: "workflow", name: "campaign.asset_results", outcome: "failed", businessId });
    return { state: "unavailable" };
  }
}

/** Per-ad storage is independent of campaign-level refresh and never turns a successful read into a failure. */
export async function refreshAdAssetResults(database: SupabaseClient, input: {
  businessId: string; campaign: Layout; ads: AdResult[];
}): Promise<void> {
  try {
    if (!(await saveAdResults(database, { businessId: input.businessId, campaignId: input.campaign.id, ads: input.ads }))) {
      throw new Error("Ad results could not be saved.");
    }
  } catch {
    recordProductEvent({ kind: "workflow", name: "campaign.ad_results", outcome: "failed", businessId: input.businessId });
  }
  try {
    await backfillAdAssetLinks(database, input);
  } catch {
    recordProductEvent({ kind: "workflow", name: "campaign.ad_attribution", outcome: "failed", businessId: input.businessId });
  }
}
