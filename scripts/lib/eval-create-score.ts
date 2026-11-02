/** Pure scoring for scripts/eval-create.ts (#418): no network, unit-tested in CI. */
import { quotedAsk, sameWords } from "../../src/lib/campaign/whatsapp-greeting";
import { citedProofs, proofFacts } from "../../src/lib/creative/proof-line";

const FOLD_CHARACTERS = 125;

export type JudgeScore = { copy: number; image: number; inventedClaims: string[]; imageTextErrors: string[] };

export type AdResult = {
  angle: string;
  headline: string;
  primaryText: string;
  cta: string;
  /** Models that wrote this ad's concept, in attempt order. */
  textModels: string[];
  attempts: number;
  firstTry: boolean;
  rejectedRules: string[];
  offerInFold: boolean | null;
  /** #418 rule 1: the headline or first line names a Brand location; null for Indic-script copy or no locations. */
  placeUpFront?: boolean | null;
  /** #418 rule 4: the picture's direction shows a person or someone at work (a text heuristic; reported, not gated). */
  personInScene?: boolean;
  /** #418 rule 1: the post's first line is at most 60 characters. */
  firstLineShort?: boolean;
  /** #418 rule 5: the copy repeats a Brand proof (years, jobs, credential, warranty); null when the Brand has none. */
  proof?: boolean | null;
  /** #418 rule 7: the words the last line quotes for customers to send (`quotedAsk`); null when it quotes none. */
  ask?: string | null;
  visualDirection?: string;
  scriptOk: boolean;
  judge?: JudgeScore;
  costUsd: number;
};

export type CaseResult = {
  id: string;
  language: string;
  saved: number;
  expected: number;
  /** `issues` are the validator's messages, kept to explain a partial batch. */
  failures: {
    angle: string; stage: string; rules: string[]; issues?: string[];
    /** The validated copy of a concept whose image failed. */
    copy?: { headline: string; primaryText: string; supportingText: string | null; placeUpFront: boolean | null; visualDirection?: string; personInScene?: boolean }
      & Partial<CopyRules>;
  }[];
  ads: AdResult[];
  costUsd: number;
  wallMs: number;
};

export type Summary = {
  runs: number;
  fullBatchRate: number;
  adsSaved: number;
  adsExpected: number;
  /** Ads whose copy passed every check, even if the image then failed (free images often do). */
  conceptsSaved?: number;
  conceptsExpected?: number;
  /** Concepts no provider answered (free-tier limits): capacity, not copy quality. */
  providerFailures?: number;
  firstTryRate: number;
  offerInFoldRate: number;
  /** Absent in reports made before #418 rule 1. */
  placeUpFrontRate?: number;
  /** Reported only: a heuristic over the visual direction. */
  personInSceneRate?: number;
  /**
   * Reported only (#418 rules 1, 5, 7): first line within 60 characters; runs where at least one ad cites a
   * Brand proof; runs whose ads all quote the same ask, which then becomes the WhatsApp pre-typed message.
   */
  firstLineShortRate?: number;
  proofBatchRate?: number;
  askBatchRate?: number;
  scriptRate: number;
  judgeCopy: number;
  judgeImage: number;
  inventedClaimRate: number;
  imageTextErrorRate: number;
  costPerRunUsd: number;
  spentUsd: number;
  wallMsP50: number;
  wallMsP90: number;
  rejectedRules: Record<string, number>;
};

/** Whether any offer term starts within the first 125 characters of the post text; null when the case has no offer. */
export function offerInFold(primaryText: string, terms: string[]): boolean | null {
  if (!terms.length) return null;
  const text = primaryText.toLowerCase();
  return terms.some((term) => {
    const index = text.indexOf(term.toLowerCase());
    return index >= 0 && index < FOLD_CHARACTERS;
  });
}

/**
 * #418 rule 1: whether the headline or the post's first line names one of the Brand's places. Null when
 * there are no places or the copy is in an Indic script, where place names are transliterated.
 */
export function placeUpFront(headline: string, primaryText: string, locations: string[]): boolean | null {
  const places = locations.flatMap((location) => location.split(/[,;]/)).map((place) => place.trim().toLowerCase()).filter(Boolean);
  const top = `${headline}\n${primaryText.split("\n", 1)[0]}`;
  if (!places.length || textScript(top) !== "latin") return null;
  const lower = top.toLowerCase();
  return places.some((place) => lower.includes(place));
}

export { personInScene } from "../../src/lib/creative/visual-rules";

export type CopyRules = Pick<AdResult, "firstLineShort" | "proof" | "ask">;
type RuleBrand = { description?: string | null; usps?: string[]; offers?: string[] };

