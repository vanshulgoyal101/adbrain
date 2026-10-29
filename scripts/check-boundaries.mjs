#!/usr/bin/env node
/**
 * ADR-001 (#1792) Phase 1 boundary check (#2070, #2071). Runs dependency-cruiser with `.dependency-cruiser.mjs`
 * plus the source checks C1–C4 it can't express, and compares both with `scripts/boundaries-baseline.json`, which
 * may only shrink:
 * - a violation not in the baseline fails (a new edge);
 * - a baseline entry that no longer occurs fails until it is removed (`--write-baseline`), so every fix shows as −N;
 * - with `--base <git-ref>`, a baseline entry the base branch didn't have fails (the baseline grew);
 * - C4 entries also carry a line ceiling: a listed big file may not grow past it (shrinking passes).
 *
 *   node scripts/check-boundaries.mjs [--base origin/next] [--write-baseline]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const BASELINE = "scripts/boundaries-baseline.json";

export const keyOf = (v) => `${v.rule}\u0000${v.from}\u0000${v.to}`;

const sorted = (list) => [...list].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));

/** dependency-cruiser JSON → [{rule, from, to}] (module-level rules only). */
export function violationsOf(result) {
  const seen = new Map();
  for (const v of result?.summary?.violations ?? []) {
    if (!v?.rule?.name || !v.from || !v.to) continue;
    const item = { rule: v.rule.name, from: v.from, to: v.to };
    seen.set(keyOf(item), item);
  }
  return sorted(seen.values());
}

/** Source checks dependency-cruiser can't see (Reviewer's spec on #1792, #2071). */
export const FILE_LINE_BUDGET = 400;
const META_ADAPTER = /^src\/(channels\/meta|lib\/meta)\//;
const ADAPTER = /^src\/(channels\/[^/]+|lib\/meta)\//;
const GRAPH_URL_ALLOWED = [META_ADAPTER, /^src\/lib\/security\/headers\.ts$/];
const GRAPH_URL = /graph\.facebook\.com|\$\{GRAPH\}|\bGRAPH\s*\+/;
const NOT_A_GRAPH_CALL = [/^src\/lib\/meta\/graph-version\.ts$/, /^src\/lib\/security\/headers\.ts$/];
const PROOF = /appSecretProof|appsecret_proof/;
/** Per channel: the tables and RPCs its adapter may touch. Everything else goes through a service. */
export const CHANNEL_DATA = {
  meta: {
    tables: new Set(["meta_connections", "managed_meta_accounts", "managed_meta_account_events", "whatsapp_number_bindings"]),
    rpc: /^(meta_|managed_meta_account_)/,
  },
};
const channelOf = (file) => (/^src\/lib\/meta\//.test(file) ? "meta" : file.match(/^src\/channels\/([^/]+)\//)?.[1] ?? null);

export const lineCount = (text) => (text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));

/** One source file → C1–C4 violations, in the cruiser's {rule, from, to} shape (C4 adds `lines`). */
export function checkFile(file, text) {
  const out = [];
  const callsGraph = GRAPH_URL.test(text);
  if (callsGraph && !GRAPH_URL_ALLOWED.some(re => re.test(file))) out.push({ rule: "C1-graph-urls-in-meta", from: file, to: "graph.facebook.com" });
  if (callsGraph && !NOT_A_GRAPH_CALL.some(re => re.test(file)) && !PROOF.test(text)) {
    out.push({ rule: "C3-appsecret-proof", from: file, to: "appSecretProof" });
  }
  if (ADAPTER.test(file)) {
    const allowed = CHANNEL_DATA[channelOf(file)] ?? { tables: new Set(), rpc: /^$/ };
    const touched = new Set();
    for (const [, kind, name] of text.matchAll(/\.(from|rpc)\(\s*["'`]([A-Za-z0-9_]+)["'`]/g)) {
      if (kind === "from" ? !allowed.tables.has(name) : !allowed.rpc.test(name)) touched.add(`${kind === "from" ? "table" : "rpc"}:${name}`);
    }
    for (const to of [...touched].sort()) out.push({ rule: "C2-adapter-own-data", from: file, to });
  }
  const lines = lineCount(text);
  if (lines > FILE_LINE_BUDGET) out.push({ rule: "C4-file-size", from: file, to: `> ${FILE_LINE_BUDGET} lines`, lines });
  return out;
}

function sourceFiles(root, dir = "src") {
  const files = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(root, path));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) files.push(path);
  }
  return files;
}

export function scanChecks(root) {
  return sorted(sourceFiles(root).flatMap(file => checkFile(file.split(sep).join("/"), readFileSync(join(root, file), "utf8"))));
}

