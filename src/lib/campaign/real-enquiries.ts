import { campaignDestination } from "@/lib/campaign/outcomes";
import type { Campaign, CampaignResult } from "@/lib/types";

/** Adds each campaign's logged WhatsApp enquiries (#335) to its latest result; the inputs are not changed. */
export function attachRealEnquiries(
  results: Record<string, CampaignResult>,
  rows: { campaign_id: string | null }[],
): Record<string, CampaignResult> {
  const counts = new Map<string, number>();
  for (const { campaign_id: id } of rows) if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  return Object.fromEntries(Object.entries(results).map(([id, result]) => [id, { ...result, real_enquiries: counts.get(id) ?? 0 }]));
}

/** Spend per real enquiry; null until the first one is logged. */
export function costPerRealEnquiry(spend: number, enquiries: number): number | null {
  return enquiries > 0 ? spend / enquiries : null;
}

export type WhatsAppChatRow = { id: string; name: string; chats: number; spend: number; realEnquiries: number };

/** #764: each WhatsApp campaign's chats from its latest result, as its card counts them, for Enquiries. */
export function whatsappChatRows(campaigns: Campaign[], results: Record<string, CampaignResult>): WhatsAppChatRow[] {
  return campaigns.flatMap((campaign) => {
    const result = results[campaign.id];
    if (!result || campaignDestination(campaign, result) !== "whatsapp") return [];
    return [{ id: campaign.id, name: campaign.name ?? "WhatsApp campaign", chats: result.conversations ?? 0, spend: result.spend, realEnquiries: result.real_enquiries ?? 0 }];
  });
}
