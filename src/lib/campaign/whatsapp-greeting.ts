import { isRomanHindi } from "@/lib/creative/roman-hindi";

export type WhatsAppGreeting = { autofill: string; greeting: string };

/** Whole-word, case-insensitive: "EMI" must not match "Premium". */
function mentions(copy: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(copy);
}

/** "Diwali offer: 10% off" → "10% off"; "Diwali offer:" → "Diwali offer". */
function offerPhrase(offer: string): string {
  const trimmed = offer.trim().replace(/:+$/, "").trim();
  return (trimmed.split(":").pop() ?? "").trim() || trimmed;
}

/**
 * #418 rule 7: the words an ad's last line tells customers to send, when it quotes them
 * ('WhatsApp “Free survey” to book'). Null when the last line quotes nothing.
 */
export function quotedAsk(primaryText: string | null | undefined): string | null {
  const last = (primaryText ?? "").split(/\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? "";
  // Paired quotes only: a plain apostrophe ("Solaride's", "it's") is not a quote.
  const match = /“([^”]{2,80})”|"([^"]{2,80})"|«([^»]{2,80})»|‘([^’]{2,80})’/u.exec(last);
  const words = match?.slice(1).find(Boolean)?.trim();
  return words && /[\p{L}\p{N}]/u.test(words) ? words : null;
}


/** Same words, ignoring case, spacing, end punctuation and a phone's curly apostrophes (I’d = I'd). */
export function sameWords(left: string, right: string): boolean {
  const norm = (text: string) => text.toLowerCase().replace(/[‘’ʼ]/gu, "'").replace(/[\s]+/g, " ").replace(/[.!?।]+$/u, "").trim();
  return norm(left) === norm(right);
}

type Language = "en" | "hi" | "pa" | "hinglish";
/** A campaign's choice for its WhatsApp message (#493): "ad" follows the ads' own language. */
export type WhatsAppLanguage = "ad" | Language;

const TEXT: Record<Language, {
  offer: (offer: string, city: string | null) => string;
  business: (name: string, city: string | null) => string;
  greeting: (name: string) => string;
  /** #1121: with ice breakers there is no pre-typed message; the welcome points to the questions. */
  questions: (name: string) => string;
}> = {
  en: {
    // Short, simple English (owner, Oct 25): "Hi! I'd like a free site survey."
    offer: (offer, city) => `Hi! I'd like ${/^free\b/i.test(offer) ? "a" : "the"} ${offer}${city ? ` in ${city}` : ""}.`,
    business: (name, city) => `Hi! I'd like to know more about ${name}${city ? ` in ${city}` : ""}.`,
    greeting: (name) => `Hi! Thanks for messaging ${name}. Send this message and we'll reply here.`,
    questions: (name) => `Hi! Thanks for messaging ${name}. Tap a question below and we'll reply here.`,
  },
  hi: {
    offer: (offer, city) => `नमस्ते, मुझे ${city ? `${city} में ` : ""}${offer} के बारे में जानकारी चाहिए।`,
    business: (name, city) => `नमस्ते, मुझे ${city ? `${city} में ` : ""}${name} के बारे में जानकारी चाहिए।`,
    greeting: (name) => `नमस्ते! ${name} को मैसेज करने के लिए धन्यवाद। यह मैसेज भेजिए, हम यहीं जवाब देंगे।`,
    questions: (name) => `नमस्ते! ${name} को मैसेज करने के लिए धन्यवाद। नीचे कोई सवाल चुनिए, हम यहीं जवाब देंगे।`,
  },
  hinglish: {
    offer: (offer, city) => `Namaste, mujhe ${city ? `${city} mein ` : ""}${offer} ke baare mein jaankari chahiye.`,
    business: (name, city) => `Namaste, mujhe ${city ? `${city} mein ` : ""}${name} ke baare mein jaankari chahiye.`,
    greeting: (name) => `Namaste! ${name} ko message karne ke liye dhanyavaad. Yeh message bhejiye, hum yahin jawab denge.`,
    questions: (name) => `Namaste! ${name} ko message karne ke liye dhanyavaad. Neeche koi sawaal chuniye, hum yahin jawab denge.`,
  },
  pa: {
    offer: (offer, city) => `ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਮੈਨੂੰ ${city ? `${city} ਵਿੱਚ ` : ""}${offer} ਬਾਰੇ ਜਾਣਕਾਰੀ ਚਾਹੀਦੀ ਹੈ।`,
    business: (name, city) => `ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਮੈਨੂੰ ${city ? `${city} ਵਿੱਚ ` : ""}${name} ਬਾਰੇ ਜਾਣਕਾਰੀ ਚਾਹੀਦੀ ਹੈ।`,
    greeting: (name) => `ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ${name} ਨੂੰ ਸੁਨੇਹਾ ਭੇਜਣ ਲਈ ਧੰਨਵਾਦ। ਇਹ ਸੁਨੇਹਾ ਭੇਜੋ, ਅਸੀਂ ਇੱਥੇ ਹੀ ਜਵਾਬ ਦੇਵਾਂਗੇ।`,
    questions: (name) => `ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ${name} ਨੂੰ ਸੁਨੇਹਾ ਭੇਜਣ ਲਈ ਧੰਨਵਾਦ। ਹੇਠਾਂ ਕੋਈ ਸਵਾਲ ਚੁਣੋ, ਅਸੀਂ ਇੱਥੇ ਹੀ ਜਵਾਬ ਦੇਵਾਂਗੇ।`,
  },
};

