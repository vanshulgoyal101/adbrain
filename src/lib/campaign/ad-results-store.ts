import type { SupabaseClient } from "@supabase/supabase-js";
import { intendedCampaignChildren } from "@/lib/campaign/activation";
import { bestAd, type AdResult } from "@/lib/meta/insights";
import type { Campaign } from "@/lib/types";

/**
 * #783/#789: per-ad results ("which ad worked"). Off until `AD_RESULTS_ENABLED=true` and the
 * campaign_ads/ad_results migration is in production; then each refresh also reads Meta's per-ad
 * results and stores them, and the campaign card reads them back.
 */
export function adResultsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.AD_RESULTS_ENABLED === "true";
}

type Store = Pick<SupabaseClient, "from">;

/** Meta's status, or DELETED for an ad gone from the listing (#943), so the card keeps it as replaced. */
function storedStatus(ad: AdResult): string | null {
  if (ad.effectiveStatus && /^[A-Z_]{1,40}$/.test(ad.effectiveStatus)) return ad.effectiveStatus;
  return ad.replaced ? "DELETED" : null;
}

/** One lifetime-to-date row per ad (null period). Best effort: a failure keeps the last rows. */
export async function saveAdResults(database: Store, row: { businessId: string; campaignId: string; ads: AdResult[] }): Promise<boolean> {
  if (!row.ads.length) return true;
  const syncedAt = new Date().toISOString();
  const { error } = await database.from("ad_results").upsert(row.ads.map(ad => ({
    business_id: row.businessId, campaign_id: row.campaignId, meta_ad_id: ad.adId,
    ad_name: ad.name?.slice(0, 400) ?? null, effective_status: storedStatus(ad),
    period_start: null, period_end: null, delivered: ad.delivered,
    impressions: ad.impressions, link_clicks: ad.whatsappOpens ?? ad.clicks,
    conversations: ad.whatsappOpens === undefined ? 0 : ad.results, leads: ad.whatsappOpens === undefined ? ad.results : 0,
    spend_paise: Math.round(ad.spend * 100), synced_at: syncedAt,
  })), { onConflict: "campaign_id,meta_ad_id,period_start,period_end" });
  return !error;
}

export type StoredAdResult = {
  meta_ad_id: string; ad_name: string | null; effective_status: string | null; delivered: boolean;
  impressions: number; link_clicks: number; conversations: number; leads: number; spend_paise: number; synced_at: string;
};

/** The AdBrain creative an ad was launched from, so the card shows its picture and headline (Designer, #783). */
export type AdCreative = { headline: string | null; imageUrl: string | null };
/** `live` is false for an ad outside a capped run's latest ad set (the run moved to copies of it). */
export type AdCreativeLink = { creativeId: string; live: boolean };

/**
 * Each ad's creative, from the campaign's stored launch layout (the one `editableAds` reads): ads per ad set in
 * creative order, a capped run's copies last. Empty when the layout doesn't line up (outside or older campaigns),
 * so those keep Meta's names; never guessed from counts alone.
 */
export function adCreativeLinks(
  campaign: Pick<Campaign, "meta_campaign_id" | "meta_adset_id" | "meta_ad_ids" | "raw">, creativeIds: string[],
): Map<string, AdCreativeLink> {
  const children = intendedCampaignChildren(campaign);
  const perSet = creativeIds.length;
  if (!children || !perSet || children.adIds.length !== children.adSetIds.length * perSet) return new Map();
  const liveCapped = children.cappedAdSetIds.at(-1);
  const liveSet = liveCapped ? children.adSetIds.indexOf(liveCapped) : -1;
  return new Map(children.adIds.map((adId, index) => [adId, {
    creativeId: creativeIds[index % perSet],
    live: liveSet < 0 || Math.floor(index / perSet) === liveSet,
  }]));
}

export type AdResultView = {
  adId: string; name: string | null; delivered: boolean; replaced: boolean; best: boolean;
  /** The AdBrain creative's picture and headline, or null for an ad AdBrain can't link (it keeps Meta's name). */
  creative: AdCreative | null;
  /** From a capped run's earlier ad set: kept for its results, no longer the one running. */
  earlier: boolean;
  /** Meta's effective status at the last refresh (#1045: only a running ad is offered for pausing). */
  status: string | null;
  impressions: number; results: number; spend: number; costPerResult: number | null;
};

/** The card's rows: results are chats for a WhatsApp campaign, form enquiries otherwise; "Best" by #783's rule. */
export function adResultViews(
  stored: StoredAdResult[], whatsapp: boolean,
  linked?: { links: Map<string, AdCreativeLink>; creatives: Map<string, AdCreative> },
): { ads: AdResultView[]; syncedAt: string | null } {
  const linkOf = (adId: string) => linked?.links.get(adId);
  // A capped run's earlier ad that never delivered is a zero-row duplicate of its running copy.
  const rows = stored.filter(row => row.delivered || linkOf(row.meta_ad_id)?.live !== false);
  const ads: AdResult[] = rows.map(row => {
    const results = whatsapp ? row.conversations : row.leads;
    const spend = row.spend_paise / 100;
    return {
      adId: row.meta_ad_id, name: row.ad_name, effectiveStatus: row.effective_status, creativeId: null, delivered: row.delivered,
      impressions: row.impressions, clicks: row.link_clicks, spend, results, costPerResult: results > 0 ? spend / results : null,
      replaced: row.effective_status === "ARCHIVED" || row.effective_status === "DELETED",
    };
  });
  const best = bestAd(ads);
  const syncedAt = stored.reduce<string | null>((latest, row) => !latest || row.synced_at > latest ? row.synced_at : latest, null);
  return {
    syncedAt,
    ads: ads
      .map(ad => {
        const link = linkOf(ad.adId);
        const creative = link ? linked?.creatives.get(link.creativeId) ?? null : null;
        return { adId: ad.adId, name: ad.name, delivered: ad.delivered, replaced: ad.replaced, best: ad === best, creative, earlier: link?.live === false, status: ad.effectiveStatus, impressions: ad.impressions, results: ad.results, spend: ad.spend, costPerResult: ad.costPerResult };
      })
      .sort((left, right) => Number(right.best) - Number(left.best) || Number(left.replaced || left.earlier) - Number(right.replaced || right.earlier) || right.results - left.results || right.spend - left.spend),
  };
}
