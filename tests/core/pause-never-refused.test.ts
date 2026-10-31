import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// #1961 (QA): pausing a campaign is the owner's safety stop, so no refusal layer may sit in front of it. Two layers
// live near pause: #1838's throttle memory (crons skip a throttled account) and #1518's switch guard (edits wait while
// a new audience is pending). This makes it a CI rule: the throttle memory is read only by the read-only crons, and
// every switch-guard call in a file that pauses a campaign is gated to activation. (Pausing ONE ad while a switch waits
// is refused on purpose, #1146/#1518: the waiting copy has its own copy of that ad; the campaign pause still works.)

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const parse = (path: string, text = read(path)) => ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const sources = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
  const path = `${dir}/${entry.name}`;
  if (entry.isDirectory()) return sources(path);
  return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
});

/** Read-only scheduled jobs that may skip a throttled account (#1838). Nothing that pauses, activates or enforces spend. */
const THROTTLE_READERS = new Set(["src/app/api/cron/refresh-results/route.ts", "src/app/api/cron/sync-leads/route.ts"]);
/** Server pages that only show the owner a "Meta asked us to wait" line (#2033). They import `metaWaitFor` alone. */
const WAIT_LINE_PAGES = new Set(["src/app/(app)/campaigns/page.tsx", "src/app/(app)/dashboard/page.tsx", "src/app/(app)/leads/page.tsx"]);
/** The owner's campaign pause/activate route and the spend enforcement that pauses on its own. */
const PAUSE_PATHS = ["src/app/api/campaigns/[id]/route.ts", "src/app/api/cron/enforce-spend/route.ts"];

/** Files that import the throttle memory or call its readers. */
function throttleReaders(files: string[]): string[] {
  return files.filter((path) => {
    const text = read(path);
    return /["']@\/services\/meta-throttle["']/.test(text) || /\b(appThrottledUntil|throttledBusinesses)\s*\(/.test(text);
  });
}

/** Each `refuseWhileSwitchPending(` call and whether an enclosing `if` limits it to activation (never a pause). */
function switchGuards(file: ts.SourceFile): { line: number; activationOnly: boolean }[] {
  const found: { line: number; activationOnly: boolean }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "refuseWhileSwitchPending") {
      let activationOnly = false;
      for (let parent: ts.Node | undefined = node.parent; parent && !activationOnly; parent = parent.parent) {
        if (ts.isIfStatement(parent) && parent.thenStatement.pos <= node.pos && node.end <= parent.thenStatement.end) {
          activationOnly = /\b\w+\s*===\s*["']active["']|\b\w+\s*!==\s*["']paused?["']/.test(parent.expression.getText(file));
        }
      }
      found.push({ line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1, activationOnly });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("core: a campaign pause is never refused by the throttle memory or the switch guard (#1961)", () => {
  it("only the read-only crons read the throttle memory (#1838)", () => {
    const readers = throttleReaders(sources("src")).filter((path) => !path.endsWith("src/services/meta-throttle.ts"));
    expect(readers.filter((path) => !THROTTLE_READERS.has(path) && !WAIT_LINE_PAGES.has(path))).toEqual([]);
    for (const path of readers.filter((reader) => WAIT_LINE_PAGES.has(reader))) {
      expect(read(path)).toMatch(/import \{ metaWaitFor \} from "@\/services\/meta-throttle";/);
      expect(/\b(appThrottledUntil|throttledBusinesses|ownerThrottledUntil)\b/.test(read(path))).toBe(false);
    }
    for (const path of PAUSE_PATHS) if (existsSync(join(ROOT, path))) expect(throttleReaders([path])).toEqual([]);
  });

  it("the campaign route's switch guard runs for activation only, so pause goes straight to Meta (#1518)", () => {
    const guards = switchGuards(parse(PAUSE_PATHS[0]));
    expect(guards.length).toBeGreaterThan(0);
    expect(guards.filter((guard) => !guard.activationOnly)).toEqual([]);
  });

  it("spend enforcement (which pauses on its own) calls neither refusal layer", () => {
    if (!existsSync(join(ROOT, PAUSE_PATHS[1]))) return;
    expect(switchGuards(parse(PAUSE_PATHS[1]))).toEqual([]);
  });

  it("control: the checks catch an ungated guard and a new throttle reader", () => {
    const sample = (body: string) => switchGuards(parse("sample.ts", `async function f(action: string) { ${body} }`));
    expect(sample(`if (action === "active") { await refuseWhileSwitchPending(db, id); }`)).toEqual([{ line: 1, activationOnly: true }]);
    expect(sample(`await refuseWhileSwitchPending(db, id);`)).toEqual([{ line: 1, activationOnly: false }]);
    expect(sample(`if (action === "paused") { await refuseWhileSwitchPending(db, id); }`)).toEqual([{ line: 1, activationOnly: false }]);
    expect(/\b(appThrottledUntil|throttledBusinesses)\s*\(/.test("const skip = await throttledBusinesses(admin, ids);")).toBe(true);
  });
});
