import type { SupabaseClient } from "@supabase/supabase-js";
import { bestAd, type AdResult } from "@/lib/meta/insights";

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

export type AdResultView = {
  adId: string; name: string | null; delivered: boolean; replaced: boolean; best: boolean;
  impressions: number; results: number; spend: number; costPerResult: number | null;
};

/** The card's rows: results are chats for a WhatsApp campaign, form enquiries otherwise; "Best" by #783's rule. */
export function adResultViews(rows: StoredAdResult[], whatsapp: boolean): { ads: AdResultView[]; syncedAt: string | null } {
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
  const syncedAt = rows.reduce<string | null>((latest, row) => !latest || row.synced_at > latest ? row.synced_at : latest, null);
  return {
    syncedAt,
    ads: ads
      .map(ad => ({ adId: ad.adId, name: ad.name, delivered: ad.delivered, replaced: ad.replaced, best: ad === best, impressions: ad.impressions, results: ad.results, spend: ad.spend, costPerResult: ad.costPerResult }))
      .sort((left, right) => Number(right.best) - Number(left.best) || Number(left.replaced) - Number(right.replaced) || right.results - left.results || right.spend - left.spend),
  };
}
