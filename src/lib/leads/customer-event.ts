import { recordProductEvent } from "@/lib/observability/logger";

/**
 * #2026: one `lead.customer_marked` row per saved mark or undo (inbox status or WhatsApp +1), so customers can be
 * counted; the client's click event fires before the save and ignores Undo.
 */
export function recordCustomerMark(input: { businessId: string; campaignId: string | null; source: "inbox" | "whatsapp"; undone: boolean }): void {
  recordProductEvent({
    kind: "action", name: "lead.customer_marked", outcome: "success", businessId: input.businessId,
    attributes: { entityType: "lead", source: input.source, undone: input.undone, ...(input.campaignId ? { campaignId: input.campaignId } : {}) },
  });
}
