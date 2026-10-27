/**
 * #418 rule 5 (Analyst, #941): long-running local ads carry one specific proof from the business:
 * years in business, jobs done, a named credential or a warranty length. A bare "trusted" doesn't count.
 */

const COUNT = /(\d[\d,]*)\s*\+?\s*-?\s*(years?|yrs|homes|houses|clients|customers|patients|projects|installations|families|jobs|systems|cases|smiles|businesses|factories)\b/gi;
const WARRANTY = /\bwarrant(?:y|ies)\b/i;
const CREDENTIAL = /\b(?:board[- ]certified|certified|licensed|accredited|registered|award[- ]winning|graduates?|alumni|degree|qualified)\b/gi;
// "IIT", "PEC", "BDS", "ISO": a named institute or qualification, in a fact that is about credentials.
const ACRONYM = /\b[A-Z]{2,5}\b/g;
const NAME = String.raw`[A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*)*`;
const INSTITUTION = new RegExp(String.raw`\b(?:from|of|by|at)\s+(?:the\s+)?(${NAME}(?:\s*(?:,|and|&)\s*${NAME})*)`, "g");

/** The words an ad must repeat to carry this fact's proof; empty when the fact is not proof. */
export function proofKeys(fact: string): string[] {
  const keys = new Set<string>();
  // "15+ years" is the number with its unit: "a 15-minute check" doesn't repeat it.
  for (const match of fact.matchAll(COUNT)) keys.add(`${match[1].replace(/,/g, "")} ${match[2].toLowerCase().replace(/^yrs$/, "year").replace(/s$/, "")}`);
  const credentials = [...fact.matchAll(CREDENTIAL)].map((match) => match[0].toLowerCase());
  if (credentials.length || WARRANTY.test(fact)) {
    // Only an institution the credential comes from: "graduates from IIT Bombay and PEC", not "AC and LED work".
    for (const source of fact.matchAll(INSTITUTION)) for (const match of source[1].matchAll(ACRONYM)) keys.add(match[0]);
    for (const credential of credentials) if (!/^(?:graduates?|alumni|degree|qualified)$/.test(credential)) keys.add(credential);
  }
  return [...keys];
}

/** Whether the Brand facts hold any proof an ad could carry. */
export function hasProofFact(facts: (string | null | undefined)[]): boolean {
  return facts.some((fact) => typeof fact === "string" && proofKeys(fact).length > 0);
}

/** Whether the ad text repeats one proof from the facts; null when the facts have none to give. */
export function carriesProof(text: string, facts: (string | null | undefined)[]): boolean | null {
  const keys = facts.flatMap((fact) => (typeof fact === "string" ? proofKeys(fact) : []));
  if (!keys.length) return null;
  const plain = text.replace(/(\d),(\d)/g, "$1$2");
  return keys.some((key) => /^\d+ /.test(key)
    ? new RegExp(`(?<![\\d.])${key.replace(" ", "\\s*\\+?\\s*-?\\s*").replace(/year$/, "(?:year|yr)")}s?\\b`, "i").test(plain)
    : new RegExp(`(?<![\\p{L}\\p{N}])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, /^[A-Z]+$/.test(key) ? "u" : "iu").test(plain));
}
