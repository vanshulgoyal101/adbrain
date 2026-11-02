/**
 * #418 rule 5: one specific proof line from the Brand (years in business, jobs done, a named
 * credential or a warranty). A bare "trusted" doesn't count. Validator only: it finds the Brand's
 * proof facts and says when none of a batch's ads cites one. Create's prompt asks for it (Dev).
 */
export type ProofFact = { fact: string; keys: string[] };

const CREDENTIAL = /\b(?:IIT(?:\s+[A-Z][a-z]+)?|NIT(?:\s+[A-Z][a-z]+)?|IIM(?:\s+[A-Z][a-z]+)?|PEC(?:\s+[A-Z][a-z]+)?|AIIMS|MBBS|BDS|MDS|MD|MNRE|ISO\s?\d{3,5}|BIS|NABH|NABL|CA|CFA|RERA|BEE)\b/g;
const NAMED_AWARD = /\b(?:certified|licensed|accredited|registered|award(?:ed)?|approved)\b/i;
const YEARS = /\b(\d{1,3})\+?\s*(?:years?|yrs?)\b|\bsince\s+((?:19|20)\d{2})\b|(\d{1,3})\+?\s*(?:साल|वर्ष)/giu;
// #2120: Hindi job nouns too; `\b` doesn't work next to Devanagari, so the noun ends where no letter or vowel sign follows.
const JOBS = /\b(\d[\d,]*)['’"]?\s*\+?\s*(?:homes?|houses?|installations?|customers?|clients?|patients?|projects?|families|jobs|systems?|students?|kitchens?|kW|MW|rooftops?|घरों|घर|ग्राहकों|ग्राहक|छात्रों|छात्र|परिवारों|परिवार|प्रोजेक्ट|सिस्टम|किचन)(?![\p{L}\p{M}\p{N}])/giu;
const WARRANTY = /\b(\d{1,2})[- ]?(?:year|yr)s?\b[^.]{0,30}\bwarrant(?:y|ies)\b|\bwarrant(?:y|ies)\b[^.]{0,30}\b(\d{1,2})[- ]?(?:year|yr)s?\b/gi;

/** The Brand facts that are proof, each with the words an ad must repeat to cite it. */
export function proofFacts(facts: (string | null | undefined)[]): ProofFact[] {
  const out: ProofFact[] = [];
  for (const raw of facts) {
    const fact = raw?.trim();
    if (!fact) continue;
    const keys = new Set<string>();
    for (const match of fact.matchAll(CREDENTIAL)) keys.add(match[0].trim());
    for (const match of fact.matchAll(YEARS)) keys.add((match[1] ?? match[2] ?? match[3])!);
    for (const match of fact.matchAll(JOBS)) keys.add(match[1].replace(/,/g, ""));
    for (const match of fact.matchAll(WARRANTY)) keys.add(`${match[1] ?? match[2]}-year warranty`);
    // A named credential without one of the known acronyms ("NABCEP certified") keeps its name.
    if (!keys.size && NAMED_AWARD.test(fact)) {
      const name = /\b([A-Z][A-Za-z0-9&.-]{2,})\s+(?:certified|licensed|accredited|registered|approved)\b/.exec(fact)?.[1];
      if (name) keys.add(name);
    }
    if (keys.size) out.push({ fact, keys: [...keys] });
  }
  return out;
}

function cites(text: string, key: string): boolean {
  if (/^\d+$/.test(key)) return new RegExp(`(?<!\\d)${key}(?!\\d)`).test(text.replace(/(\d),(?=\d)/g, "$1"));
  if (/-year warranty$/.test(key)) {
    const years = key.split("-")[0];
    return new RegExp(`\\b${years}[- ]?(?:year|yr)s?\\b[^.]{0,30}\\bwarrant|\\bwarrant[^.]{0,30}\\b${years}[- ]?(?:year|yr)`, "i").test(text);
  }
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

/** The proof facts this ad copy cites. */
export function citedProofs(copy: string, proofs: ProofFact[]): ProofFact[] {
  return proofs.filter((proof) => proof.keys.some((key) => cites(copy, key)));
}

/**
 * A warning when the Brand has proof but none of the ads cites it, else null. Names one proof so
 * the owner knows what to add.
 */
export function batchProofWarning(adCopies: string[], facts: (string | null | undefined)[]): string | null {
  const proofs = proofFacts(facts);
  if (!proofs.length || !adCopies.length) return null;
  if (adCopies.some((copy) => citedProofs(copy, proofs).length)) return null;
  const example = proofs[0].fact.length <= 90 ? proofs[0].fact : `${proofs[0].fact.slice(0, 87).trimEnd()}…`;
  return `None of these ads has a proof line from your Brand. Add one, like “${example}”, so people trust the offer`;
}
