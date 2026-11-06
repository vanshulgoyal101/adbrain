import { getConnectionStatus, requireOwnedBusiness, withMetaConnection } from "@/lib/meta/connection-access";
import { isThrottleCode, MetaError } from "@/lib/meta/client";
import { maskWhatsAppNumber, type WhatsAppStatus } from "./whatsapp-status-shared";
import { whatsappChoiceId } from "./whatsapp-choice";

export type { WhatsAppStatus } from "./whatsapp-status-shared";

export function isWhatsAppThrottleError(error: unknown): boolean {
  return error instanceof MetaError && (error.status === 429 || isThrottleCode(error.code));
}

/**
 * #235: which WhatsApp numbers this owner's connected Page can use for chat ads, read through the
 * owned Meta connection. Numbers leave the server masked, with an opaque business-scoped choice ID.
 */
export async function readWhatsAppStatus(businessId: string): Promise<WhatsAppStatus> {
  const context = await requireOwnedBusiness(businessId);
  const connection = await getConnectionStatus(context);
  if (!connection.selected || connection.capabilities.canCreatePaused.state !== "available") return { state: "unavailable" };
  const { page, business, businessUnavailable, pageUnavailable, pageReadError } = await withMetaConnection(context, { purpose: "create_paused", event: "whatsapp_numbers" }, (meta) => meta.whatsappNumbers());
  if (pageUnavailable) throw pageReadError ?? new MetaError("WhatsApp Page number could not be read.");
  const businessMasks = business.map(maskWhatsAppNumber);
  const counts = new Map<string, number>();
  for (const mask of businessMasks) counts.set(mask, (counts.get(mask) ?? 0) + 1);
  const indistinguishable = new Set(businessMasks.filter((mask) => counts.get(mask)! > 1));
  const partial = businessUnavailable || indistinguishable.size > 0;
  const numbers = [
    ...(page ? [{ masked: maskWhatsAppNumber(page), source: "page" as const, choiceId: whatsappChoiceId(businessId, "page", page) }] : []),
    ...business.flatMap((number, index) => indistinguishable.has(businessMasks[index]) ? [] : [{
      masked: businessMasks[index], source: "business" as const, choiceId: whatsappChoiceId(businessId, "business", number),
    }]),
  ];
  return numbers.length ? { state: "ready", numbers, ...(partial ? { businessUnavailable: true } : {}) } : partial ? { state: "unavailable" } : { state: "not_linked" };
}
