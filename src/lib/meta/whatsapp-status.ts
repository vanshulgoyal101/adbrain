import { getConnectionStatus, requireOwnedBusiness, withMetaConnection } from "@/lib/meta/connection-access";
import type { WhatsAppStatus } from "./whatsapp-status-shared";

export type { WhatsAppStatus } from "./whatsapp-status-shared";

/** #235: which WhatsApp numbers this owner's connected Page can use for chat ads, read through the owned Meta connection. */
export async function readWhatsAppStatus(businessId: string): Promise<WhatsAppStatus> {
  const context = await requireOwnedBusiness(businessId);
  const connection = await getConnectionStatus(context);
  if (!connection.selected || connection.capabilities.canCreatePaused.state !== "available") return { state: "unavailable" };
  const numbers = await withMetaConnection(context, { purpose: "create_paused" }, (meta) => meta.whatsappNumbers());
  return numbers.page || numbers.business.length ? { state: "ready", ...numbers } : { state: "not_linked" };
}
