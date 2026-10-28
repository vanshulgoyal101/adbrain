import { ICE_BREAKER_LIMITS } from "@/lib/meta/limits";
import type { WhatsAppTemplate } from "@/lib/campaign/whatsapp-template";

type Language = WhatsAppTemplate["language"];

const LINK_OR_PHONE = /(https?:\/\/|www\.|\b\S+\.(com|in|net|org)\b|\+?\d[\d\s-]{7,}\d)/i;

/** Questions that state no fact, so any business can ask them (#905). */
const GENERIC: Record<Language, { price: string; callBack: string }> = {
  en: { price: "What's the price?", callBack: "Call me back" },
  hinglish: { price: "Price kya hai?", callBack: "Mujhe call karein" },
  hi: { price: "कीमत क्या है?", callBack: "मुझे कॉल करें" },
  pa: { price: "ਕੀਮਤ ਕੀ ਹੈ?", callBack: "ਮੈਨੂੰ ਕਾਲ ਕਰੋ" },
};

const fits = (text: string) => [...text].length <= ICE_BREAKER_LIMITS.chars;

const FREE = /^(?:free|complimentary)\b/i;
// Words that start an offer mid-sentence in lower case ("Can I get a check-up…"); names like "PM Surya Ghar" or "Diwali" keep theirs.
const COMMON_FIRST = /^(?:free|complimentary|flat|special|first|new|home|same-day|extra|check-up|checkup|cleaning|consultation|installation|discount|trial|demo)$/i;

/** #1114: an offer as a question a customer would send, in the run's language; the offer keeps the owner's words. */
const ASK: Record<Language, { free: (offer: string) => string; other: (offer: string) => string }> = {
  en: { free: (offer) => `Can I book a ${offer}?`, other: (offer) => `Can I get ${offer}?` },
  hinglish: { free: (offer) => `${offer} book ho sakta hai?`, other: (offer) => `${offer} kaise milega?` },
  hi: { free: (offer) => `${offer} बुक हो सकता है?`, other: (offer) => `${offer} कैसे मिलेगा?` },
  pa: { free: (offer) => `${offer} ਬੁੱਕ ਹੋ ਸਕਦਾ ਹੈ?`, other: (offer) => `${offer} ਕਿਵੇਂ ਮਿਲੇਗਾ?` },
};

function asked(offer: string, language: Language): string {
  const first = offer.split(/\s+/, 1)[0];
  // Mid-sentence in English, a common first word reads in lower case: "Can I book a free site survey?".
  const words = language === "en" && COMMON_FIRST.test(first) ? `${offer[0].toLowerCase()}${offer.slice(1)}` : offer;
  return FREE.test(offer) ? ASK[language].free(words) : ASK[language].other(words);
}

/**
 * Up to two offers as tap-to-send questions, in the owner's own words so the claim check accepts them.
 * A long offer keeps only what follows its label ("Diwali offer: 10% off rooftop solar installation" →
 * "10% off rooftop solar installation"). When the question doesn't fit, the offer's own words are sent as
 * they are; one that still doesn't fit is skipped, never cut mid-claim.
 */
function offerQuestions(offers: string[], language: Language): string[] {
  const questions: string[] = [];
  for (const raw of offers) {
    const offer = raw.trim().replace(/[.!]+$/, "");
    if (!offer || LINK_OR_PHONE.test(offer)) continue;
    const afterLabel = offer.split(/:\s+/).slice(1).join(": ").trim();
    // The question if it fits, else the offer's own words as today (#905): never cut mid-claim.
    // A label reads badly in a question ("Can I get Diwali offer: …?"), so the words after it come first.
    const words = [afterLabel, offer].filter(Boolean);
    const question = words.map((text) => asked(text, language)).find(fits) ?? words.find(fits);
    if (question && !questions.includes(question)) questions.push(question);
    if (questions.length === 2) break;
  }
  return questions;
}

/**
 * #905/#1114: up to three quick questions suggested from the Brand, for the owner to edit and save as their
 * WhatsApp message: up to two of its offers asked as a customer would ("Can I book a free site survey?"),
 * then a generic one. They are only suggestions: nothing is sent until the owner saves them, and saving runs
 * the same claim check as ad copy. A free offer is booked, never asked about as a cost.
 */
export function suggestedQuestions(business: { offers?: string[] | null }, language: Language = "en"): string[] {
  const generic = GENERIC[language];
  const questions = [...offerQuestions(business.offers ?? [], language), generic.price, generic.callBack];
  return [...new Set(questions)].slice(0, ICE_BREAKER_LIMITS.count);
}
