/**
 * Meta ad-policy rules for generated copy (#738): personal attributes, unsupported superlatives,
 * "up to N%" results, and (#941) zero-cost, result-or-refund and timed-result promises. Pure and deterministic. `validateConcept` repairs on them; owner-typed copy
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
const MONEY_TROUBLE = /\bbills?\b[^?.!]{0,40}\b(?:heavy|too high|so high|sky[- ]high|shock(?:ing)?|hurting|burden)\b|\bcan'?t afford\b|\bstruggling to pay\b|\bin debt\b|\bdebts?\b|\b(?:i'?m|you'?re|are you)\s+broke\b|\bmoney (?:problems|trouble|worries)\b|बिल[^?।]{0,30}भारी|\bbill\b[^?.!]{0,30}\b(?:bhaari|bhari)\b/iu;
const SUFFERING = /\b(?:suffer(?:ing|s)?\s+(?:from|with)|struggl(?:e|ing)\s+with|living with|dealing with|battling|tired of)\b/i;

const SUPERLATIVE = /(?:#\s?1|\bno\.?\s?1\b|\bnumber\s+one\b|\btop[- ]rated\b|\bbest[- ]rated\b|\baward[- ]winning\b|\b(?:the|our|[\p{L}]+['’]s)\s+leading\b|\bleading\s+(?:clinic|dentist|doctor|provider|company|brand|installer|\w+ist)s?\b|\bmost trusted\b|\bunbeatable\b|\b(?:the|our|[\p{L}]+['’]s)\s+(?:very\s+)?best\b)/iu;
const UP_TO_RESULT = /\bup\s*to\s+\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*%\s*तक/iu;

// #941 rule 8: promises long-running Indian ads still make that Meta treats as exaggerated or misleading.
const ZERO_COST = /(?<![\p{L}\p{N}])(?:zero|0|₹\s?0|rs\.?\s?0)[- ]?(?:investment|cost|down[- ]?payment|upfront)(?![\p{L}\p{N}])|शून्य\s*(?:निवेश|लागत)|\bzero\s+(?:nivesh|laagat|lagat)\b/iu;
const NO_RESULT_NO_FEE = /\bno\s+(?:results?|band|success|selection|admission|cure|improvement|savings?)\s*[,-]?\s*(?:then\s+)?no\s+(?:fees?|charges?|pay(?:ment)?)\b|\bmoney[- ]back\b/iu;
const FAST_OUTCOME = /\b(?:results?|new teeth|new smile|relief|cure[ds]?|fluen(?:t|tly|cy)|hair regrowth|glowing skin|weight loss|lose\s+\d+\s*kg)\b[^.!?\n]{0,30}?\b(?:in|within)\s+(?:just\s+|only\s+)?(?:\d+\s*|a few\s+|few\s+)?(?:days?|weeks?|hours?)\b/iu;
const squash = (text: string) => text.toLocaleLowerCase().replace(/[\s,-]+/g, "");

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
  // CTO (#805): a health outcome is refused even when cited; elsewhere a figure the Brand states (Solaride's
  // "up to 98%") is normal ad copy, and only an uncited one is refused.
  const upTo = UP_TO_RESULT.exec(text)?.[0];
  const figure = upTo?.match(/\d+(?:\.\d+)?\s*%/)?.[0].replace(/\s+/g, "");
  const cited = Boolean(figure && facts.replace(/\s+/g, "").includes(figure));
  if (upTo && (health || !cited)) {
    findings.push({ rule: "exaggerated-result", detail: upTo,
      fix: health
        ? "remove the \"up to\" percentage; Meta refuses best-case health results even when a fact states them"
        : "remove the \"up to\" percentage; no supplied fact states it" });
  }
  const stated = (phrase: string) => squash(facts).includes(squash(phrase));
  const zero = ZERO_COST.exec(text)?.[0];
  if (zero && !stated(zero)) {
    findings.push({ rule: "exaggerated-result", detail: zero,
      fix: "remove the zero-cost claim; no supplied fact says it, and Meta treats it as misleading" });
  }
  const noFee = NO_RESULT_NO_FEE.exec(text)?.[0];
  if (noFee && !stated(noFee)) {
    findings.push({ rule: "exaggerated-result", detail: noFee,
      fix: "remove the result-or-refund promise; no supplied fact says it" });
  }
  const fast = FAST_OUTCOME.exec(text)?.[0];
  const span = fast?.match(/(?:\d+\s*|a few\s+|few\s+)?(?:days?|weeks?|hours?)$/i)?.[0];
  if (fast && (health || !span || !stated(span))) {
    findings.push({ rule: "exaggerated-result", detail: fast,
      fix: health
        ? "remove the timed result; Meta refuses health outcomes promised by a date"
        : "remove the timed result; no supplied fact says it" });
  }
  return findings;
}