/** The business name inside one of AdBrain's own welcomes of this kind, or null for the owner's own words. */
function nameIn(greeting: string, kind: "greeting" | "questions"): { language: Language; name: string } | null {
  const marker = "\u0000";
  for (const language of Object.keys(TEXT) as Language[]) {
    const [before, after] = TEXT[language][kind](marker).split(marker);
    if (greeting.length > before.length + after.length && greeting.startsWith(before) && greeting.endsWith(after)) {
      return { language, name: greeting.slice(before.length, greeting.length - after.length) };
    }
  }
  return null;
}

/**
 * #1121: with ice breakers, AdBrain's suggested welcome ("Send this message…") becomes the questions
 * one ("Tap a question below…") in the same language. A welcome the owner wrote is never changed.
 */
export function questionsWelcome(greeting: string): string {
  const found = nameIn(greeting, "greeting");
  return found ? TEXT[found.language].questions(found.name).slice(0, 300) : greeting;
}

/** The reverse, when the owner switches from Quick questions back to a pre-typed message. */
export function prefillWelcome(greeting: string): string {
  const found = nameIn(greeting, "questions");
  return found ? TEXT[found.language].greeting(found.name).slice(0, 300) : greeting;
}

/** Which script the copy is in, for a stored language that doesn't say ("Hindi", "Punjabi"). */
function scriptOf(copy: string): "devanagari" | "gurmukhi" | "latin" {
  return /\p{Script=Devanagari}/u.test(copy) ? "devanagari" : /\p{Script=Gurmukhi}/u.test(copy) ? "gurmukhi" : "latin";
}

function languageFrom(stored: (string | null | undefined)[], copy: string): Language | null {
  for (const value of stored) {
    if (!value) continue;
    if (/hinglish/i.test(value)) return "hinglish";
    if (/devanagari/i.test(value)) return "hi";
    if (/gurmukhi/i.test(value)) return "pa";
    if (/^english\b/i.test(value)) return "en";
    // #1081: Brand's plain "Hindi"/"Punjabi" follows the ad's script; in Roman letters it reads as Hinglish.
    if (/^(hindi|punjabi)\b/i.test(value)) {
      const script = scriptOf(copy);
      return script === "devanagari" ? "hi" : script === "gurmukhi" ? "pa" : "hinglish";
    }
  }
  return null;
}

