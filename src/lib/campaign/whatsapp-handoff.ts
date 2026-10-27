/**
 * #1081 (W2): the business's past WhatsApp handoff, people who opened WhatsApp from an ad vs those
 * who then sent a message, and whether a pre-typed ask is too general to send.
 */
export type Handoff = { opens: number; messages: number };

/** Below this many opens the rate is noise, so Review doesn't show it. */
export const HANDOFF_MIN_OPENS = 10;

/** Sums the latest results of this business's WhatsApp campaigns; null until there are enough opens. */
export function handoffRate(results: { whatsapp_opens?: number | null; conversations?: number | null }[]): Handoff | null {
  let opens = 0;
  let messages = 0;
  for (const result of results) {
    opens += Math.max(0, Number(result.whatsapp_opens) || 0);
    messages += Math.max(0, Number(result.conversations) || 0);
  }
  return opens >= HANDOFF_MIN_OPENS ? { opens, messages: Math.min(messages, opens) } : null;
}

export function handoffLine({ opens, messages }: Handoff): string {
  const percent = Math.round((messages / opens) * 100);
  return `Your past WhatsApp ads: ${opens.toLocaleString("en-IN")} opened WhatsApp, ${messages.toLocaleString("en-IN")} sent a message (${percent}%).`;
}

const GREETING = /^(hi|hii+|hello|hey|namaste|namaskar|नमस्ते|ਸਤ ਸ੍ਰੀ ਅਕਾਲ)\b[!,.\s]*/iu;
const INFO_ONLY = /\b(info|information|details?|know more|more about|interested|enquiry|inquiry|jaankari|jankari)\b|जानकारी|ਜਾਣਕਾਰੀ/iu;

/** "Diwali offer: 10% off" → "10% off". */
function offerPhrase(offer: string): string {
  const trimmed = offer.trim().replace(/:+$/, "").trim();
  return (trimmed.split(":").pop() ?? "").trim() || trimmed;
}

/**
 * A pre-typed ask that names nothing concrete: "Hi", "I want info", "I'd like to know more about
 * Solaride". Concrete means it names one of the Brand's offers or a number (price, size, date).
 */
export function isGenericAsk(ask: string, offers: string[] = []): boolean {
  const text = ask.trim();
  if (!text) return false;
  const lower = text.toLowerCase();
  if (offers.map(offerPhrase).some((offer) => offer.length > 2 && lower.includes(offer.toLowerCase()))) return false;
  if (/\p{N}/u.test(text)) return false;
  const rest = text.replace(GREETING, "").trim();
  return INFO_ONLY.test(rest) || rest.split(/\s+/).filter(Boolean).length <= 3;
}
