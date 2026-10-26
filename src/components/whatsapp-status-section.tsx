import { WhatsAppStatusPanel } from "@/components/whatsapp-status";
import { readWhatsAppStatus, type WhatsAppStatus } from "@/lib/meta/whatsapp-status";

/** Server-rendered first read of the WhatsApp link status; Meta errors show as "unavailable". */
export async function WhatsAppStatusSection({ businessId, status: read }: { businessId: string; status?: Promise<WhatsAppStatus> }) {
  const status: WhatsAppStatus = await (read ?? readWhatsAppStatus(businessId)).catch(() => ({ state: "unavailable" }));
  return <WhatsAppStatusPanel businessId={businessId} initialStatus={status} />;
}
