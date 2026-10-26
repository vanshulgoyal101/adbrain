/**
 * Meta ad-policy rules for generated copy (#738): personal attributes, unsupported superlatives and
 * "up to N%" results. Pure and deterministic. `validateConcept` repairs on them; owner-typed copy
 * only gets a warning (`copyClaimWarnings`).
 */
import { HEALTH_VERTICAL } from "./slopScan";

export interface PolicyFinding {
  rule: "personal-attribute" | "unsupported-superlative" | "exaggerated-result";
  /** The phrase that tripped the rule, for the repair message. */
  detail: string;
  /** What to write instead, for the repair message and the owner's warning. */
  fix: string;
}


// A symptom, condition or health status: naming one about the reader asserts a personal attribute.
const CONDITION = new RegExp([
  "pain", "aches?", "aching", "sore(?:ness)?", "stiff(?:ness)?", "injur(?:y|ies|ed)", "strain(?:ed)?", "sprain(?:ed)?",
  "sciatica", "arthritis", "migraines?", "headaches?", "slipped disc", "herniated", "numbness", "tingling",
  "bleeding gums", "gum disease", "cavit(?:y|ies)", "toothache", "tooth decay", "bad breath", "sensitive teeth",
  "crooked teeth", "missing teeth", "overweight", "obes(?:e|ity)", "diabet(?:es|ic)", "depress(?:ed|ion)", "anxi(?:ety|ous)",
  "insomnia", "acne", "hair loss", "infections?", "symptoms?", "conditions?", "disorders?",
].map((term) => `\\b${term}\\b`).join("|") + "|दर्द|पीड़ा", "iu");
// The reader skipping care: "Overdue for a check-up?", "Putting off the dentist?".
const NEGLECT = /\b(?:overdue|putting off|put off|skipp(?:ed|ing)|neglect(?:ed|ing)|behind on|ignoring)\b/i;
// Money trouble about the reader: "Is your bill too high?", "बिल भारी लग रहा है?".
// Financial status, as Meta's examples (debt, can't afford), plus the audit's "bill feels heavy" (#738).
// A bill that is rising or annoying is about cost, not the reader's means, and is allowed.
const MONEY_TROUBLE = /\bbills?\b[^?.!]{0,40}\b(?:heavy|too high|so high|sky[- ]high|shock(?:ing)?|hurting|burden)\b|\bcan'?t afford\b|\bstruggling to pay\b|\bin debt\b|\bdebts?\b|\bbroke\b|\bmoney (?:problems|trouble|worries)\b|बिल[^?।]{0,30}भारी|\bbill\b[^?.!]{0,30}\b(?:bhaari|bhari)\b/iu;
const SUFFERING = /\b(?:suffer(?:ing|s)?\s+(?:from|with)|struggl(?:e|ing)\s+with|living with|dealing with|battling|tired of)\b/i;

const SUPERLATIVE = /(?:#\s?1|\bno\.?\s?1\b|\bnumber\s+one\b|\btop[- ]rated\b|\bbest[- ]rated\b|\baward[- ]winning\b|\bleading\b|\bmost trusted\b|\bunbeatable\b|\b(?:the|our|[\p{L}]+['’]s)\s+(?:very\s+)?best\b)/iu;
const UP_TO_RESULT = /\bup\s*to\s+\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*%\s*तक/iu;

function sentences(text: string): string[] {
  return text.split(/(?<=[?!.।])\s+|\n+/u).map((sentence) => sentence.trim()).filter(Boolean);
}

/** Every policy problem in customer-facing copy. `facts` are the business's own supplied facts. */
export function policyFindings(text: string, options: { vertical?: string | null; facts?: string[] } = {}): PolicyFinding[] {
  const findings: PolicyFinding[] = [];
  const health = HEALTH_VERTICAL.test(options.vertical ?? "");
  const facts = (options.facts ?? []).join(" ").toLocaleLowerCase();
  for (const sentence of sentences(text.normalize("NFC"))) {
    const question = /[?？]/.test(sentence);
    const condition = CONDITION.exec(sentence)?.[0];
    if (health && condition && (question || SUFFERING.test(sentence) || new RegExp(`\\byour\\s+(?:\\S+\\s+){0,2}${condition}`, "iu").test(sentence))) {
      findings.push({ rule: "personal-attribute", detail: sentence,
        fix: "don't ask about or name the reader's symptom or condition; name the service or offer instead (e.g. \"Back pain care in Austin\")" });
      continue;
    }
    if (health && question && NEGLECT.test(sentence)) {
      findings.push({ rule: "personal-attribute", detail: sentence,
        fix: "don't suggest the reader has neglected their health; name the service or offer instead" });
      continue;
    }
    if (question && MONEY_TROUBLE.test(sentence)) {
      findings.push({ rule: "personal-attribute", detail: sentence,
        fix: "don't ask about the reader's money troubles; state what the business offers instead" });
    }
  }
  const superlative = SUPERLATIVE.exec(text)?.[0];
  if (superlative && !facts.includes(superlative.toLocaleLowerCase().replace(/^(?:the|our|[\p{L}]+['’]s)\s+(?:very\s+)?/u, ""))) {
    findings.push({ rule: "unsupported-superlative", detail: superlative,
      fix: "remove the ranking or superlative; no supplied fact says it" });
  }
  const upTo = UP_TO_RESULT.exec(text)?.[0];
  if (upTo) {
    findings.push({ rule: "exaggerated-result", detail: upTo,
      fix: "remove the \"up to\" percentage; Meta treats best-case results as exaggerated, even when a fact states them" });
  }
  return findings;
}
