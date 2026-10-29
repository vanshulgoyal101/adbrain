/**
 * #1822 (Reviewer, #1816): Brand text and pasted bios feed the prompt as facts and quotes are copied verbatim, so a
 * third party's number or link could ship in the ad's words. Links, domains, wa.me and phone numbers are refused
 * unless they are the business's own website or phone. (The ad's click destination never comes from the copy.)
 */
// Known TLDs in any case, with any host (t.me); then any other 2–24-letter TLD (bit.ly, clinicdeals.xyz), lowercase
// only so "Dr.Mehta" or "today.Book" isn't a domain.
const LINK_IN_COPY = /\b(?:https?:\/\/|www\.)[^\s,)]+|\bwa\.me\/[^\s,)]*|\b[a-z0-9][a-z0-9-]{0,62}\.(?:co\.in|com|in|net|org|io|biz|info|shop|store|online|site|app|me|co|ly|link|xyz)\b(?:\/[^\s,)]*)?/giu;
const OTHER_DOMAIN = /\b[A-Za-z0-9][A-Za-z0-9-]{0,62}(?:\.[A-Za-z0-9-]+)*\.[a-z]{2,24}\b(?:\/[^\s,)]*)?/gu;
// #1947 (CPO): phone shapes, not "any 8+ digits", so "2026-2027" or "31.12.2026" pass. Digits may be split by
// spaces, dots, dashes, slashes or brackets: +CC international, an Indian mobile (6–9, optional 91/0), a 0-STD
// landline, 1800/1860 toll-free, a US-style 3-3-4; and any 8+ digits right after "call", "phone" and the like.
const SEP = String.raw`[\s.\-/()]{0,2}`;
const PHONE_IN_COPY = new RegExp(String.raw`(?<!\d)(?:\+\d(?:${SEP}\d){7,14}|(?:(?:91|0)${SEP})?[6-9](?:${SEP}\d){9}|0\d(?:${SEP}\d){8,9}|18[06]0(?:${SEP}\d){6,7}|\(?[2-9]\d{2}\)?[\s.\-/]{0,2}\d{3}[\s.\-/]\d{4})(?!\d)`, "g");
const PHONE_AFTER_WORD = new RegExp(String.raw`(?<![\p{L}\p{M}])(?:call|phone|ph|tel|mobile|mob|contact|dial|whatsapp|कॉल|फ़ोन|फोन|ਕਾਲ|ਫ਼ੋਨ)[\s:.\-]*(\+?\d(?:${SEP}\d){7,})(?!\d)`, "giu");
// Indian-script digits (Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam) as ASCII.
const INDIC_ZEROS = [0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66];
const asciiDigits = (text: string) => text.normalize("NFKC").replace(/[\u0966-\u096f\u09e6-\u09ef\u0a66-\u0a6f\u0ae6-\u0aef\u0b66-\u0b6f\u0be6-\u0bef\u0c66-\u0c6f\u0ce6-\u0cef\u0d66-\u0d6f]/gu,
  (digit) => String(digit.codePointAt(0)! - INDIC_ZEROS.find((zero) => digit.codePointAt(0)! - zero < 10 && digit.codePointAt(0)! >= zero)!));

const hostOf = (link: string) => link.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
const lastTenDigits = (text: string) => text.replace(/\D/g, "").slice(-10);

export function contactsInCopy(text: string, own: { website?: string | null; phone?: string | null }): string[] {
  const ownHost = own.website ? hostOf(own.website.trim()) : null;
  const ownPhone = own.phone ? lastTenDigits(asciiDigits(own.phone)) : null;
  const copy = asciiDigits(text);
  const rest = copy.replace(LINK_IN_COPY, " ");
  const links = [...(copy.match(LINK_IN_COPY) ?? []), ...(rest.match(OTHER_DOMAIN) ?? [])]
    .filter((link) => !ownHost || (hostOf(link) !== ownHost && !hostOf(link).endsWith(`.${ownHost}`)));
  // A number inside a link (wa.me/91…) is that link's, not a separate phone.
  const unlinked = rest.replace(OTHER_DOMAIN, " ");
  const phones = [...(unlinked.match(PHONE_IN_COPY) ?? []), ...[...unlinked.matchAll(PHONE_AFTER_WORD)].map((match) => match[1])]
    .map((phone) => phone.trim())
    .filter((phone) => phone.replace(/\D/g, "").length >= 8 && (!ownPhone || ownPhone.length < 8 || lastTenDigits(phone) !== ownPhone));
  // The word rule re-finds a shaped number; keep the longest form of each.
  const unique = [...new Set(phones)].filter((phone, _index, all) => !all.some((other) => other !== phone && other.includes(phone)));
  return [...new Set([...links, ...unique])];
}
