const CURRENCY_WORDS: Record<string, string> = { "$": "dollars?|usd", "\u00a3": "pounds?|gbp", "\u20ac": "euros?|eur", "\u20b9": "rupees?|rs\\.?|inr" };

/** "₹10,000" is backed by a source saying "10,000 rupees" or "Rs 10000". */
export function spelledCurrency(term: string, source: string): boolean {
  const words = CURRENCY_WORDS[term.trim()[0]];
  const amount = term.replace(/^\D+/, "").replace(/[.,]+$/, "").replace(/,/g, "").replace(/\./g, "\\.");
  if (!words || !amount) return false;
  return new RegExp(`(?<!\\p{L})(?:${words})\\s*${amount}(?![\\d.])|(?<![\\d.])${amount}\\s*(?:${words})\\b`, "iu")
    .test(source.replace(/(\d),(?=\d)/g, "$1"));
}
