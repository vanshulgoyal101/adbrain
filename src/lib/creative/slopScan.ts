// Deterministic quality gate for generated ad copy. Pure + unit-tested;
// no LLM cost. Catches AI-slop before a variant reaches a customer or spends.

/** AI-cliché phrases that read as generic/slop in local-SMB ads. */
const CLICHES = [
  "unlock",
  "elevate",
  "unleash",
  "look no further",
  "game-chang",
  "in today's fast-paced",
  "take it to the next level",
  "seamless",
  "revolutionary",
  "cutting-edge",
  "harness the power",
  "dive in",
  "empower",
  "supercharge",
  "world-class",
  "state-of-the-art",
];

export interface SlopFinding {
  rule: string;
  detail: string;
}

export interface SlopScanOptions {
  /** Max total words across the scanned copy (headline + body). */
  maxWords?: number;
  /** Substrings a customer's instructions forbid, e.g. "discount", "guarantee". */
  bannedClaims?: string[];
  /** Words the business itself writes in capitals (see `capitalWords`); repeating them isn't shouting. */
  allowedCaps?: string[];
}

function bareWord(word: string): string {
  return word.normalize("NFC").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/** Every word written fully in capitals with at least two capital letters: "SOLARIDE", "PM", "IIT". */
export function capitalWords(text: string): string[] {
  return [...new Set(text.split(/[\s/-]+/).map(bareWord).filter((w) => w === w.toUpperCase() && /\p{Lu}.*\p{Lu}/u.test(w)))];
}

/** Return every quality problem found in `text`. Empty array = clean. */
export function scanAdCopy(text: string, opts: SlopScanOptions = {}): SlopFinding[] {
  const findings: SlopFinding[] = [];
  const lower = text.toLowerCase();
  const words = text.trim().split(/\s+/).filter(Boolean);

  for (const c of CLICHES) {
    if (lower.includes(c)) findings.push({ rule: "cliche", detail: c });
  }

  const emDashes = (text.match(/—/g) ?? []).length;
  if (emDashes > 1) findings.push({ rule: "em-dash-overuse", detail: String(emDashes) });

  const bangs = (text.match(/!/g) ?? []).length;
  if (bangs > 2) findings.push({ rule: "exclamation-spam", detail: String(bangs) });

  // Shouting needs letters: "$49," or "2026" equal their uppercase but are not caps. Acronyms joined by
  // "/" or "-" ("IIT/PEC", "नॉन-DCR") are short words, and capitals the business writes itself
  // ("SOLARIDE") are its own spelling, not shouting (#418).
  const allowedCaps = new Set(opts.allowedCaps ?? []);
  const caps = words
    .flatMap((w) => w.split(/[/-]/))
    .filter((w) => w.length > 3 && w === w.toUpperCase() && /\p{Lu}.*\p{Lu}/u.test(w) && !allowedCaps.has(bareWord(w)))
    .length;
  if (caps > 1) findings.push({ rule: "all-caps", detail: `${caps} words` });

  if (opts.maxWords && words.length > opts.maxWords) {
    findings.push({ rule: "too-long", detail: `${words.length}/${opts.maxWords}` });
  }

  for (const claim of opts.bannedClaims ?? []) {
    const term = claim.toLowerCase();
    // "heal" (heals, healed, healing) is a health claim; "health" is not.
    const found = term === "heal" ? /heal(?!th)/.test(lower) : lower.includes(term);
    if (claim && found) {
      findings.push({ rule: "banned-claim", detail: claim });
    }
  }

  return findings;
}

/** Convenience: true when the copy passes every check. */
export function isClean(text: string, opts?: SlopScanOptions): boolean {
  return scanAdCopy(text, opts).length === 0;
}

/**
 * Claims that get healthcare ads rejected (and are unsafe to make anyway).
 * Meta's health & wellness policy disallows implied outcomes and cures, so a
 * clinic's copy must never promise them — the LLM is told this in the brand's
 * instructions, and this list enforces it deterministically.
 */
export const MEDICAL_BANNED_CLAIMS = [
  "cure",
  "cures",
  "heal",
  "heals",
  "healed",
  "guaranteed",
  "guarantee",
  "pain-free",
  "pain free",
  "miracle",
  "permanent fix",
  "permanently fix",
  "risk-free",
] as const;

/** Verticals whose ads are held to the healthcare claim rules. */
const HEALTH_VERTICAL = /chiro|dental|dentist|clinic|medical|doctor|physio|health|wellness|therapy|hospital|ayurved|derma/i;

/**
 * Banned claims for a business's industry. Non-health verticals get none, so
 * existing customers' copy is unaffected.
 */
export function bannedClaimsForVertical(vertical?: string | null): string[] {
  return HEALTH_VERTICAL.test(vertical ?? "") ? [...MEDICAL_BANNED_CLAIMS] : [];
}