/** Pure comparison; `base` is the base branch's baseline, or null when unknown. */
export function compare(current, baseline, base = null) {
  const now = new Set(current.map(keyOf));
  const known = new Set(baseline.map(keyOf));
  const added = current.filter(v => !known.has(keyOf(v)));
  const fixed = baseline.filter(v => !now.has(keyOf(v)));
  const baseKeys = base ? new Set(base.map(keyOf)) : null;
  const ceiling = (list) => new Map(list.filter(v => v.lines !== undefined).map(v => [keyOf(v), v.lines]));
  const ceilings = ceiling(baseline);
  const swollen = current.filter(v => ceilings.has(keyOf(v)) && v.lines > ceilings.get(keyOf(v)))
    .map(v => ({ ...v, was: ceilings.get(keyOf(v)) }));
  const baseCeiling = base ? ceiling(base) : new Map();
  const grown = baseKeys
    ? baseline.filter(v => !baseKeys.has(keyOf(v)) || (baseCeiling.has(keyOf(v)) && v.lines > baseCeiling.get(keyOf(v))))
    : [];
  const rules = [...new Set([...current, ...baseline, ...(base ?? [])].map(v => v.rule))].sort();
  const count = (list, rule) => list.filter(v => v.rule === rule).length;
  const perRule = rules.map(rule => ({
    rule, now: count(current, rule), baseline: count(baseline, rule), base: base ? count(base, rule) : null,
  }));
  return { ok: !added.length && !fixed.length && !grown.length && !swollen.length, added, fixed, grown, swollen, perRule };
}

export function report({ added, fixed, grown, swollen = [], perRule }) {
  const lines = ["### Boundaries (ADR-001, #1792)", "", "| Rule | Now | Baseline | vs base |", "| --- | --- | --- | --- |"];
  for (const r of perRule) {
    const delta = r.base === null ? "" : r.baseline - r.base === 0 ? "0" : `${r.baseline - r.base > 0 ? "+" : "−"}${Math.abs(r.baseline - r.base)}`;
    lines.push(`| ${r.rule} | ${r.now} | ${r.baseline} | ${delta} |`);
  }
  const list = (title, items, hint) => {
    if (!items.length) return;
    lines.push("", `**${title} (${items.length})** ${hint}`);
    for (const v of items.slice(0, 50)) {
      const size = v.was !== undefined ? ` (${v.was} → ${v.lines} lines)` : v.lines !== undefined ? ` (${v.lines} lines)` : "";
      lines.push(`- \`${v.rule}\`: \`${v.from}\` → \`${v.to}\`${size}`);
    }
    if (items.length > 50) lines.push(`- … ${items.length - 50} more`);
  };
  list("New violations", added, "— route it through a service/domain module (or split the file); the baseline never grows.");
  list("Fixed, still in the baseline", fixed, `— baseline −${fixed.length}: run \`npm run boundaries -- --write-baseline\` and commit.`);
  list("Big files that grew", swollen, "— a listed file may only shrink: move code out (a new module ≤ 400 lines) before adding.");
  list("Baseline grew vs base", grown, "— the baseline may only shrink.");
  return lines.join("\n");
}

/** → {cruiser, checks}; `checks` is null on a branch that predates #2071. */
export function readBaseline(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed?.cruiser)) throw new Error(`${BASELINE}: expected {"cruiser": [...], "checks": [...]}`);
  const entry = ({ rule, from, to, lines }) => {
    if (rule === "C4-file-size" && !Number.isInteger(lines)) throw new Error(`${BASELINE}: ${from} needs its "lines" ceiling`);
    return lines === undefined ? { rule, from, to } : { rule, from, to, lines };
  };
  return { cruiser: parsed.cruiser.map(entry), checks: Array.isArray(parsed.checks) ? parsed.checks.map(entry) : null };
}

function main(argv) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const baseIndex = argv.indexOf("--base");
  const baseRef = baseIndex >= 0 ? argv[baseIndex + 1] : null;
  const raw = execFileSync(resolve(root, "node_modules/.bin/depcruise"), ["src", "--config", ".dependency-cruiser.mjs", "--output-type", "json"], {
    cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
  });
  const cruiser = violationsOf(JSON.parse(raw));
  const checks = scanChecks(root);
  if (argv.includes("--write-baseline")) {
    writeFileSync(resolve(root, BASELINE), `${JSON.stringify({ cruiser, checks }, null, 2)}\n`);
    console.log(`${BASELINE}: ${cruiser.length} cruiser + ${checks.length} check violations written.`);
    return 0;
  }
  const known = readBaseline(readFileSync(resolve(root, BASELINE), "utf8"));
  if (!known.checks) throw new Error(`${BASELINE}: missing "checks"; run with --write-baseline`);
  let base = null;
  if (baseRef) {
    try {
      const fromBase = readBaseline(execFileSync("git", ["show", `${baseRef}:${BASELINE}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
      // A base that predates the checks can't show their growth; compare the checks with themselves.
      base = [...fromBase.cruiser, ...(fromBase.checks ?? known.checks)];
    } catch {
      console.log(`No ${BASELINE} on ${baseRef}; growth check skipped.`);
    }
  }
  const result = compare([...cruiser, ...checks], [...known.cruiser, ...known.checks], base);
  const text = report(result);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
