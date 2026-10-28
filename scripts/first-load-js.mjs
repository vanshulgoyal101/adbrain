// #1850: the first-load JS of the cold-traffic pages (/, /login, /for/*) must not grow by more than 10% against the
// base branch. Next 16 dropped the build's 'First Load JS' column, so this measures what a browser downloads: every
// /_next/static script the page's HTML loads, gzipped, summed per page. Run by the ui-gate CI job against the base
// and this PR's builds (`next start` on two ports). Intended growth: add the `bundle-growth-ok` label to the PR.
//
//   node scripts/first-load-js.mjs --base http://localhost:3001 --head http://localhost:3002 [--allow]
import { gzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export const PAGES = ["/", "/login", "/for/solar"];
const MAX_GROWTH = 0.1;
const MIN_BYTES = 5_000;

/** The page's own Next static scripts (script src and script preloads), each once, in order. */
export function scriptSources(html) {
  const found = [];
  for (const match of html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\sas="script"[^>]*\shref|link[^>]*\shref)="([^"]+)"[^>]*>/g)) {
    const tag = match[0];
    const src = match[1];
    if (!src.startsWith("/_next/static/") || !src.endsWith(".js")) continue;
    if (tag.startsWith("<link") && !/\bas="script"|\brel="modulepreload"/.test(tag)) continue;
    if (!found.includes(src)) found.push(src);
  }
  return found;
}

/** Fails a page whose gzipped first-load JS grew by more than 10% and 5 KB, unless growth is allowed. */
export function verdict(base, head, { allow = false } = {}) {
  const rows = Object.keys(head).map((page) => {
    const before = base[page] ?? 0;
    const after = head[page];
    return { page, base: before, head: after, growth: before ? (after - before) / before : 0 };
  });
  const failed = allow ? [] : rows.filter((row) => row.growth > MAX_GROWTH && row.head - row.base > MIN_BYTES).map((row) => row.page);
  return { rows, failed };
}

async function pageBytes(origin, path, cache) {
  const response = await fetch(new URL(path, origin), { redirect: "follow" });
  if (!response.ok) throw new Error(`${origin}${path} → HTTP ${response.status}`);
  let total = 0;
  for (const src of scriptSources(await response.text())) {
    if (!cache.has(src)) {
      const script = await fetch(new URL(src, origin));
      if (!script.ok) throw new Error(`${origin}${src} → HTTP ${script.status}`);
      cache.set(src, gzipSync(Buffer.from(await script.arrayBuffer())).byteLength);
    }
    total += cache.get(src);
  }
  return total;
}

async function measure(origin) {
  const cache = new Map();
  const sizes = {};
  for (const page of PAGES) sizes[page] = await pageBytes(origin, page, cache);
  return sizes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { base: { type: "string" }, head: { type: "string" }, allow: { type: "boolean", default: false } } });
  if (!values.base || !values.head) throw new Error("Pass --base and --head origins.");
  const [base, head] = [await measure(values.base), await measure(values.head)];
  const { rows, failed } = verdict(base, head, { allow: values.allow });
  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
  for (const row of rows) console.log(`${failed.includes(row.page) ? "FAIL" : "PASS"} ${row.page}: ${kb(row.base)} → ${kb(row.head)} gzipped (${row.growth >= 0 ? "+" : ""}${(row.growth * 100).toFixed(1)}%)`);
  if (values.allow) console.log("Growth allowed by the bundle-growth-ok label.");
  if (failed.length) {
    console.log(`::error::First-load JS grew more than ${MAX_GROWTH * 100}% on ${failed.join(", ")}. Trim the import, or label the PR bundle-growth-ok if it's intended (#1850).`);
    process.exitCode = 1;
  }
}
