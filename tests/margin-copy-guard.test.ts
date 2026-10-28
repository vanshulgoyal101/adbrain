import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #1517 (owner P0 #1235): no customer-visible string may reveal AdBrain's split or margin. Scans every file a
 * customer can be shown (`src/components`, `src/app`) and the checkout policy text in `production-config.ts`;
 * internal routes are skipped.
 */
const ROOT = join(__dirname, "..");
const SCANNED = ["src/components", "src/app", "src/lib/payments/production-config.ts"];
const INTERNAL = [/^src\/app\/api\/internal\//];
const BANNED = [/\b20\s?%/i, /\b80\s?%/i, /service allocation/i, /allocated to service/i, /service fee/i, /AdBrain(?:'|’|&apos;)s fee/i];

/**
 * Leaks still live, each tracked on #1235. Fixing one fails this test until its line is removed, so the list only
 * shrinks; a new leak anywhere fails at once.
 */
const KNOWN: string[] = [
  "src/lib/payments/production-config.ts: /allocated to service/i",
  "src/lib/payments/production-config.ts: /service allocation/i",
];

function files(dir: string): string[] {
  if (!statSync(dir).isDirectory()) return [dir];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|json)$/.test(name) ? [path] : [];
  });
}

function leaks(): string[] {
  const found: string[] = [];
  for (const file of SCANNED.flatMap((dir) => files(join(ROOT, dir)))) {
    const path = relative(ROOT, file).split("\\").join("/");
    if (INTERNAL.some((pattern) => pattern.test(path))) continue;
    const text = readFileSync(file, "utf8");
    for (const pattern of BANNED) if (pattern.test(text)) found.push(`${path}: ${pattern}`);
  }
  return found;
}

describe("customer copy never reveals the split or the margin (#1517, #1235)", () => {
  it("only the known, tracked leaks remain", () => {
    expect(leaks().sort()).toEqual([...KNOWN].sort());
  });

  it("catches the words it guards", () => {
    for (const sample of ["20% goes to AdBrain", "80 % ad money", "the service allocation", "INR 2,000 is allocated to service", "a service fee", "AdBrain's fee", "AdBrain&apos;s fee"]) {
      expect(BANNED.some((pattern) => pattern.test(sample)), sample).toBe(true);
    }
    expect(BANNED.some((pattern) => pattern.test("120% of last week, ₹300 a day"))).toBe(false);
  });
});
