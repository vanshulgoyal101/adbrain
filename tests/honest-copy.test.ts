import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// #1291 (#1285 WS4.2): customer-facing strings never promise results (#763's list) and never show AdBrain's
// split or margin (#1235, owner P0). It reads only string literals, template text and JSX text, so code
// names like `serviceAllocationPaise` (internal accounting, #1235) are not words a customer sees.
const ROOTS = ["src/components", "src/app", "src/lib/payments/production-config.ts"];
// Legal pages describe what AdBrain does not promise; they are reviewed separately.
const ALLOWED_FILES = [/^src\/app\/terms\//, /^src\/app\/privacy\//];
// Words already being rewritten elsewhere. Each entry must still match, so it is removed when its fix lands.
const PENDING = [
  { file: "src/lib/payments/production-config.ts", text: "INR 2,000 service allocation", until: "#1306 payment terms v2" },
  { file: "src/lib/payments/production-config.ts", text: "INR 2,000 is allocated to service", until: "#1306 payment terms v2" },
];

const RULES: { name: string; pattern: RegExp; negatable?: boolean }[] = [
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
const CSS = /calc\(|gradient\(|\b(?:w|h|max-h|min-h|max-w|inset|inset-x|top|left|translate-[xy])-\[|^\s*-?[\d.]+%\s*$/;
const NEGATED = /\b(no|not|never|without|isn't|aren't|doesn't|don't|can't)\b/i;

function texts(file: string, source: string): { line: number; text: string }[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: { line: number; text: string }[] = [];
  const visit = (node: ts.Node) => {
    const text = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
      ? node.text : ts.isJsxText(node) ? node.getText() : null;
    if (text?.trim() && !CSS.test(text)) found.push({ line: tree.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: text.replace(/\s+/g, " ") });
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

export function findings(file: string, source: string): string[] {
  // Only a file whose raw text has a rule word is parsed (most have none), so the scan stays fast.
  if (!RULES.some(({ pattern }) => pattern.test(source))) return [];
  return texts(file, source).flatMap(({ line, text }) => RULES.flatMap(({ name, pattern, negatable }) => {
    const hit = pattern.exec(text);
    if (!hit) return [];
    // "No extra charge or guaranteed results": a negated promise in the same sentence is honest.
    const sentence = text.slice(0, hit.index).split(/[.!?]/).at(-1) ?? "";
    if (negatable && NEGATED.test(sentence)) return [];
    if (PENDING.some((entry) => entry.file === file && text.includes(entry.text))) return [];
    return [`${file}:${line} ${name}: "${text.trim().slice(0, 120)}"`];
  }));
}

function sourceFiles(path: string): string[] {
  return statSync(path).isDirectory() ? readdirSync(path).flatMap((name) => sourceFiles(join(path, name))) : /\.tsx?$/.test(path) ? [path] : [];
}

describe("honest copy in UI strings (#1291)", () => {
  it("no customer-facing string promises results or shows AdBrain's split", () => {
    const files = ROOTS.flatMap(sourceFiles).filter((file) => !ALLOWED_FILES.some((allowed) => allowed.test(file)));
    expect(files.length).toBeGreaterThan(100);
    expect(files.flatMap((file) => findings(file, readFileSync(file, "utf8")))).toEqual([]);
  });

  it("each pending allowance still matches its text, so it is removed when its fix lands", () => {
    for (const entry of PENDING) expect(readFileSync(entry.file, "utf8"), `${entry.text} (${entry.until})`).toContain(entry.text);
  });

  it("fails on planted words, and keeps CSS, negated disclaimers and the Best ad label", () => {
    const planted = `export const a = <p>Guaranteed leads in 7 days. You will get 100% more calls. 20% goes to AdBrain as a service fee; our margin is small. The best results, best price, best deal, best service, best quality, best in town, best in Mumbai, #1, number one, top-rated, no risk.</p>;`;
    expect(findings("src/components/x.tsx", planted).map((finding) => finding.split(" ")[1])).toEqual(
      expect.arrayContaining(["promise:", "split:"]),
    );
    expect(findings("src/components/x.tsx", planted)).toHaveLength(10);
    const fine = `const s = { width: "100%" }; const c = "w-[calc(100%-2rem)]"; const g = "linear-gradient(#fff 0%, #000 100%)";
      export const b = <p>Best ad. Best so far. No extra charge or guaranteed results. Not a guaranteed boundary.</p>;`;
    expect(findings("src/components/y.tsx", fine)).toEqual([]);
  });
});
