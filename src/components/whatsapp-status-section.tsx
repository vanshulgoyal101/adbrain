import { WhatsAppStatusPanel } from "@/components/whatsapp-status";
import { readWhatsAppStatus, type WhatsAppStatus } from "@/lib/meta/whatsapp-status";
import { requestWords } from "@/i18n/request-locale";

/** Server-rendered first read of the WhatsApp link status; Meta errors show as "unavailable". */
export async function WhatsAppStatusSection({ businessId, status: read }: { businessId: string; status?: Promise<WhatsAppStatus> }) {
  const [status, words] = await Promise.all([
    (read ?? readWhatsAppStatus(businessId)).catch((): WhatsAppStatus => ({ state: "unavailable" })),
    requestWords("settings"),
  ]);
  return <WhatsAppStatusPanel businessId={businessId} initialStatus={status} words={words} />;
}
