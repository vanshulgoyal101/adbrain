import { campaignDestination } from "@/lib/campaign/outcomes";
import type { Campaign, CampaignResult } from "@/lib/types";

/** `chatsOnly` (#1624): every counted campaign is WhatsApp, so the numbers are chats, not real enquiries. */
export type HomeResults = { enquiries: number; spend: number; perEnquiry: number | null; oldestFetchedAt: string; chatsOnly: boolean };

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
  const chatsOnly = rows.every(({ campaign, result }) => campaignDestination(campaign, result) === "whatsapp");
  return { enquiries, spend, perEnquiry: enquiries > 0 ? spend / enquiries : null, oldestFetchedAt, chatsOnly };
}

/**
 * #1624 (CPO): chats on live or ended WhatsApp campaigns when the owner hasn't logged one real enquiry or customer
 * from them yet, so Home can ask which were real. 0 when any is logged, or the logged counts couldn't be read.
 */
export function unloggedChats(campaigns: Campaign[], results: Record<string, CampaignResult>): number {
  const rows = campaigns.filter((campaign) => campaign.status === "active" || campaign.status === "paused" || campaign.status === "completed")
    .flatMap((campaign) => (results[campaign.id] && campaignDestination(campaign, results[campaign.id]) === "whatsapp" ? [results[campaign.id]] : []));
  if (rows.some((result) => result.real_enquiries === undefined || result.customers === undefined)) return 0;
  const logged = rows.reduce((sum, result) => sum + (result.real_enquiries ?? 0) + (result.customers ?? 0), 0);
  const chats = rows.reduce((sum, result) => sum + (result.conversations ?? 0), 0);
  return logged === 0 ? chats : 0;
}
