import { proofFacts } from "@/lib/creative/proof-line";
import type { Business } from "@/lib/types";

/**
 * #2032 (CPO spec on #2019): what Home's Brand meter counts, in the order it asks. Ranked by #418's
 * Ad Library rules. "photos" joins as the 4th fact once #744's library ships; until then it's out of 4.
 */
export const BRAND_FACTS = ["offer", "proof", "why", "audience"] as const;
export type BrandFact = (typeof BRAND_FACTS)[number];

/** Not now (#2032): set for 7 days, read on the server so a hidden card never renders. */
export const BRAND_METER_SNOOZE_COOKIE = "adbrain-brand-meter-snooze";

export type BrandMeter = { known: number; total: number; next: BrandFact | null };

type MeterBusiness = Pick<Business, "offers" | "usps" | "description" | "target_audience">;

// A number in any script owners type (ASCII, Devanagari, Gurmukhi), a rupee price or a free first step.
const NUMBER_OR_PRICE = /[0-9\u0966-\u096F\u0A66-\u0A6F₹]|\brs\.?(?=[\s\d]|$)/i;
const FREE_STEP = /\b(?:free|muft|demo|trial|survey)\b/i;
const FREE_STEP_HI = ["फ्री", "मुफ़्त", "मुफ्त", "डेमो", "सर्वे"].map((word) => word.normalize("NFC"));

export function specificOffer(offer: string | null | undefined): boolean {
  const text = (offer ?? "").normalize("NFC");
  return NUMBER_OR_PRICE.test(text) || FREE_STEP.test(text) || FREE_STEP_HI.some((word) => text.includes(word));
}

const filled = (value: string | null | undefined) => Boolean(value?.trim());

export function brandMeter(business: MeterBusiness): BrandMeter {
  const usps = business.usps ?? [];
  const has: Record<BrandFact, boolean> = {
    offer: specificOffer(business.offers?.[0]),
    // The same facts preflight's proof warning reads (`findBrandFacts`): usps and the description.
    proof: proofFacts([...usps, business.description]).length > 0,
    why: usps.some(filled),
    audience: filled(business.target_audience),
  };
  return { known: BRAND_FACTS.filter((fact) => has[fact]).length, total: BRAND_FACTS.length, next: BRAND_FACTS.find((fact) => !has[fact]) ?? null };
}
