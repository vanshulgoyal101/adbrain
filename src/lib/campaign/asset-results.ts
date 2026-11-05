import { campaignDestination, outcomeDefinition } from "@/lib/campaign/outcomes";
import type { CampaignMutationCheckpoint } from "@/lib/meta/client";
import type { Campaign } from "@/lib/types";
import type { StoredAdResult } from "./ad-results-store";

export type AssetCampaign = Pick<Campaign, "id" | "business_id" | "destination" | "objective" | "creative_ids"> & { raw?: Campaign["raw"] };
export type AssetAdLink = {
  business_id: string; campaign_id: string; meta_ad_id: string;
  creative_id: string | null; media_asset_id: string | null;
  meta_creative_id?: string | null; variant_index?: number; position?: number;
};
export type AssetAdResult = StoredAdResult & {
  id: string; business_id: string; campaign_id: string; period_start: string | null; period_end: string | null;
};
export type AssetTotals = {
  destination: string; objective: string; results: number; spendPaise: number; delivered: boolean; syncedAt: string;
};
export type AssetResults = {
  state: "ready"; byMedia: Record<string, AssetTotals[]>; byCreative: Record<string, AssetTotals[]>; unmatched: number; asOf: number;
} | { state: "unavailable" };

/** Checkpoint indices name the reviewed creative; the latest creative event includes any placement fallback. */
export function buildAdAssetLinks(input: {
  businessId: string; campaignId: string; creativeIds: string[];
  mediaByCreative: ReadonlyMap<string, string | null>; events: readonly CampaignMutationCheckpoint[];
}): AssetAdLink[] {
  const creatives = new Map<string, string>();
  const ads = new Map<string, AssetAdLink>();
  for (const event of input.events) {
    const { variantIndex, creativeIndex } = event;
    if (typeof variantIndex !== "number" || !Number.isInteger(variantIndex) || variantIndex < 0 || variantIndex > 99
      || typeof creativeIndex !== "number" || !Number.isInteger(creativeIndex) || creativeIndex < 0
      || creativeIndex >= input.creativeIds.length || !/^\d{1,30}$/.test(event.externalId)) continue;
    const position = variantIndex * input.creativeIds.length + creativeIndex;
    if (position > 999) continue;
    const key = `${variantIndex}:${creativeIndex}`;
    if (event.phase === "creative") creatives.set(key, event.externalId);
    if (event.phase !== "ad") continue;
    const creativeId = input.creativeIds[creativeIndex];
    const row: AssetAdLink = {
      business_id: input.businessId, campaign_id: input.campaignId, meta_ad_id: event.externalId,
      meta_creative_id: creatives.get(key) ?? null, creative_id: creativeId,
      media_asset_id: input.mediaByCreative.get(creativeId) ?? null, variant_index: variantIndex, position,
    };
    const previous = ads.get(event.externalId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new Error("Ad attribution is ambiguous.");
    ads.set(event.externalId, row);
  }
  return [...ads.values()];
}

const adKey = (row: { campaign_id: string; meta_ad_id: string }) => `${row.campaign_id}:${row.meta_ad_id}`;
const safeTotal = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Ad result totals are invalid.");
  return value;
};

/** Lifetime rows only; a reused Meta ad id in another campaign or business is never the same result. */
export function poolAssetResults(
  businessId: string, campaigns: AssetCampaign[], links: AssetAdLink[], results: AssetAdResult[], asOf: number,
): Extract<AssetResults, { state: "ready" }> {
  const owned = new Map(campaigns.filter(row => row.business_id === businessId).map(row => [row.id, row]));
  const bindings = new Map(links.filter(row => row.business_id === businessId && owned.has(row.campaign_id)).map(row => [adKey(row), row]));
  const latest = new Map<string, AssetAdResult>();
  for (const row of results) {
    if (row.business_id !== businessId || !owned.has(row.campaign_id) || row.period_start !== null || row.period_end !== null) continue;
    if (!Number.isFinite(Date.parse(row.synced_at))) throw new Error("Ad result freshness is invalid.");
    const previous = latest.get(adKey(row));
    if (!previous || Date.parse(row.synced_at) > Date.parse(previous.synced_at)) latest.set(adKey(row), row);
  }
  const byMedia = new Map<string, Map<string, AssetTotals>>();
  const byCreative = new Map<string, Map<string, AssetTotals>>();
  let unmatched = 0;
  for (const [key, row] of latest) {
    const campaign = owned.get(row.campaign_id)!;
    const destination = campaignDestination(campaign);
    const definition = outcomeDefinition(destination, campaign.objective);
    if (!definition.comparable) continue;
    const binding = bindings.get(key);
    if (!binding || (!binding.creative_id && !binding.media_asset_id)) {
      if (campaign.creative_ids?.length) unmatched++;
      continue;
    }
    const count = safeTotal(row[definition.adField] ?? 0);
    const spend = safeTotal(row.spend_paise);
    // Action identity, not objective spelling, keeps equivalent legacy labels together without mixing result kinds.
    const outcomeKey = definition.metaActions.join(",");
    const add = (pool: typeof byMedia, id: string | null) => {
      if (!id) return;
      const groups = pool.get(id) ?? new Map<string, AssetTotals>();
      const total = groups.get(outcomeKey) ?? { destination, objective: campaign.objective, results: 0, spendPaise: 0, delivered: false, syncedAt: row.synced_at };
      total.results = safeTotal(total.results + count);
      total.spendPaise = safeTotal(total.spendPaise + spend);
      total.delivered ||= row.delivered;
      if (Date.parse(row.synced_at) < Date.parse(total.syncedAt)) total.syncedAt = row.synced_at;
      groups.set(outcomeKey, total);
      pool.set(id, groups);
    };
    add(byMedia, binding.media_asset_id);
    add(byCreative, binding.creative_id);
  }
  const serializable = (pool: typeof byMedia) => Object.fromEntries([...pool].map(([id, totals]) => [id, [...totals.values()]]));
  return { state: "ready", byMedia: serializable(byMedia), byCreative: serializable(byCreative), unmatched, asOf };
}
