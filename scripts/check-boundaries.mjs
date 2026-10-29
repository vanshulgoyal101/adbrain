#!/usr/bin/env node
/**
 * ADR-001 (#1792) Phase 1 boundary check (#2070). Runs dependency-cruiser with `.dependency-cruiser.mjs` and
 * compares its violations with `scripts/boundaries-baseline.json`, which may only shrink:
 * - a violation not in the baseline fails (a new edge);
 * - a baseline entry that no longer occurs fails until it is removed (`--write-baseline`), so every fix shows as −N;
 * - with `--base <git-ref>`, a baseline entry the base branch didn't have fails (the baseline grew).
 *
 *   node scripts/check-boundaries.mjs [--base origin/next] [--write-baseline]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BASELINE = "scripts/boundaries-baseline.json";

/** @typedef {{ rule: string, from: string, to: string }} Violation */

/** @param {Violation} v */
export const keyOf = (v) => `${v.rule}\u0000${v.from}\u0000${v.to}`;

/** @param {Iterable<Violation>} list */
const sorted = (list) => [...list].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));

/**
 * dependency-cruiser JSON → [{rule, from, to}] (module-level rules only).
 * @param {any} result
 * @returns {Violation[]}
 */
export function violationsOf(result) {
  const seen = new Map();
  for (const v of result?.summary?.violations ?? []) {
    if (!v?.rule?.name || !v.from || !v.to) continue;
    const item = { rule: v.rule.name, from: v.from, to: v.to };
    seen.set(keyOf(item), item);
  }
  return sorted(seen.values());
}

/**
 * Pure comparison; `base` is the base branch's baseline, or null when unknown.
 * @param {Violation[]} current
 * @param {Violation[]} baseline
 * @param {Violation[] | null} [base]
 */
export function compare(current, baseline, base = null) {
  const now = new Set(current.map(keyOf));
  const known = new Set(baseline.map(keyOf));
  const added = current.filter(v => !known.has(keyOf(v)));
  const fixed = baseline.filter(v => !now.has(keyOf(v)));
  const baseKeys = base ? new Set(base.map(keyOf)) : null;
  const grown = baseKeys ? baseline.filter(v => !baseKeys.has(keyOf(v))) : [];
  const rules = [...new Set([...current, ...baseline, ...(base ?? [])].map(v => v.rule))].sort();
  const count = (list, rule) => list.filter(v => v.rule === rule).length;
  const perRule = rules.map(rule => ({
    rule, now: count(current, rule), baseline: count(baseline, rule), base: base ? count(base, rule) : null,
  }));
  return { ok: !added.length && !fixed.length && !grown.length, added, fixed, grown, perRule };
}

/** @param {ReturnType<typeof compare>} result */
export function report({ added, fixed, grown, perRule }) {
  const lines = ["### Boundaries (ADR-001, #1792)", "", "| Rule | Now | Baseline | vs base |", "| --- | --- | --- | --- |"];
  for (const r of perRule) {
    const delta = r.base === null ? "" : r.baseline - r.base === 0 ? "0" : `${r.baseline - r.base > 0 ? "+" : "−"}${Math.abs(r.baseline - r.base)}`;
    lines.push(`| ${r.rule} | ${r.now} | ${r.baseline} | ${delta} |`);
  }
  const list = (title, items, hint) => {
    if (!items.length) return;
    lines.push("", `**${title} (${items.length})** ${hint}`);
    for (const v of items.slice(0, 50)) lines.push(`- \`${v.rule}\`: \`${v.from}\` → \`${v.to}\``);
    if (items.length > 50) lines.push(`- … ${items.length - 50} more`);
  };
  list("New violations", added, "— route the import through a service/domain module instead; the baseline never grows.");
  list("Fixed, still in the baseline", fixed, `— baseline −${fixed.length}: run \`npm run boundaries -- --write-baseline\` and commit.`);
  list("Baseline grew vs base", grown, "— the baseline may only shrink.");
  return lines.join("\n");
}

function readBaseline(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed?.cruiser)) throw new Error(`${BASELINE}: expected {"cruiser": [...]}`);
  return parsed.cruiser.map(({ rule, from, to }) => ({ rule, from, to }));
}

function main(argv) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const baseIndex = argv.indexOf("--base");
  const baseRef = baseIndex >= 0 ? argv[baseIndex + 1] : null;
  const raw = execFileSync(resolve(root, "node_modules/.bin/depcruise"), ["src", "--config", ".dependency-cruiser.mjs", "--output-type", "json"], {
    cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
  });
  const current = violationsOf(JSON.parse(raw));
  if (argv.includes("--write-baseline")) {
    writeFileSync(resolve(root, BASELINE), `${JSON.stringify({ cruiser: current }, null, 2)}\n`);
    console.log(`${BASELINE}: ${current.length} known violations written.`);
    return 0;
  }
  const baseline = readBaseline(readFileSync(resolve(root, BASELINE), "utf8"));
  let base = null;
  if (baseRef) {
    try {
      base = readBaseline(execFileSync("git", ["show", `${baseRef}:${BASELINE}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    } catch {
      console.log(`No ${BASELINE} on ${baseRef}; growth check skipped.`);
    }
  }
  const result = compare(current, baseline, base);
  const text = report(result);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