/**
 * The message's language: the campaign's choice, else the ads' stored language, else their script,
 * else Hindi in Roman letters (#1081: a Hinglish ad gets a Hinglish ask, not English).
 */
export function whatsappLanguageFor(adCopy: string[], adLanguages: (string | null | undefined)[] = [], chosen: WhatsAppLanguage = "ad"): Language {
  const copy = adCopy.join(" ");
  if (chosen !== "ad") return chosen;
  const script = scriptOf(copy);
  return languageFrom(adLanguages, copy)
    ?? (script === "devanagari" ? "hi" : script === "gurmukhi" ? "pa" : isRomanHindi(copy) ? "hinglish" : "en");
}

/** #1198: the last line for a Quick questions campaign, which has no ready message to quote, in the ad's language. */
export const QUESTIONS_LAST_LINE: Record<Language, string> = {
  en: "Tap, then pick a question to send.",
  hi: "टैप करें, फिर भेजने के लिए कोई सवाल चुनें।",
  hinglish: "Tap karein, phir bhejne ke liye koi sawaal chunein.",
  pa: "ਟੈਪ ਕਰੋ, ਫਿਰ ਭੇਜਣ ਲਈ ਕੋਈ ਸਵਾਲ ਚੁਣੋ।",
};

/** The ad's copy with its last line replaced by QUESTIONS_LAST_LINE in the ad's own language (Review's one-tap fix, #1198). */
export function withQuestionsLastLine(primaryText: string, storedLanguage?: string | null): string {
  const lines = primaryText.replace(/\s+$/u, "").split("\n");
  return [...lines.slice(0, -1), QUESTIONS_LAST_LINE[whatsappLanguageFor([primaryText], [storedLanguage])]].join("\n");
}

/**
 * Click-to-WhatsApp texts built only from Brand facts (#209). `autofill` is the message pre-typed
 * for the customer, `greeting` the business's welcome above it. #493: one short ask in the ad's own
 * language (their stored language, else Devanagari → Hindi, Gurmukhi → Punjabi, else English) naming one offer the ads mention
 * (a free, bookable offer first, then a numbered one) and the city when the campaign has just one.
 */
export function whatsappGreeting(
  brand: { name: string; offers?: string[] | null },
  adCopy: string[],
  areas: string[] = [],
  /** The ads' stored language (`generation.design.language`); the script decides when there is none. */
  adLanguages: (string | null | undefined)[] = [],
  /** The campaign's choice; "ad" (default) follows the ads. */
  chosen: WhatsAppLanguage = "ad",
  /** #418 rule 7: each ad's quoted ask (`quotedAsk`); when every ad quotes the same words, they are the pre-typed message. */
  asks: (string | null)[] = [],
): WhatsAppGreeting {
  const name = brand.name.trim();
  const ask = asks.length && asks.every((value) => value && sameWords(value, asks[0]!)) ? asks[0]! : null;
  const copy = adCopy.join(" ");
  const language = whatsappLanguageFor(adCopy, adLanguages, chosen);
  const rank = (offer: string) => (/^free\b/i.test(offer) ? 2 : /\d/.test(offer) ? 1 : 0);
  const offer = (brand.offers ?? [])
    .map(offerPhrase)
    .filter((phrase) => phrase && mentions(copy, phrase))
    .sort((left, right) => rank(right) - rank(left))[0];
  const places = areas.map((area) => area.trim()).filter(Boolean);
  const city = places.length === 1 ? places[0] : null;
  const text = TEXT[language];
  // Mid-sentence, follow the ad's own casing: "a free site survey" but "a Diwali offer".
  const lower = offer && offer[0].toLowerCase() + offer.slice(1);
  const phrase = offer && lower !== offer && copy.includes(lower) ? lower : offer;
  return {
    autofill: (ask ?? (phrase ? text.offer(phrase, city) : text.business(name, city))).slice(0, 300),
    greeting: text.greeting(name).slice(0, 300),
  };
}
