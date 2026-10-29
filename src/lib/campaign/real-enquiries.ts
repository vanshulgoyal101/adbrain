import { campaignDestination } from "@/lib/campaign/outcomes";
import { segmentForCategory } from "@/lib/segments";
import type { Campaign, CampaignResult } from "@/lib/types";

/**
 * Adds each campaign's logged WhatsApp enquiries (#335) and its enquiries that became customers (#798, any
 * source) or were booked (#1994: Booked or Customer, since a customer was booked first) to its latest result; the
 * inputs are not changed. A row without `source` is a logged enquiry.
 */
export function attachRealEnquiries(
  results: Record<string, CampaignResult>,
  rows: { campaign_id: string | null; source?: string | null; workflow_status?: string | null }[],
): Record<string, CampaignResult> {
  const real = new Map<string, number>();
  const customers = new Map<string, number>();
  const booked = new Map<string, number>();
  for (const { campaign_id: id, source, workflow_status: status } of rows) {
    if (!id) continue;
    if (source === undefined || source === "whatsapp_manual") real.set(id, (real.get(id) ?? 0) + 1);
    if (status === "customer") customers.set(id, (customers.get(id) ?? 0) + 1);
    if (status === "booked" || status === "customer") booked.set(id, (booked.get(id) ?? 0) + 1);
  }
  return Object.fromEntries(Object.entries(results).map(([id, result]) => [id, { ...result, real_enquiries: real.get(id) ?? 0, customers: customers.get(id) ?? 0, booked: booked.get(id) ?? 0 }]));
}

const BOOKED: Record<"en" | "hi", Record<string, [one: string, many: string]>> = {
  en: { interiors: ["consultation booked", "consultations booked"], solar: ["site visit booked", "site visits booked"], ielts: ["demo class booked", "demo classes booked"], other: ["booked", "booked"] },
  hi: { interiors: ["कंसल्टेशन बुक हुआ", "कंसल्टेशन बुक हुए"], solar: ["साइट विज़िट बुक हुई", "साइट विज़िट बुक हुईं"], ielts: ["डेमो क्लास बुक हुई", "डेमो क्लास बुक हुईं"], other: ["बुक हुआ", "बुक हुए"] },
};

/** #1994: what a booking is called for this Brand category ("2 consultations booked"); plain "booked" outside the pilot segments. */
export function bookedLabel(category: string | null | undefined, count: number, language: "en" | "hi" = "en"): string {
  const [one, many] = BOOKED[language][segmentForCategory(category)?.slug ?? "other"] ?? BOOKED[language].other;
  return count === 1 ? one : many;
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

/** #1223/#1835: "Form enquiries" only while the list below the chat strips holds form leads alone; logged chats make it plain "Enquiries". */
export function enquiriesTitle(rows: WhatsAppChatRow[]): string {
  return rows.length && rows.every((row) => row.realEnquiries === 0) ? "Form enquiries" : "Enquiries";
}
