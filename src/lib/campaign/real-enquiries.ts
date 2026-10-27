import { campaignDestination } from "@/lib/campaign/outcomes";
import type { Campaign, CampaignResult } from "@/lib/types";

/**
 * Adds each campaign's logged WhatsApp enquiries (#335) and its enquiries that became customers (#798, any
 * source) to its latest result; the inputs are not changed. A row without `source` is a logged enquiry.
 */
export function attachRealEnquiries(
  results: Record<string, CampaignResult>,
  rows: { campaign_id: string | null; source?: string | null; workflow_status?: string | null }[],
): Record<string, CampaignResult> {
  const real = new Map<string, number>();
  const customers = new Map<string, number>();
  for (const { campaign_id: id, source, workflow_status: status } of rows) {
    if (!id) continue;
    if (source === undefined || source === "whatsapp_manual") real.set(id, (real.get(id) ?? 0) + 1);
    if (status === "customer") customers.set(id, (customers.get(id) ?? 0) + 1);
  }
  return Object.fromEntries(Object.entries(results).map(([id, result]) => [id, { ...result, real_enquiries: real.get(id) ?? 0, customers: customers.get(id) ?? 0 }]));
}

/** #798: Meta spend per enquiry that became a customer; null until the first one. */
export function costPerCustomer(spend: number, customers: number): number | null {
  return customers > 0 && spend >= 0 ? spend / customers : null;
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
