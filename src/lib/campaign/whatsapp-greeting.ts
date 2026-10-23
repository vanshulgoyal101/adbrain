export type WhatsAppGreeting = { autofill: string; greeting: string };

/** Whole-word, case-insensitive: "EMI" must not match "Premium". */
function mentions(copy: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(copy);
}

/**
 * Hinglish click-to-WhatsApp texts built only from Brand facts (#209). AdBrain
 * campaigns are INR-only, so the audience is Indian. `autofill` is the message
 * pre-typed for the customer; it names up to two Brand offers the ads mention,
 * a numbered offer (price, %) first.
 */
export function whatsappGreeting(brand: { name: string; offers?: string[] | null }, adCopy: string[]): WhatsAppGreeting {
  const name = brand.name.trim();
  const copy = adCopy.join(" ");
  const offers = (brand.offers ?? [])
    .map((offer) => offer.trim().replace(/:+$/, "").trim())
    .filter((offer) => offer && mentions(copy, (offer.split(":").pop() ?? "").trim() || offer))
    .sort((left, right) => Number(/\d/.test(right)) - Number(/\d/.test(left)))
    .slice(0, 2);
  const about = offers.length ? `${name} ke ${offers.join(" aur ")}` : name;
  return {
    autofill: `Namaste! Mujhe ${about} ke baare mein jaankari chahiye.`.slice(0, 300),
    greeting: `Namaste! ${name} mein aapka swagat hai. Apna sawaal yahan likhiye.`.slice(0, 300),
  };
}
