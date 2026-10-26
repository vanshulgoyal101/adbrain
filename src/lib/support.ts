/**
 * #796: "Help on WhatsApp" opens a chat with the owner's business WhatsApp (SUPPORT_WHATSAPP, set by
 * DevOps; a public number, not a secret), pre-typed with who needs help. No number: no link.
 */
export function supportWhatsAppUrl(number: string | null | undefined, businessName: string | null): string | null {
  const digits = (number ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  const text = `AdBrain help: ${businessName?.trim() || "my workspace"}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
