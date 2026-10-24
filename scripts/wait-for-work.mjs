#!/usr/bin/env node
// Blocks until there is new work for one role, so an idle worker chat picks up quick handoffs.
// Run it in the foreground only; it gives up after --max-min (default 30), and nothing is left running.
// It also never outlives its chat: it exits when its parent process is gone, and a second copy for
// the same role exits at once.
// Usage: node scripts/wait-for-work.mjs --me dev2 [--max-min 30] [--poll-sec 90] [--since <ISO time>]
// Exit 0 = work found (printed), 3 = nothing new before --max-min, 4 = another waiter for this role
// is already running, 5 = the chat that started it is gone.
// Work is: an item newly labelled for you; a comment on your item, addressed to you, or on an open PR
// whose title names your issue (#309 "#274 …"); and, at start and before giving up, any item you own
// where someone else spoke last and didn't address another role (so handoffs made while you were busy
// are never lost). For the CTO it also reports any worker with fewer than 2 actionable items.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const NAMES = { dev: "Dev", dev2: "Dev 2", dev3: "Dev 3", qa: "QA", devops: "DevOps", cto: "CTO", ceo: "CEO" };
// Items parked on someone outside the team never count as waiting on you.
const PARKED = new Set(["waiting-owner", "blocked"]);

/** How a comment relates to `role`: written by it, addressed to it, or addressed only to someone else. */
export function matchers(role) {
  const build = (r) => {
    const name = NAMES[r];
    // "Dev" must not match "Dev 2" / "Dev 3"; "DevOps" never matches \bDev\b.
    const notOther = r === "dev" ? "(?! ?[23])" : "";
    return {
      writtenBy: new RegExp(`^[\\s*#>_\`-]*${name}\\b${notOther}`),
      addressedTo: new RegExp(`(?:^|[\\s>(*_-])${name}${notOther}\\*{0,2}\\s*[:,]|→\\s*\\**${name}\\b${notOther}|@${r}\\b`, "m"),
      // Arrow handoffs only: "QA: …" at the start is the author signing, not an address.
      handedTo: new RegExp(`→\\s*\\**${name}\\b${notOther}|@${r}\\b`),
    };
  };
  const me = build(role);
  const others = Object.keys(NAMES).filter((r) => r !== role).map(build);
  return {
    writtenByMe: (body) => me.writtenBy.test(body),
    addressedToMe: (body) => me.addressedTo.test(body),
    handedToOther: (body) => others.some((o) => o.handedTo.test(body)),
  };
}

/** Issue numbers a PR title names ("#274 Reliable scheduler" → [274]). */
export function linkedIssues(title) {
  return [...(title ?? "").matchAll(/#(\d+)\b/g)].map((m) => Number(m[1]));
}

/** True when an owned item's ball is in your court: nobody spoke yet, or the last word isn't yours and isn't a handoff to someone else. */
export function waitingOnMe(lastBody, m, labels = []) {
  if (labels.some((l) => PARKED.has(l))) return false;
  if (lastBody == null) return true;
  if (m.writtenByMe(lastBody)) return false;
  if (m.addressedToMe(lastBody)) return true;
  return !m.handedToOther(lastBody);
}

export const WORKERS = ["dev", "dev2", "dev3", "qa", "devops"];
export const MIN_QUEUE = 2;

/** Workers with fewer than MIN_QUEUE actionable open items (not parked or waiting on the CEO). The CTO refills these. */
export function lowQueues(issues) {
  const counts = Object.fromEntries(WORKERS.map((r) => [r, 0]));
  for (const issue of issues) {
    const labels = (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));
    if (labels.some((l) => PARKED.has(l) || l === "decision")) continue;
    for (const r of WORKERS) if (labels.includes(`owner:${r}`)) counts[r]++;
  }
  return WORKERS.filter((r) => counts[r] < MIN_QUEUE).map((r) => ({ role: r, count: counts[r] }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();

async function main() {
const { values } = parseArgs({
  options: {
    me: { type: "string" },
    "max-min": { type: "string", default: "30" },
    "poll-sec": { type: "string", default: "90" },
    since: { type: "string" },
    repo: { type: "string", default: process.env.GH_REPO || "vanshulgoyal101/adbrain" },
  },
});

const role = values.me;
if (!role || !(role in NAMES)) {
  console.error(`Usage: --me ${Object.keys(NAMES).join("|")}`);
  process.exit(2);
}
const name = NAMES[role];

// One waiter per role: a second copy exits instead of piling up.
const lock = join(tmpdir(), `adbrain-wait-for-work-${role}.pid`);
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const holder = Number.parseInt((() => { try { return readFileSync(lock, "utf8"); } catch { return ""; } })(), 10);
if (Number.isInteger(holder) && holder !== process.pid && alive(holder)) {
  console.error(`Another waiter for ${name} is already running (pid ${holder}). Not starting a second one.`);
  process.exit(4);
}
writeFileSync(lock, String(process.pid));
const release = () => { try { if (readFileSync(lock, "utf8") === String(process.pid)) rmSync(lock); } catch { /* already gone */ } };
process.on("exit", release);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => process.exit(130));

// The chat that started this is gone once we, or the shell wrapping us (`bash -c "cd … && node …"`),
// are re-parented to launchd/init (pid 1), or the parent died.
const parent = process.ppid;
const parentOf = pid => {
  try { return Number.parseInt(execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).trim(), 10); } catch { return null; }
};
const orphaned = () => process.ppid !== parent || process.ppid === 1 || !alive(parent) || parentOf(parent) === 1;
const exitIfOrphaned = () => {
  if (!orphaned()) return;
  console.log("The chat that started this waiter is gone; exiting.");
  process.exit(5);
};
const { writtenByMe, addressedToMe, handedToOther } = matchers(role);
const m = { writtenByMe, addressedToMe, handedToOther };
const repo = values.repo;
const label = role === "ceo" ? "decision" : `owner:${role}`;
const since = values.since ? new Date(values.since).toISOString() : new Date().toISOString();
const deadline = Date.now() + Number(values["max-min"]) * 60_000;
const pollMs = Math.max(15, Number(values["poll-sec"])) * 1000;

// Chats started without a login shell (e.g. VS Code after a reboot) may lack Homebrew's bin on PATH.
const ghEnv = { ...process.env, PATH: [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(":") };

function api(path) {
  // All chats share one gh login (5,000 requests/hour), so each poll makes at most 5 calls (CTO) or 3–4 (others).
  return JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 , env: ghEnv }));
}

const owned = () => api(`repos/${repo}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`);
const brief = text => text.replace(/\s+/g, " ").trim().slice(0, 200);

async function firstOwned() {
  for (let attempt = 1; ; attempt++) {
    exitIfOrphaned();
    try {
      return owned();
    } catch (error) {
      // A failed first read would make every owned item look newly labelled later.
      if (attempt >= 5) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 5000));
    }
  }
}

