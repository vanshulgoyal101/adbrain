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
