import { maskWhatsAppNumber, maskedWhatsAppNumberPattern } from "@/lib/meta/whatsapp-status-shared";

export function wantedWhatsAppMask(number: string): string {
  return number && !maskedWhatsAppNumberPattern.test(number) ? maskWhatsAppNumber(number) : number;
}
