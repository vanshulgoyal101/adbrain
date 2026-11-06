import type { DraftInput } from "@/lib/campaign/connect-contracts";

export function reviewedWhatsAppNumber(
  destination: DraftInput["destination"],
  number: string | null | undefined,
  source: DraftInput["whatsappNumberSource"],
) {
  return destination === "whatsapp"
    ? { whatsappNumber: number ?? null, ...(source ? { whatsappNumberSource: source } : {}) }
    : { whatsappNumber: null };
}
