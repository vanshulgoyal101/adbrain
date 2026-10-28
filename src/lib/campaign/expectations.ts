/**
 * #1307: Review's "What to expect" line, from the #588 ledger (the Analyst's read on #1255, Oct 28): AdBrain-made
 * WhatsApp runs (#157 + #499) got 6 chats for ₹1,195. Under 20 pooled results it states the facts with n, never a
 * typical cost (#1255 gates). Review reads the live totals (`ledgerTotals`, hourly); these recorded figures are the
 * fallback when that read fails.
 */
export const WHATSAPP_LEDGER = { chats: 6, spendRupees: 1195 } as const;

const MIN_POOLED_RESULTS = 20;
/** "about" figures: ₹100 steps from ₹1,000, ₹10 from ₹100, exact below. */
const about = (value: number) => {
  const step = value >= 1000 ? 100 : value >= 100 ? 10 : 1;
  return `₹${(Math.round(value / step) * step).toLocaleString("en-IN")}`;
};

export function whatsappExpectation(ledger: { chats: number; spendRupees: number } = WHATSAPP_LEDGER): string {
  if (!ledger.chats) return "AdBrain hasn't run enough WhatsApp campaigns yet to quote a cost per chat.";
  const each = `about ${about(ledger.spendRupees / ledger.chats)} each`;
  const facts = `AdBrain's WhatsApp ads so far got ${ledger.chats} ${ledger.chats === 1 ? "chat" : "chats"} for about ${about(ledger.spendRupees)}, ${each}.`;
  return ledger.chats < MIN_POOLED_RESULTS ? `${facts} That's too few to predict yours.` : facts;
}

export const REVIEW_AND_SPEND = "Meta reviews new ads first, usually within 24 hours, and nothing spends until you go live.";