/** #418 rules 1 (60 characters), 5 (a Brand proof, `proof-line.ts`) and 7 (the quoted ask) for one ad's copy. */
export function copyRules(brand: RuleBrand, sourceFacts: string[], headline: string, primaryText: string): CopyRules {
  const proofs = proofFacts([brand.description, ...(brand.usps ?? []), ...(brand.offers ?? []), ...sourceFacts]);
  return {
    firstLineShort: primaryText.split("\n", 1)[0].trim().length <= 60,
    proof: proofs.length ? citedProofs([headline, primaryText].join("\n"), proofs).length > 0 : null,
    ask: quotedAsk(primaryText),
  };
}

/** The script most letters are written in; digits, currency and punctuation don't count. */
export function textScript(text: string): "devanagari" | "latin" | "none" {
  const devanagari = text.match(/\p{Script=Devanagari}/gu)?.length ?? 0;
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  if (!devanagari && !latin) return "none";
  return devanagari > latin ? "devanagari" : "latin";
}

export function expectedScript(language: string): "devanagari" | "latin" {
  return language === "hi" ? "devanagari" : "latin";
}

const round = (value: number, places = 4) => Number(value.toFixed(places));
const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
const rate = (values: boolean[]) => (values.length ? values.filter(Boolean).length / values.length : 1);
/** Like rate, but nothing measured counts as none (for bad outcomes). */
const share = (values: boolean[]) => (values.length ? values.filter(Boolean).length / values.length : 0);

/** Nearest-rank percentile. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length))) - 1];
}

function ruleRates(cases: CaseResult[]): Pick<Summary, "firstLineShortRate" | "proofBatchRate" | "askBatchRate"> {
  const copies = (result: CaseResult): Partial<CopyRules>[] => [...result.ads, ...result.failures.flatMap((failure) => (failure.copy ? [failure.copy] : []))];
  const all = cases.flatMap(copies);
  const known = <T,>(values: (T | null | undefined)[]) => values.flatMap((value) => (value == null ? [] : [value]));
  const batches = cases.flatMap((result) => {
    const proofs = known(copies(result).map((copy) => copy.proof));
    return proofs.length ? [proofs.some(Boolean)] : [];
  });
  const asks = cases.flatMap((result) => {
    const quoted = copies(result).map((copy) => copy.ask);
    return quoted.length ? [quoted.every((ask) => ask && sameWords(ask, quoted[0]!))] : [];
  });
  return {
    firstLineShortRate: round(share(known(all.map((copy) => copy.firstLineShort)))),
    proofBatchRate: round(share(batches)),
    askBatchRate: round(share(asks)),
  };
}

export function summarize(cases: CaseResult[]): Summary {
  const ads = cases.flatMap((result) => result.ads);
  const judged = ads.flatMap((ad) => (ad.judge ? [ad.judge] : []));
  const rejectedRules: Record<string, number> = {};
  for (const rule of [...ads.flatMap((ad) => ad.rejectedRules), ...cases.flatMap((result) => result.failures.flatMap((failure) => failure.rules))]) {
    rejectedRules[rule] = (rejectedRules[rule] ?? 0) + 1;
  }
  const spent = cases.reduce((sum, result) => sum + result.costUsd, 0);
  const walls = cases.map((result) => result.wallMs);
  return {
    runs: cases.length,
    fullBatchRate: round(rate(cases.map((result) => result.saved >= result.expected))),
    adsSaved: ads.length,
    adsExpected: cases.reduce((sum, result) => sum + result.expected, 0),
    conceptsSaved: ads.length + cases.reduce((sum, result) => sum + result.failures.filter((failure) => failure.stage === "image").length, 0),
    conceptsExpected: cases.reduce((sum, result) => sum + result.expected, 0),
    providerFailures: cases.reduce((sum, result) => sum + result.failures.filter((failure) => failure.stage === "provider").length, 0),
    firstTryRate: round(rate(ads.map((ad) => ad.firstTry))),
    offerInFoldRate: round(rate(ads.flatMap((ad) => (ad.offerInFold === null ? [] : [ad.offerInFold])))),
    placeUpFrontRate: round(rate([...ads.map((ad) => ad.placeUpFront), ...cases.flatMap((result) => result.failures.map((failure) => failure.copy?.placeUpFront))]
      .flatMap((value) => (value == null ? [] : [value])))),
    personInSceneRate: round(share([...ads.map((ad) => ad.personInScene), ...cases.flatMap((result) => result.failures.map((failure) => failure.copy?.personInScene))]
      .flatMap((value) => (value == null ? [] : [value])))),
    ...ruleRates(cases),
    scriptRate: round(rate(ads.map((ad) => ad.scriptOk))),
    judgeCopy: round(mean(judged.map((score) => score.copy)), 3),
    judgeImage: round(mean(judged.map((score) => score.image)), 3),
    inventedClaimRate: round(share(judged.map((score) => score.inventedClaims.length > 0))),
    imageTextErrorRate: round(share(judged.map((score) => score.imageTextErrors.length > 0))),
    costPerRunUsd: round(cases.length ? spent / cases.length : 0),
    spentUsd: round(spent),
    wallMsP50: percentile(walls, 0.5),
    wallMsP90: percentile(walls, 0.9),
    rejectedRules,
  };
}

/** Why a run can't gate (or be a baseline): over a third of its concepts hit provider limits; else null. */
export function inconclusive(summary: Summary): string | null {
  const limited = summary.providerFailures ?? 0;
  const expected = summary.conceptsExpected ?? summary.adsExpected;
  return limited * 3 > expected ? `inconclusive: ${limited} of ${expected} concepts hit free-tier provider limits; run again later` : null;
}

