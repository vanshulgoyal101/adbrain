import { getConnectionStatus, requireOwnedBusiness, withMetaConnection } from "@/lib/meta/connection-access";
import { maskWhatsAppNumber, type WhatsAppStatus } from "./whatsapp-status-shared";

export type { WhatsAppStatus } from "./whatsapp-status-shared";

/**
 * #235: which WhatsApp numbers this owner's connected Page can use for chat ads, read through the
 * owned Meta connection. Numbers leave the server masked only; a draft names one by its mask.
 */
export async function readWhatsAppStatus(businessId: string): Promise<WhatsAppStatus> {
  const context = await requireOwnedBusiness(businessId);
  const connection = await getConnectionStatus(context);
  if (!connection.selected || connection.capabilities.canCreatePaused.state !== "available") return { state: "unavailable" };
  const { page, business } = await withMetaConnection(context, { purpose: "create_paused", event: "whatsapp_numbers" }, (meta) => meta.whatsappNumbers());
  const numbers = [
    ...(page ? [{ masked: maskWhatsAppNumber(page), source: "page" as const }] : []),
    ...business.map((number) => ({ masked: maskWhatsAppNumber(number), source: "business" as const })),
  ];
  return numbers.length ? { state: "ready", numbers } : { state: "not_linked" };
}
