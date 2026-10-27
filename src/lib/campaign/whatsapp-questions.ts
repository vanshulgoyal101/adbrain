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

/**
 * The offer as a tap-to-send question, in the owner's own words so the claim check accepts it. A long
 * offer keeps only what follows its label ("Diwali offer: 10% off rooftop solar installation" →
 * "10% off rooftop solar installation"); one that still doesn't fit is skipped, never cut mid-claim.
 */
function offerQuestion(offers: string[]): string | null {
  for (const raw of offers) {
    const offer = raw.trim().replace(/[.!]+$/, "");
    if (!offer || LINK_OR_PHONE.test(offer)) continue;
    if (fits(offer)) return offer;
    const afterLabel = offer.split(/:\s+/).slice(1).join(": ").trim();
    if (afterLabel && fits(afterLabel)) return afterLabel;
  }
  return null;
}

/**
 * #905: up to three quick questions suggested from the Brand, for the owner to edit and save as their
 * WhatsApp message. They are only suggestions: nothing is sent until the owner saves them, and saving
 * runs the same claim check as ad copy. A free offer is asked as itself, never as "how much does it cost".
 */
export function suggestedQuestions(business: { offers?: string[] | null }, language: Language = "en"): string[] {
  const generic = GENERIC[language];
  const questions = [offerQuestion(business.offers ?? []), generic.price, generic.callBack];
  return [...new Set(questions.filter((question): question is string => Boolean(question)))].slice(0, ICE_BREAKER_LIMITS.count);
}