/**
 * `deterministic`: a $0 run (#418, CTO Oct 25) is gated on the copy checks alone: copy saved, first-try
 * passes, offer in the fold and script. Judge scores, cost, latency and free-image failures don't count.
 */
export type CompareOptions = { inrPerUsd?: number; maxInrPerRun?: number; wallBudgetMs?: number; deterministic?: boolean };

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** The upgrade-only gate (#416): a change passes when nothing a customer feels got worse. */
export function compareSummaries(before: Summary, after: Summary, options: CompareOptions = {}) {
  const { inrPerUsd = 85, maxInrPerRun = 25, wallBudgetMs = 60_000 } = options;
  const regressions: string[] = [];
  const lower = (label: string, was: number, now: number, tolerance = 0) => {
    if (now < was - tolerance) regressions.push(`${label} ${percent(was)} → ${percent(now)}`);
  };
  if (options.deterministic) {
    const expected = (summary: Summary) => summary.conceptsExpected ?? summary.adsExpected;
    const limitedRun = inconclusive(after);
    if (limitedRun) return { verdict: "fail" as const, regressions: [limitedRun] };
    const copySaved = (summary: Summary) => (summary.conceptsSaved ?? summary.adsSaved) / ((expected(summary) - (summary.providerFailures ?? 0)) || 1);
    lower("copy saved", copySaved(before), copySaved(after));
    lower("first-try passes", before.firstTryRate, after.firstTryRate, 0.1);
    lower("offer in the first 125 characters", before.offerInFoldRate, after.offerInFoldRate);
    if (before.placeUpFrontRate !== undefined && after.placeUpFrontRate !== undefined) lower("place in the headline or first line", before.placeUpFrontRate, after.placeUpFrontRate);
    lower("post text in the chosen script", before.scriptRate, after.scriptRate);
    return { verdict: regressions.length ? "fail" as const : "pass" as const, regressions };
  }
  lower("full batches", before.fullBatchRate, after.fullBatchRate);
  lower("ads saved", before.adsSaved / (before.adsExpected || 1), after.adsSaved / (after.adsExpected || 1));
  lower("first-try passes", before.firstTryRate, after.firstTryRate, 0.1);
  lower("offer in the first 125 characters", before.offerInFoldRate, after.offerInFoldRate);
  if (before.placeUpFrontRate !== undefined && after.placeUpFrontRate !== undefined) lower("place in the headline or first line", before.placeUpFrontRate, after.placeUpFrontRate);
  lower("post text in the chosen script", before.scriptRate, after.scriptRate);
  if (after.judgeCopy < before.judgeCopy - 0.25) regressions.push(`judge copy ${before.judgeCopy} → ${after.judgeCopy}`);
  if (after.judgeImage < before.judgeImage - 0.25) regressions.push(`judge image ${before.judgeImage} → ${after.judgeImage}`);
  if (after.inventedClaimRate > before.inventedClaimRate + 0.05) {
    regressions.push(`invented claims ${percent(before.inventedClaimRate)} → ${percent(after.inventedClaimRate)}`);
  }
  if (after.imageTextErrorRate > before.imageTextErrorRate + 0.1) {
    regressions.push(`garbled image text ${percent(before.imageTextErrorRate)} → ${percent(after.imageTextErrorRate)}`);
  }
  const inr = Math.round(after.costPerRunUsd * inrPerUsd);
  if (inr > maxInrPerRun) regressions.push(`cost ₹${inr} per run is above the ₹${maxInrPerRun} cap`);
  if (after.wallMsP90 > wallBudgetMs && after.wallMsP90 > before.wallMsP90) {
    regressions.push(`Create p90 ${Math.round(after.wallMsP90 / 1000)} s is over the ${wallBudgetMs / 1000} s budget (was ${Math.round(before.wallMsP90 / 1000)} s)`);
  }
  return { verdict: regressions.length ? "fail" as const : "pass" as const, regressions };
}
