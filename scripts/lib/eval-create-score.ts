/** Pure scoring for scripts/eval-create.ts (#418): no network, unit-tested in CI. */

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
  failures: { angle: string; stage: string; rules: string[]; issues?: string[] }[];
  ads: AdResult[];
  costUsd: number;
  wallMs: number;
};

export type Summary = {
  runs: number;
  fullBatchRate: number;
  adsSaved: number;
  adsExpected: number;
  firstTryRate: number;
  offerInFoldRate: number;
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
    firstTryRate: round(rate(ads.map((ad) => ad.firstTry))),
    offerInFoldRate: round(rate(ads.flatMap((ad) => (ad.offerInFold === null ? [] : [ad.offerInFold])))),
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

export type CompareOptions = { inrPerUsd?: number; maxInrPerRun?: number; wallBudgetMs?: number };

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** The upgrade-only gate (#416): a change passes when nothing a customer feels got worse. */
export function compareSummaries(before: Summary, after: Summary, options: CompareOptions = {}) {
  const { inrPerUsd = 85, maxInrPerRun = 25, wallBudgetMs = 60_000 } = options;
  const regressions: string[] = [];
  const lower = (label: string, was: number, now: number, tolerance = 0) => {
    if (now < was - tolerance) regressions.push(`${label} ${percent(was)} → ${percent(now)}`);
  };
  lower("full batches", before.fullBatchRate, after.fullBatchRate);
  lower("ads saved", before.adsSaved / (before.adsExpected || 1), after.adsSaved / (after.adsExpected || 1));
  lower("first-try passes", before.firstTryRate, after.firstTryRate, 0.1);
  lower("offer in the first 125 characters", before.offerInFoldRate, after.offerInFoldRate);
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
