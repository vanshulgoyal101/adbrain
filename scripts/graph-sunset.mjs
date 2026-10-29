// #1857: warn 90 days before the Graph or Marketing API version we call (src/lib/meta/graph-version.ts) is retired.
// Reads Meta's changelog table (both APIs are on one page). Opens or updates one issue, and also when the page can't be
// read or our version is missing from it. The team supervisor runs it once a day.
//   node scripts/graph-sunset.mjs [--dry-run]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHANGELOG = "https://developers.facebook.com/docs/graph-api/changelog";
const DAY = 86_400_000;

export const configuredVersion = (source = readFileSync(join(root, "src/lib/meta/graph-version.ts"), "utf8")) =>
  source.match(/GRAPH_VERSION\s*=\s*"v(\d+\.\d)"/)?.[1] ?? null;

/** Version → "available until" (ISO date or "TBD") for the Graph and Marketing API tables. */
export function parseChangelog(html) {
  const split = html.search(/Available Marketing API Versions/i);
  const table = (part) => Object.fromEntries([...part.matchAll(
    /v(\d+\.\d)<\/a>[\s\S]{0,400}?<\/td>[\s\S]{0,200}?>(?:[A-Z][a-z]+ \d{1,2}, \d{4}|TBD)<[\s\S]{0,200}?>([A-Z][a-z]+ \d{1,2}, \d{4}|TBD)</g)]
    .map((m) => [m[1], m[2] === "TBD" ? "TBD" : new Date(`${m[2]} UTC`).toISOString().slice(0, 10)]));
  return split < 0 ? { graph: table(html), marketing: {} } : { graph: table(html.slice(0, split)), marketing: table(html.slice(split)) };
}

/** Problems worth an issue: unreadable table, our version missing, or retirement within `warnDays`. */
export function sunsetProblems(tables, version, now = Date.now(), warnDays = 90) {
  const problems = [];
  for (const [api, rows] of Object.entries(tables)) {
    const until = rows[version];
    if (!Object.keys(rows).length) problems.push(`${api}: couldn't read Meta's version table`);
    else if (!until) problems.push(`${api}: v${version} isn't in Meta's table (retired?)`);
    else if (until !== "TBD") {
      const days = Math.floor((Date.parse(until) - now) / DAY);
      if (days <= warnDays) problems.push(`${api}: v${version} is retired on ${until} (${days} days)`);
    }
  }
  return problems;
}

const TITLE = "Meta API version retires soon: upgrade GRAPH_VERSION";

async function main() {
  const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
  const version = configuredVersion();
  const response = await fetch(CHANGELOG, { headers: { "User-Agent": "Mozilla/5.0 (AdBrain version check)", "Accept-Language": "en-US" } });
  const tables = response.ok ? parseChangelog(await response.text()) : { graph: {}, marketing: {} };
  for (const [api, rows] of Object.entries(tables)) console.log(`${api} v${version}: available until ${rows[version] ?? "?"}`);
  const problems = sunsetProblems(tables, version);
  if (!problems.length || values["dry-run"]) return problems.forEach((p) => console.log(`WARN ${p}`));
  const body = `DevOps (automatic, #1857):\n${problems.map((p) => `- ${p}`).join("\n")}\n\nSource: ${CHANGELOG}\n→ CTO: brief the upgrade (bump \`GRAPH_VERSION\`, re-record the core Meta fixtures, walk Launch/Manage).`;
  const open = JSON.parse(execFileSync("gh", ["issue", "list", "-R", "vanshulgoyal101/adbrain", "--state", "open", "--search", `in:title "${TITLE}"`, "--json", "number"], { encoding: "utf8" }));
  if (open.length) execFileSync("gh", ["issue", "comment", String(open[0].number), "-R", "vanshulgoyal101/adbrain", "--body", body], { stdio: "ignore" });
  else execFileSync("gh", ["issue", "create", "-R", "vanshulgoyal101/adbrain", "-l", "core", "-l", "owner:cto", "-t", TITLE, "-b", body], { stdio: "ignore" });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`graph-sunset: ${String(error?.message ?? error).slice(0, 200)}`); process.exitCode = 1; });
