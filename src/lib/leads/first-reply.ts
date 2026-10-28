/**
 * #1049: reply to an enquiry in one tap. "WhatsApp them" opens a chat with the lead pre-filled with a
 * first reply in the business's language (with its name and offer); "Call" dials. The first tap is
 * recorded as `leads.first_contacted_at`, and Home shows the median time to that first reply.
 */
export type ReplyLanguage = "en" | "hi" | "hinglish";

/** The business's first language as a reply language; anything else replies in English. */
export function replyLanguage(languages: string[] | null | undefined): ReplyLanguage {
  const first = (languages ?? []).map((language) => language.trim().toLowerCase()).find(Boolean) ?? "";
  if (/hinglish/.test(first)) return "hinglish";
  if (/^(hindi|हिंदी|हिन्दी)/.test(first)) return "hi";
  return "en";
}

/** "Diwali offer: 10% off rooftop solar" → "10% off rooftop solar"; first letter lower-cased mid-sentence unless it's an acronym. */
function offerWords(offer: string | null | undefined): string | null {
  const trimmed = offer?.trim().replace(/:+$/, "").trim();
  if (!trimmed) return null;
  const phrase = (trimmed.split(":").pop() ?? "").trim() || trimmed;
  return /^[A-Z]{2}/.test(phrase) ? phrase : phrase[0].toLowerCase() + phrase.slice(1);
}

export function firstReplyText(input: { leadName?: string | null; businessName: string; offer?: string | null; language: ReplyLanguage }): string {
  const name = input.leadName?.trim().split(/\s+/)[0] ?? "";
  const business = input.businessName.trim();
  const offer = offerWords(input.offer);
  switch (input.language) {
    case "hi":
      return `नमस्ते${name ? ` ${name} जी` : ""}, ${business} की ओर से धन्यवाद! आपने ${offer ? `${offer} के बारे में` : "हमसे"} पूछा था। आपसे बात करने का सही समय कब है?`;
    case "hinglish":
      return `Namaste${name ? ` ${name} ji` : ""}, ${business} ki taraf se dhanyavaad! Aapne ${offer ? `${offer} ke baare mein` : "humse"} poocha tha. Aapse baat karne ka sahi time kab hai?`;
    default:
      return `Hi${name ? ` ${name}` : ""}, this is ${business}. Thanks for your enquiry${offer ? ` about the ${offer}` : ""}. When is a good time to talk?`;
  }
}

/**
 * The lead's number as WhatsApp wants it (country code, digits only), or null. A 10-digit Indian
 * mobile gets 91; a leading 0 is dropped; anything shorter than a full number is refused.
 */
export function whatsappDigits(phone: string | null | undefined): string | null {
  const raw = phone?.trim() ?? "";
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (!raw.startsWith("+")) {
    if (/^0\d{10}$/.test(digits)) digits = digits.slice(1);
    if (/^[6-9]\d{9}$/.test(digits)) digits = `91${digits}`;
  }
  return /^[1-9]\d{9,14}$/.test(digits) ? digits : null;
}

export function whatsappReplyLink(phone: string | null | undefined, text: string): string | null {
  const digits = whatsappDigits(phone);
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}

/** Minutes from enquiry to first reply, median over the rows that have both; null with none. */
export function medianReplyMinutes(rows: { created_time: string | null; created_at: string; first_contacted_at: string | null }[]): number | null {
  const minutes = rows.flatMap((row) => {
    if (!row.first_contacted_at) return [];
    const start = Date.parse(row.created_time ?? row.created_at);
    const end = Date.parse(row.first_contacted_at);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? [(end - start) / 60_000] : [];
  }).sort((left, right) => left - right);
  if (!minutes.length) return null;
  const middle = Math.floor(minutes.length / 2);
  return minutes.length % 2 ? minutes[middle] : (minutes[middle - 1] + minutes[middle]) / 2;
}

/** "under a minute", "12 min", "3 h 5 min", "2 days". */
export function formatReplyTime(minutes: number): string {
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 48 * 60) {
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes - hours * 60);
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  return `${Math.round(minutes / (24 * 60))} days`;
}
