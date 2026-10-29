/**
 * #2166: Devanagari (०–९) and Gurmukhi (੦–੯) digits as English digits, so "₹४९९" is the claim "₹499". One
 * character each, so match indexes still point into the original text.
 */
export const plainDigits = (text: string) =>
  text.replace(/[\u0966-\u096F\u0A66-\u0A6F]/gu, (digit) => String(digit.charCodeAt(0) % 16 - 6));

const CURRENCY_WORDS: Record<string, string> = {
  "$": "dollars?|usd", "\u00a3": "pounds?|gbp", "\u20ac": "euros?|eur",
  "\u20b9": "rupees?|rupaye|rupaiye|rs\\.?|inr|रुपये|रुपए|रुपया|रु\\.?|ਰੁਪਏ|ਰੁਪਈਏ",
};

/** "₹10,000" is backed by a source saying "10,000 rupees", "10,000 रुपये" or "Rs 10000". */
export function spelledCurrency(term: string, source: string): boolean {
  const words = CURRENCY_WORDS[term.trim()[0]];
  const amount = term.replace(/^\D+/, "").replace(/[.,]+$/, "").replace(/,/g, "").replace(/\./g, "\\.");
  if (!words || !amount) return false;
  return new RegExp(`(?<![\\p{L}\\p{M}])(?:${words})\\s*${amount}(?![\\d.])|(?<![\\d.])${amount}\\s*(?:${words})(?![\\p{L}\\p{M}])`, "iu")
    .test(source.replace(/(\d),(?=\d)/g, "$1"));
}

const SPELLED_WORDS = Object.values(CURRENCY_WORDS).join("|");
const SPELLED_AMOUNT = new RegExp(
  `(?<![\\p{L}\\p{M}])(?:${SPELLED_WORDS})\\s*\\d[\\d,]*(?:\\.\\d+)?|(?<![\\d.])\\d[\\d,]*(?:\\.\\d+)?\\s*(?:${SPELLED_WORDS})(?![\\p{L}\\p{M}])`,
  "iu",
);

/** Where text first states an amount in words ("10,000 rupaye", "Rs 499", "50 dollars"); -1 when it doesn't. */
export function spelledAmountIndex(text: string): number {
  return SPELLED_AMOUNT.exec(text)?.index ?? -1;
}

const RUPEE_AMOUNT = new RegExp(
  `(?<![\\p{L}\\p{M}])(?:${CURRENCY_WORDS["\u20b9"]})\\s*(\\d[\\d,]*(?:\\.\\d+)?)|(?<![\\d.])(\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:${CURRENCY_WORDS["\u20b9"]})(?![\\p{L}\\p{M}])`,
  "giu",
);

/**
 * #2166: "499 रुपये", "Rs 499" or "499 rupees" is the price "₹499", so it needs a Brand fact like "₹499" does.
 * Rupee words only: "lose 10 pounds" is not a price.
 */
export function spelledRupeeAmounts(text: string): { index: number; shown: string; term: string }[] {
  return [...text.matchAll(RUPEE_AMOUNT)].map((match) => ({ index: match.index, shown: match[0], term: `\u20b9${match[1] ?? match[2]}` }));
}

// #418 rule 3 (Analyst, #941): a price the Brand states as a rate ("10,000 rupees per kilowatt") keeps its unit.
const PRICE_AMOUNT = /(?:[$£€₹]\s?|\brs\.?\s?)(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:rupees?|rupaye|रुपये|रुपए)/giu;
const RATE_UNIT = /^\s*(?:(?:rupees?|rupaye|रुपये|रुपए)\s*)?(?:\/|\bper\s+|प्रति\s+)\s*([\p{L}\p{M}]+)/iu;

function priceRates(text: string): { amount: string; unit: string | null; shown: string }[] {
  const value = plainDigits(text.normalize("NFC"));
  return [...value.matchAll(PRICE_AMOUNT)].map((match) => {
    const unit = RATE_UNIT.exec(value.slice(match.index + match[0].length))?.[1].toLowerCase() ?? null;
    return {
      amount: (match[1] ?? match[2]).replace(/,/g, ""),
      unit: unit && (/^(?:kw|kilowatts?|किलोवाट)$/u.test(unit) ? "kw" : unit.replace(/s$/, "")),
      shown: match[0].trim(),
    };
  });
}

/** Amounts every supplied fact gives only as a rate, mapped to that unit; an ad stating one must keep it. */
export function rateDropIssues(output: string, facts: string[]): string[] {
  const rates = new Map<string, Set<string | null>>();
  for (const fact of facts) {
    for (const { amount, unit } of priceRates(fact)) rates.set(amount, (rates.get(amount) ?? new Set()).add(unit));
  }
  const issues = new Set<string>();
  for (const { amount, unit, shown } of priceRates(output)) {
    const units = rates.get(amount);
    if (!units || units.has(null) || (unit && units.has(unit))) continue;
    const factUnit = [...units][0];
    issues.add(`price-unit: "${shown}" is per ${factUnit === "kw" ? "kW" : factUnit} in the Brand facts; keep "per ${factUnit === "kw" ? "kW" : factUnit}" next to it, never as a flat price`);
  }
  return [...issues];
}
