import { WhatsAppStatusPanel } from "@/components/whatsapp-status";
import { readWhatsAppStatus, type WhatsAppStatus } from "@/lib/meta/whatsapp-status";

/** Server-rendered first read of the WhatsApp link status; Meta errors show as "unavailable". */
export async function WhatsAppStatusSection({ businessId }: { businessId: string }) {
  const status: WhatsAppStatus = await readWhatsAppStatus(businessId).catch(() => ({ state: "unavailable" }));
  return <WhatsAppStatusPanel businessId={businessId} initialStatus={status} />;
}
