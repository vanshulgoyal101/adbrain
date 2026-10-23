#!/usr/bin/env node
// Blocks until a worker's GitHub queue changes, so an idle worker chat wakes itself
// instead of waiting for the owner to type "continue".
//
// Usage: node scripts/wait-for-work.mjs --role <dev|dev2|dev3|qa|devops|ceo|cto>
//          [--watch 157,219] [--interval 60] [--timeout 180] [--once]
//
// Run it as an attached async command before ending a turn with nothing to do. It
// exits 0 and prints what changed when an open issue or PR labeled owner:<role>
// (or any open core issue/PR for ceo and cto, or a --watch number) is created,
// relabeled, commented on or pushed to. It exits 2 after --timeout minutes with no
// change (re-arm it), and 1 if GitHub stays unreachable. Read-only: it never writes.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const run = promisify(execFile);
const ROLES = new Set(["dev", "dev2", "dev3", "qa", "devops", "ceo", "cto"]);
const BROAD_ROLES = new Set(["ceo", "cto"]);
const COORDINATION_ISSUE = 74;

export function parseArgs(argv) {
  const options = { role: null, watch: [], intervalSeconds: 60, timeoutMinutes: 180, once: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = () => {
      const next = argv[++index];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    if (flag === "--role") options.role = value();
    else if (flag === "--watch") options.watch = value().split(",").map(item => Number(item.trim().replace(/^#/, "")));
    else if (flag === "--interval") options.intervalSeconds = Number(value());
    else if (flag === "--timeout") options.timeoutMinutes = Number(value());
    else if (flag === "--once") options.once = true;
    else throw new Error(`Unknown option ${flag}`);
  }
  if (!ROLES.has(options.role)) throw new Error(`--role must be one of: ${[...ROLES].join(", ")}`);
  if (options.watch.some(number => !Number.isSafeInteger(number) || number <= 0)) throw new Error("--watch takes issue or PR numbers, e.g. 157,219");
  if (!(options.intervalSeconds >= 15)) throw new Error("--interval must be at least 15 seconds");
  if (!(options.timeoutMinutes > 0)) throw new Error("--timeout must be a positive number of minutes");
  return options;
}

/** Items whose `updatedAt` moved or that are new since the baseline snapshot. */
export function changedItems(baseline, current) {
  return [...current.values()].filter(item => baseline.get(item.number)?.updatedAt !== item.updatedAt);
}

async function gh(args) {
  const { stdout } = await run("gh", args, { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

const PROJECTION = "{number, title, updated_at, html_url, comments, pull_request: (.pull_request != null), labels: [.labels[].name]} | tojson";

function toItem(raw) {
  return {
    number: raw.number,
    title: raw.title,
    updatedAt: raw.updated_at,
    comments: raw.comments ?? 0,
    isPullRequest: Boolean(raw.pull_request),
    labels: (raw.labels ?? []).map(label => (typeof label === "string" ? label : label.name)),
    url: raw.html_url,
  };
}

function parseLines(output) {
  return output.split("\n").filter(Boolean).map(line => toItem(JSON.parse(line)));
}

async function listOpen(repo, label) {
  const query = label ? `&labels=${encodeURIComponent(label)}` : "";
  return parseLines(await gh(["api", "--paginate", `repos/${repo}/issues?state=open&per_page=100${query}`, "--jq", `.[] | ${PROJECTION}`]));
}

async function snapshot(repo, options) {
  const items = new Map();
  const add = item => items.set(item.number, item);
  if (BROAD_ROLES.has(options.role)) {
    for (const item of await listOpen(repo, "core")) add(item);
    for (const item of await listOpen(repo, null)) if (item.isPullRequest) add(item);
  } else {
    for (const item of await listOpen(repo, `owner:${options.role}`)) add(item);
  }
  const watched = BROAD_ROLES.has(options.role) ? [...options.watch, COORDINATION_ISSUE] : options.watch;
  for (const number of new Set(watched)) {
    if (items.has(number)) continue;
    for (const item of parseLines(await gh(["api", `repos/${repo}/issues/${number}`, "--jq", PROJECTION]))) add(item);
  }
  return items;
}

async function latestComment(repo, item) {
  if (!item.comments) return null;
  // The per-issue comments endpoint is oldest-first and ignores sort, so read its last page.
  const page = Math.ceil(item.comments / 100);
  const output = await gh(["api", `repos/${repo}/issues/${item.number}/comments?per_page=100&page=${page}`,
    "--jq", ".[-1] | {created_at, body} | tojson"]).catch(() => "");
  if (!output.trim()) return null;
  const comment = JSON.parse(output.trim());
  return `${comment.created_at}: ${comment.body.replace(/\s+/g, " ").slice(0, 300)}`;
}

async function report(repo, changed) {
  console.log(`Work changed for you (${changed.length}):`);
  for (const item of changed.sort((a, b) => a.number - b.number)) {
    console.log(`- #${item.number} ${item.isPullRequest ? "PR" : "issue"} [${item.labels.join(", ")}] ${item.title}`);
    console.log(`  ${item.url} (updated ${item.updatedAt})`);
    const comment = await latestComment(repo, item);
    if (comment) console.log(`  latest comment ${comment}`);
  }
  console.log("Read these, act, and re-arm this waiter before you go idle again.");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repo = process.env.GH_REPO ?? "vanshulgoyal101/adbrain";
  const baseline = await snapshot(repo, options);
  if (options.once) {
    console.log(`Queue for ${options.role}: ${[...baseline.values()].map(item => `#${item.number}`).join(", ") || "empty"}`);
    return;
  }
  console.log(`Waiting for changes to ${baseline.size} item(s) for ${options.role}; polling every ${options.intervalSeconds}s for up to ${options.timeoutMinutes} min.`);
  const deadline = Date.now() + options.timeoutMinutes * 60_000;
  let failures = 0;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, options.intervalSeconds * 1000));
    let current;
    try {
      current = await snapshot(repo, options);
      failures = 0;
    } catch (error) {
      failures += 1;
      console.error(`GitHub read failed (${failures}/5): ${error.message.split("\n")[0]}`);
      if (failures >= 5) process.exit(1);
      continue;
    }
    const changed = changedItems(baseline, current);
    if (changed.length) {
      await report(repo, changed);
      return;
    }
  }
  console.log(`No change in ${options.timeoutMinutes} min. Re-arm the waiter.`);
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
