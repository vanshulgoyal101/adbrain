import type { Campaign } from "@/lib/types";

/** The campaign selected in Meta Ads Manager (its ad account when known); client-safe. */
export function adsManagerUrl(campaign: Pick<Campaign, "meta_ad_account_id" | "meta_campaign_id">): string {
  const url = new URL("https://adsmanager.facebook.com/adsmanager/manage/campaigns/");
  const account = (campaign.meta_ad_account_id ?? "").replace(/^act_/, "").trim();
  if (/^\d+$/.test(account)) {
    url.searchParams.set("act", account);
    if (campaign.meta_campaign_id) url.searchParams.set("selected_campaign_ids", campaign.meta_campaign_id);
  }
  return url.toString();
}
