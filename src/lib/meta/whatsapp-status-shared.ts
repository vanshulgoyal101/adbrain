export type WhatsAppStatus =
  | { state: "ready"; page: string | null; business: string[] }
  | { state: "not_linked" }
  | { state: "unavailable" };

/** "+91 ••••• 0874": enough to recognise the number without printing it in full. */
export function maskWhatsAppNumber(number: string): string {
  return `${number.slice(0, 3)} ••••• ${number.slice(-4)}`;
}
