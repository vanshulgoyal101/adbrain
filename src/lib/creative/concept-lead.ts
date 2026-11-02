import { offerPhrase } from "@/lib/brand/offer";
import { AD_ANGLES, type AdAngle, type BrandContext } from "@/lib/templates/ads";

// #1035/#713: parallel concepts can't see each other, and "Rooftop solar for your home in Chandigarh,
// Mohali & Panchkula" opened all three (Oct 27 14:00Z), so two were lost to repeated-opening even after
// the repair. Each angle gets its own place and its own way in.
// Written as instructions: a bare "with the offer" was copied into the ad itself (Qwen, free eval Oct 28).
const OPENINGS: Record<string, string> = {
  value: "Open by naming the service and the place.",
  // Never a question about the reader's body or traits (personal-attribute; free eval Oct 28).
  problem: "Open by stating the problem the service fixes as a fact about the situation (a rising bill, a deadline, a broken AC). Never ask the reader about themselves.",
  offer: "Open by stating the offer.",
  trust: "Open by stating the proof.",
};

/**
 * #418 rule 7: the words every ad of a batch quotes as its ask, so the WhatsApp pre-typed message (#1027,
 * `quotedAsk`) is the same: the Brand's first free offer, else its first numbered one, else its first.
 * "Diwali offer: 10% off …" asks for "10% off …", as the WhatsApp greeting names it.
 */
export function batchAsk(offers: string[] | undefined): string | null {
  const phrases = (offers ?? []).map((offer) => offerPhrase(offer).slice(0, 60)).filter(Boolean);
  return phrases.find((phrase) => /^free\b/i.test(phrase)) ?? phrases.find((phrase) => /\d/.test(phrase)) ?? phrases[0] ?? null;
}

export function conceptLead(input: { brand: BrandContext; angle: AdAngle }): { place: string | null; opening: string } {
  const index = Math.max(0, AD_ANGLES.findIndex((angle) => angle.id === input.angle.id));
  const places = (input.brand.locations ?? []).map((place) => place.trim()).filter(Boolean);
  return { place: places.length ? places[index % places.length] : null, opening: OPENINGS[input.angle.id] ?? OPENINGS.value };
}
