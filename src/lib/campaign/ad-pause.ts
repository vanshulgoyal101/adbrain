import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdResultView } from "@/lib/campaign/ad-results-store";
import { BEST_AD_MIN_RESULTS } from "@/lib/meta/insights";

/**
 * #1045 (#799's smallest slice): when one running ad costs far more per enquiry than the others, the
 * campaign card offers to pause just that ad. Never automatic; nothing but that ad's status changes.
 * Same evidence bar as "Best" (#783): at least 5 enquiries across the campaign.
 */
export const PAUSE_COST_RATIO = 2;
export const KEEP_HIDES_MS = 3 * 24 * 60 * 60 * 1000;

export type PauseSuggestion = {
  ad: Pick<AdResultView, "adId" | "name" | "creative" | "spend" | "results" | "costPerResult">;
  reference: Pick<AdResultView, "adId" | "name" | "creative" | "costPerResult">;
  /** "expensive": costs ≥ 2× the reference per enquiry; "no_enquiries": spent ≥ 2× the campaign's cost per enquiry with none. */
  reason: "expensive" | "no_enquiries";
};

const running = (ad: AdResultView) => ad.status === "ACTIVE";

export function pauseSuggestion(ads: AdResultView[]): PauseSuggestion | null {
  const totalResults = ads.reduce((sum, ad) => sum + ad.results, 0);
  if (totalResults < BEST_AD_MIN_RESULTS) return null;
  const totalSpend = ads.reduce((sum, ad) => sum + ad.spend, 0);
  const campaignCost = totalSpend / totalResults;
  // "Best" when #783 calls one; otherwise the cheapest ad that has enquiries.
  const reference = ads.find((ad) => ad.best)
    ?? [...ads].filter((ad) => !ad.replaced && ad.results > 0 && ad.costPerResult !== null).sort((left, right) => left.costPerResult! - right.costPerResult!)[0];
  if (!reference?.costPerResult) return null;
  const candidates = ads.filter((ad) => ad.adId !== reference.adId && !ad.replaced && running(ad)).flatMap((ad): PauseSuggestion[] => {
    if (ad.results === 0 && ad.spend >= PAUSE_COST_RATIO * campaignCost) return [{ ad, reference, reason: "no_enquiries" }];
    if (ad.costPerResult !== null && ad.costPerResult >= PAUSE_COST_RATIO * reference.costPerResult!) return [{ ad, reference, reason: "expensive" }];
    return [];
  });
  // The one wasting the most: the highest cost per enquiry, an ad with none counting as its whole spend.
  const worst = (suggestion: PauseSuggestion) => suggestion.ad.costPerResult ?? suggestion.ad.spend;
  const pick = candidates.sort((left, right) => worst(right) - worst(left))[0];
  return pick ? { ad: { adId: pick.ad.adId, name: pick.ad.name, creative: pick.ad.creative, spend: pick.ad.spend, results: pick.ad.results, costPerResult: pick.ad.costPerResult }, reference: { adId: reference.adId, name: reference.name, creative: reference.creative, costPerResult: reference.costPerResult }, reason: pick.reason } : null;
}

export type AdPauseEntry = { adId: string; action: "paused" | "resumed"; at: string; reason?: string };

/** The last thing AdBrain did to this ad, from the run's ledger row (#588). */
export function lastAdAction(snapshot: unknown, adId: string): AdPauseEntry["action"] | null {
  const entries = (snapshot as { adPauses?: unknown } | null)?.adPauses;
  if (!Array.isArray(entries)) return null;
  const mine = entries.filter((entry): entry is AdPauseEntry => (entry as AdPauseEntry)?.adId === adId);
  return mine.at(-1)?.action ?? null;
}

/** Best effort: adds the pause or undo to the run's ledger row; a missing row only skips the note. */
export async function recordAdPause(database: Pick<SupabaseClient, "from">, row: { campaignId: string; entry: AdPauseEntry }): Promise<boolean> {
  try {
    const { data, error } = await database.from("campaign_learnings").select("snapshot").eq("campaign_id", row.campaignId).maybeSingle();
    if (error || !data || !data.snapshot || typeof data.snapshot !== "object" || Array.isArray(data.snapshot)) return false;
    const snapshot = data.snapshot as { adPauses?: AdPauseEntry[] };
    const adPauses = [...(Array.isArray(snapshot.adPauses) ? snapshot.adPauses : []), row.entry].slice(-50);
    const { error: updateError } = await database.from("campaign_learnings").update({ snapshot: { ...snapshot, adPauses }, updated_at: new Date().toISOString() }).eq("campaign_id", row.campaignId);
    return !updateError;
  } catch {
    return false;
  }
}
