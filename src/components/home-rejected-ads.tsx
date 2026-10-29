import { RejectedAds } from "@/components/rejected-ads";
import { readStoredCampaignBinding } from "@/lib/campaign/binding";
import { requireOwnedBusiness, withMetaConnection } from "@/lib/meta/connection-access";
import type { Campaign } from "@/lib/types";

function adsManagerUrl(campaign: Pick<Campaign, "meta_ad_account_id" | "meta_campaign_id">) {
  const url = new URL("https://adsmanager.facebook.com/adsmanager/manage/campaigns/");
  const account = (campaign.meta_ad_account_id ?? "").replace(/^act_/, "").trim();
  if (/^\d+$/.test(account)) {
    url.searchParams.set("act", account);
    if (campaign.meta_campaign_id) url.searchParams.set("selected_campaign_ids", campaign.meta_campaign_id);
  }
  return url.toString();
}

/**
 * #1469: Home's line when Meta disapproved an ad of the newest campaign. The stored status says one was rejected;
 * the reason needs one Meta read (`readAdReview`, no write) on the campaign's own binding. Unreadable shows nothing.
 */
export async function HomeRejectedAds({ campaign, spend, vertical = null }: { campaign: Campaign; spend: number; vertical?: string | null }) {
  const { metaAdAccountId: adAccountId, metaPageId: pageId, metaConnectionGeneration: expectedGeneration } = readStoredCampaignBinding(campaign);
  const metaCampaignId = campaign.meta_campaign_id;
  if (!metaCampaignId || !adAccountId || !pageId || expectedGeneration === null) return null;
  const reviews = await requireOwnedBusiness(campaign.business_id).then((context) => withMetaConnection(context,
    { purpose: "read_insights", binding: { adAccountId, pageId }, expectedGeneration },
    (meta) => meta.readAdReview(metaCampaignId))).catch(() => null);
  if (!reviews) return null;
  return <RejectedAds reviews={reviews} spend={spend} running={campaign.status === "active"} vertical={vertical} adsManagerUrl={adsManagerUrl(campaign)} />;
}