const startOwned = new Set((await firstOwned()).map(item => item.number));
// CTO only: workers about to run dry (one extra call per poll). Reported at start, then only when newly low.
const openIssues = () => api(`repos/${repo}/issues?state=open&per_page=100`).filter(item => !item.pull_request);
const describeLow = (low) => low.map(({ role: r, count }) => `Queue low: ${NAMES[r]} has ${count} actionable item(s); refill from the CEO priorities (worker table)`);
let startLow = new Set();

function findWork() {
  const found = [];
  const mine = owned();
  for (const item of mine) {
    if (!startOwned.has(item.number)) found.push(`#${item.number} is now labelled ${label}: ${item.title}`);
  }
  const mineNumbers = new Set(mine.map(item => item.number));
  // A PR whose title names one of your issues is yours to watch too (QA's #309 verdict was for #274's owner).
  const linkedToMine = new Set(api(`repos/${repo}/pulls?state=open&per_page=100`)
    .filter(pr => linkedIssues(pr.title).some(n => mineNumbers.has(n))).map(pr => pr.number));
  // One repo-wide call (newest first) instead of one call per updated issue.
  for (const comment of api(`repos/${repo}/issues/comments?since=${since}&sort=created&direction=desc&per_page=100`)) {
    const number = Number(comment.issue_url.split("/").pop());
    const body = comment.body ?? "";
    if (writtenByMe(body)) continue;
    if (mineNumbers.has(number) || addressedToMe(body) || linkedToMine.has(number)) {
      found.push(`#${number} new comment: "${brief(body)}" ${comment.html_url}`);
    }
  }
  if (role === "cto") {
    const low = lowQueues(openIssues());
    const lowNow = new Set(low.map(({ role: r }) => r));
    // A refilled worker leaves the known-low set, so running dry again alerts again.
    for (const r of startLow) if (!lowNow.has(r)) startLow.delete(r);
    for (const line of describeLow(low.filter(({ role: r }) => !startLow.has(r)))) found.push(line);
  }
  if (role === "cto" || role === "devops") {
    for (const run of api(`repos/${repo}/actions/runs?status=completed&created=${encodeURIComponent(`>=${since}`)}&per_page=30`).workflow_runs ?? []) {
      if (run.conclusion === "failure" && run.event !== "pull_request") {
        found.push(`CI failed: ${run.name} on ${run.head_branch} (${run.head_sha.slice(0, 7)}) ${run.html_url}`);
      }
    }
  }
  return found;
}

// Items you own where the last word is someone else's (said while you were busy, or before this wait).
function backlog() {
  const found = [];
  for (const item of owned().slice(0, 20)) {
    const comments = item.comments ? api(`repos/${repo}/issues/${item.number}/comments?per_page=100`) : [];
    const last = comments.length ? comments[comments.length - 1] : null;
    if (waitingOnMe(last?.body ?? null, m, (item.labels ?? []).map(l => l.name))) {
      found.push(last ? `#${item.number} is waiting on you: "${brief(last.body)}" ${last.html_url}` : `#${item.number} is yours and not started: ${item.title}`);
    }
  }
  return found;
}
const report = (found) => { console.log(`WORK for ${name} (${found.length}):\n- ${found.join("\n- ")}`); process.exit(0); };

try {
  const waiting = backlog();
  if (role === "cto") {
    const low = lowQueues(openIssues());
    startLow = new Set(low.map(({ role: r }) => r));
    waiting.push(...describeLow(low));
  }
  if (waiting.length) report(waiting);
} catch (error) {
  console.error(`Queue check failed, continuing: ${error.message.split("\n")[0]}`);
}
console.log(`Waiting for work for ${name} since ${since} (up to ${values["max-min"]} min)...`);
let warned = false;
while (Date.now() < deadline) {
  exitIfOrphaned();
  try {
    const found = findWork();
    if (found.length) report(found);
  } catch (error) {
    if (!warned) console.error(`gh api failed, will keep polling: ${error.message.split("\n")[0]}`);
    warned = true;
  }
  await new Promise(resolve => setTimeout(resolve, pollMs));
}
try {
  const waiting = backlog();
  if (waiting.length) report(waiting);
} catch { /* fall through to the timeout */ }
console.log(`No new work for ${name} in ${values["max-min"]} min. Next: the next item in your worker-table row, then an unowned \`core\` issue in your area.`);
process.exit(3);
}
