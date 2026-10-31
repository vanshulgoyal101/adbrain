// #1291 (#1285 WS4.2) honest-copy rules, shared by the source scan (tests/honest-copy.test.ts) and the rendered-page
// check of the WS1 guard walk (scripts/ws1-walk.mts, #1439): customer-facing words never promise results (#763's list)
// and never show AdBrain's split or margin (#1235, owner P0).
export const HONEST_COPY_RULES: { name: string; pattern: RegExp; negatable?: boolean }[] = [
  { name: "promise: guaranteed", pattern: /\bguarantee[ds]?\b/i, negatable: true },
  { name: "promise: assured", pattern: /\bassured\b/i, negatable: true },
  { name: "promise: will get", pattern: /\bwill get\b/i },
  { name: "promise: 100%", pattern: /\b100\s?%(?=\s+\p{L})/iu },
  { name: "promise: no risk", pattern: /\b(no|zero) risk\b/i },
  // "Best ad" and "Best so far" are measured labels; promotional superlatives are blocked.
  { name: "promise: best promotional", pattern: /\bbest (?:results?|returns?|price|deals?|service|quality)\b|\bbest in town\b/i },
  { name: "promise: best in place", pattern: /\bbest in [A-Z][\p{L}'\u2019-]*/u },
  { name: "promise: ranking", pattern: /(?<![\w#[-])#1(?![\w])|\bnumber one\b|\btop-rated\b/i },
  { name: "split: service fee/allocation", pattern: /\bservice (fee|allocation)s?\b/i },
  { name: "split: allocated to service", pattern: /\ballocated to service\b/i },
  { name: "split: 80%/20%", pattern: /(?<![\w.-])(80|20)\s?%/ },
  { name: "split: margin", pattern: /\bmargin\b/i },
];

export const NEGATED = /\b(no|not|never|without|isn't|aren't|doesn't|don't|can't)\b/i;

/** Rule names a piece of visible text breaks; a negated promise in the same sentence ("no guaranteed results") is honest. */
export function honestCopyFindings(text: string): string[] {
  return HONEST_COPY_RULES.flatMap(({ name, pattern, negatable }) => {
    const hit = pattern.exec(text);
    if (!hit) return [];
    const sentence = text.slice(0, hit.index).split(/[.!?\n]/).at(-1) ?? "";
    return negatable && NEGATED.test(sentence) ? [] : [`${name}: "${text.slice(Math.max(0, hit.index - 40), hit.index + 60).replace(/\s+/g, " ").trim()}"`];
  });
}
