/** Whether a fact or reply states a commercial term ("free", "10%", "₹500", "guaranteed") or negates it (#378, #613, #687). */

/**
 * "Not a guaranteed saving", "no guarantee", "गारंटी नहीं": a negated term is not a claim (#378).
 * Only a negation right next to the term counts, so "not just free installation" is still a claim.
 */
export function negatedTerm(text: string, index: number, term: string): boolean {
  return /\b(?:not|never|no|without)\s+(?:(?:a|an|any)\s+)?$/i.test(text.slice(Math.max(0, index - 24), index))
    || /^\s*(?:नहीं|ਨਹੀਂ)(?![\p{L}\p{M}])/u.test(text.slice(index + term.length, index + term.length + 12));
}

/** A Brand fact that negates or withdraws this term: "avoid free", "don't offer free", "Free survey, no longer offered" (#613, #767). */
export function withdrawnInFact(source: string, index: number, term: string): boolean {
  const before = source.slice(Math.max(0, index - 32), index);
  // The rest of the sentence, not just the clause: "$49 exam, no longer offered" withdraws $49 (#767).
  // A sentence ends at . ! ? ; before a space, or a line break, so "$49.99" doesn't end it.
  const clause = source.slice(index + term.length).split(/[.!?;](?=\s|$)|\n/)[0];
  return /\b(?:avoid|\w+n['’]t)\s+(?:\w+\s+)?(?:(?:a|an|any)\s+)?$/i.test(before)
    || /\b(?:no longer|not (?:available|offered|valid)|discontinued|ended|expired|withdrawn)\b/i.test(clause);
}

/** The fact states this term itself: not negated next to it, not withdrawn in its clause. */
export function affirmedInFact(source: string, index: number, term: string): boolean {
  return !negatedTerm(source, index, term) && !withdrawnInFact(source, index, term);
}
