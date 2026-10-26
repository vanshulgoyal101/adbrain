import { intendedCampaignChildren } from "@/lib/campaign/activation";
import type { Campaign } from "@/lib/types";

/** #775: what editing a launched ad costs, in plain words (shared by the route and the dialog). */
export const BACK_TO_REVIEW = "Your ad goes back to Meta review (usually 5–10 minutes) and stops showing until it's approved.";

export type EditableAd = { adId: string; creativeId: string | null; label: string };

/**
 * The ads an owner edits, from the campaign's stored children (not guessed from counts, QA #898).
 * Ads are stored per ad set in launch order, one per creative, and a capped run's copies come last:
 * a capped run offers its latest capped ad set's ads (the ones that deliver); an uncapped A/B run
 * offers every ad, named by ad set. If the stored layout doesn't line up, every ad is offered unnamed.
 */
export function editableAds(campaign: Pick<Campaign, "meta_campaign_id" | "meta_adset_id" | "meta_ad_ids" | "raw">, creativeIds: string[]): EditableAd[] {
  const children = intendedCampaignChildren(campaign);
  const adIds = children?.adIds ?? campaign.meta_ad_ids ?? [];
  const perSet = creativeIds.length;
  if (!children || !perSet || adIds.length !== children.adSetIds.length * perSet) {
    return adIds.map((adId, index) => ({ adId, creativeId: null, label: `Ad ${index + 1}` }));
  }
  const ads = adIds.map((adId, index) => ({ adId, adSetIndex: Math.floor(index / perSet), creativeId: creativeIds[index % perSet], position: index % perSet }));
  const liveCapped = children.cappedAdSetIds.at(-1);
  if (liveCapped) {
    const setIndex = children.adSetIds.indexOf(liveCapped);
    return ads.filter((ad) => ad.adSetIndex === setIndex).map((ad) => ({ adId: ad.adId, creativeId: ad.creativeId, label: `Ad ${ad.position + 1}` }));
  }
  const several = children.adSetIds.length > 1;
  return ads.map((ad) => ({ adId: ad.adId, creativeId: ad.creativeId, label: several ? `Ad set ${ad.adSetIndex + 1} · Ad ${ad.position + 1}` : `Ad ${ad.position + 1}` }));
}
