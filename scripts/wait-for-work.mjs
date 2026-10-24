#!/usr/bin/env node
// Blocks until there is new work for one role, so an idle worker chat picks up quick handoffs.
// Run it in the foreground only; it gives up after --max-min (default 30), and nothing is left running.
// It also never outlives its chat: it exits when its parent process is gone, and a second copy for
// the same role exits at once.
// Usage: node scripts/wait-for-work.mjs --me dev2 [--max-min 30] [--poll-sec 90] [--since <ISO time>]
// Exit 0 = work found (printed), 3 = nothing new before --max-min, 4 = another waiter for this role
// is already running, 5 = the chat that started it is gone.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const NAMES = { dev: "Dev", dev2: "Dev 2", dev3: "Dev 3", qa: "QA", devops: "DevOps", cto: "CTO", ceo: "CEO" };

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
// "Dev" must not match "Dev 2" / "Dev 3"; "DevOps" never matches \bDev\b.
const notOther = role === "dev" ? "(?! ?[23])" : "";
const writtenByMe = new RegExp(`^[\\s*#>_\`-]*${name}\\b${notOther}`);
const addressedToMe = new RegExp(
  `(?:^|[\\s>(*_-])${name}${notOther}\\*{0,2}\\s*[:,]|→\\s*\\**${name}\\b${notOther}|@${role}\\b`,
  "m",
);
const repo = values.repo;
const label = role === "ceo" ? "decision" : `owner:${role}`;
const since = values.since ? new Date(values.since).toISOString() : new Date().toISOString();
const deadline = Date.now() + Number(values["max-min"]) * 60_000;
const pollMs = Math.max(15, Number(values["poll-sec"])) * 1000;

// Chats started without a login shell (e.g. VS Code after a reboot) may lack Homebrew's bin on PATH.
const ghEnv = { ...process.env, PATH: [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(":") };

function api(path) {
  // All chats share one gh login (5,000 requests/hour), so each poll makes at most 3 calls.
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

function findWork() {
  const found = [];
  const mine = owned();
  for (const item of mine) {
    if (!startOwned.has(item.number)) found.push(`#${item.number} is now labelled ${label}: ${item.title}`);
  }
  const mineNumbers = new Set(mine.map(item => item.number));
  // One repo-wide call (newest first) instead of one call per updated issue.
  for (const comment of api(`repos/${repo}/issues/comments?since=${since}&sort=created&direction=desc&per_page=100`)) {
    const number = Number(comment.issue_url.split("/").pop());
    const body = comment.body ?? "";
    if (writtenByMe.test(body)) continue;
    if (mineNumbers.has(number) || addressedToMe.test(body)) {
      found.push(`#${number} new comment: "${brief(body)}" ${comment.html_url}`);
    }
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

console.log(`Waiting for work for ${name} since ${since} (up to ${values["max-min"]} min)...`);
let warned = false;
while (Date.now() < deadline) {
  exitIfOrphaned();
  try {
    const found = findWork();
    if (found.length) {
      console.log(`WORK for ${name} (${found.length}):\n- ${found.join("\n- ")}`);
      process.exit(0);
    }
  } catch (error) {
    if (!warned) console.error(`gh api failed, will keep polling: ${error.message.split("\n")[0]}`);
    warned = true;
  }
  await new Promise(resolve => setTimeout(resolve, pollMs));
}
console.log(`No new work for ${name} in ${values["max-min"]} min.`);
process.exit(3);
