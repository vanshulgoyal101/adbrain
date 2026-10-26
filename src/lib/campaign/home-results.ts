import { campaignDestination } from "@/lib/campaign/outcomes";
import type { Campaign, CampaignResult } from "@/lib/types";

export type HomeResults = { enquiries: number; spend: number; perEnquiry: number | null; oldestFetchedAt: string };

/**
 * #764: Home's "is it working?" row, from each campaign's latest result, counted the way its card
 * counts it (WhatsApp chats for chat campaigns, form leads otherwise). Null until any result exists.
 */
export function homeResults(campaigns: Campaign[], results: Record<string, CampaignResult>): HomeResults | null {
  const rows = campaigns.flatMap((campaign) => (results[campaign.id] ? [{ campaign, result: results[campaign.id] }] : []));
  if (!rows.length) return null;
  const enquiries = rows.reduce((sum, { campaign, result }) =>
    sum + (campaignDestination(campaign, result) === "whatsapp" ? result.conversations ?? 0 : result.leads), 0);
  const spend = rows.reduce((sum, { result }) => sum + result.spend, 0);
  // The oldest of the latest reads, so "updated" never sounds fresher than any campaign's numbers.
  const oldestFetchedAt = rows.map(({ result }) => result.fetched_at).sort()[0];
  return { enquiries, spend, perEnquiry: enquiries > 0 ? spend / enquiries : null, oldestFetchedAt };
}
