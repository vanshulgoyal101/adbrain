#!/usr/bin/env node
// Blocks until there is new work for one role, so an idle worker chat picks up quick handoffs.
// Run it in the foreground only; it gives up after --max-min (default 30), and nothing is left running.
// It also never outlives its chat: it exits when its parent process is gone, and a second copy for
// the same role exits at once.
// Usage: node scripts/wait-for-work.mjs --me dev2 [--max-min 30] [--poll-sec 90] [--since <ISO time>]
// Exit 0 = work found (printed), 3 = nothing new before --max-min, 4 = another waiter for this role
// is already running, 5 = the chat that started it is gone.
// Restart-proof (#384): on start it prints your role card, everything labelled for you with its latest
// comment, and worktrees for your issues with uncommitted or unpushed work.
// Work is: an item newly labelled for you; a comment on your item, addressed to you, or on an open PR
// whose title names your issue (#309 "#274 …"); and, at start and before giving up, any item you own
// where someone else spoke last and didn't address another role (so handoffs made while you were busy
// are never lost). For the CTO it also reports any worker with fewer than 3 actionable items and,
// at the end of each wait, workers gone quiet for 90 min and PRs untouched for 60 min.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const NAMES = { dev: "Dev", dev2: "Dev 2", dev3: "Dev 3", dev4: "Dev 4", qa: "QA", qa2: "QA 2", reviewer: "Reviewer", devops: "DevOps", cpo: "CPO", analyst: "Analyst", designer: "Designer", cto: "CTO", ceo: "CEO" };
// Items parked on someone outside the team never count as waiting on you.
const PARKED = new Set(["waiting-owner", "blocked", "parked"]);

/** How a comment relates to `role`: written by it, addressed to it, or addressed only to someone else. */
export function matchers(role) {
  const build = (r) => {
    const name = NAMES[r];
    // "Dev" must not match "Dev 2" / "Dev 3" / "Dev 4", nor "QA" match "QA 2"; "DevOps" never matches \bDev\b.
    const notOther = r === "dev" ? "(?! ?[234])" : r === "qa" ? "(?! ?2)" : "";
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
/** "Next read 2026-10-25T16:00Z" / "Next check 2026-10-26 14:24Z" in a comment: when a scheduled check is due (ms), else null. */
export function snoozedUntil(body) {
  const m = /\bnext (?:read|check)\b[^0-9\n]{0,12}(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?\s*Z/i.exec(body ?? "");
  const t = m ? Date.parse(`${m[1]}T${m[2]}Z`) : NaN;
  return Number.isNaN(t) ? null : t;
}

export function waitingOnMe(lastBody, m, labels = [], now = Date.now()) {
  if (labels.some((l) => PARKED.has(l))) return false;
  if (lastBody == null) return true;
  // Your own last word without a handoff (no "→ Role") means the item is still yours to continue;
  // idle workers otherwise slept with their queue unfinished (Oct 25). A scheduled check
  // ("Next read <ISO time>Z") keeps it quiet until that time (QA 2's live-run reads, #575).
  if (m.writtenByMe(lastBody)) {
    const due = snoozedUntil(lastBody);
    if (due !== null && now < due) { nextDue = Math.min(nextDue, due); return false; }
    return !m.handedToOther(lastBody);
  }
  if (m.addressedToMe(lastBody)) return true;
  // #1478: on a co-owned issue an un-arrowed FYI isn't every owner's turn; only one that names you is.
  if (labels.filter((l) => l.startsWith("owner:")).length > 1) return false;
  return !m.handedToOther(lastBody);
}

/**
 * #1478: comments created since the wait began; `?since=` filters on updated_at, so edits looked new.
 * @template {{ created_at?: string }} T
 * @param {T[]} comments
 * @param {string} since
 * @returns {T[]}
 */
export function freshComments(comments, since) {
  return comments.filter((c) => (c.created_at ?? "") >= since);
}

/**
 * #364: the oldest owned item you can act on now, even when your last word on it was a handoff:
 * not parked, blocked, waiting on the owner, `later`, `standing` (channels, umbrellas) or a CEO `decision`, no open PR naming it,
 * and not in `skip` (items snoozed by a future "Next check"). Null when there is none.
 * @param {Array<{ number: number, title?: string, pull_request?: unknown, labels?: Array<string | { name: string }> }>} items
 * @param {Array<{ title?: string }>} openPulls
 * @param {Set<number>} [skip]
 */
export function nextItem(items, openPulls, skip = new Set()) {
  const hold = new Set([...PARKED, "later", "decision", "standing"]);
  const withPr = new Set(openPulls.flatMap((pr) => linkedIssues(pr.title)));
  const names = (i) => (i.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));
  return items
    .filter((i) => !i.pull_request && !names(i).some((n) => hold.has(n)) && !withPr.has(i.number) && !skip.has(i.number))
    .sort((a, b) => a.number - b.number)[0] ?? null;
}

/** Earliest scheduled check seen this run; the wait loop rechecks the backlog when it passes. */
let nextDue = Infinity;

/** Ready-pool lane per role: briefed, unowned issues labelled `ready` + `lane:<lane>` (#573). */
export const LANES = { dev: "dev", dev2: "dev", dev3: "dev", dev4: "dev", qa: "qa", qa2: "qa", devops: "devops", reviewer: "review", designer: "design", cpo: "product", analyst: "research" };

/**
 * The lane's unclaimed ready issues, core first, oldest first; at most `max`.
 * @param {Array<{ number: number, title?: string, pull_request?: unknown, labels?: Array<string | { name: string }> }>} issues
 * @param {string} role
 * @param {number} [max]
 */
export function readyPool(issues, role, max = 3) {
  const lane = LANES[role];
  if (!lane) return [];
  const names = (i) => (i.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));
  return issues
    .filter((i) => !i.pull_request && names(i).includes("ready") && names(i).includes(`lane:${lane}`)
      && !names(i).some((n) => n.startsWith("owner:") || PARKED.has(n) || n === "decision" || n === `declined:${role}`))
    .sort((a, b) => Number(names(b).includes("core")) - Number(names(a).includes("core")) || a.number - b.number)
    .slice(0, max);
}

export const WORKERS = ["dev", "dev2", "dev3", "dev4", "qa", "qa2", "reviewer", "devops", "cpo", "analyst", "designer"];
export const MIN_QUEUE = 3;

/** Workers with fewer than MIN_QUEUE actionable open items (not parked or waiting on the CEO). The CTO refills these. */
export function queueCounts(issues) {
  const counts = Object.fromEntries(WORKERS.map((r) => [r, 0]));
  for (const issue of issues) {
    const labels = (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));
    if (labels.some((l) => PARKED.has(l) || l === "decision")) continue;
    for (const r of WORKERS) if (labels.includes(`owner:${r}`)) counts[r]++;
  }
  return counts;
}

/** Ready-pool items in a worker's lane count as supply: the waiter offers them, so the queue isn't dry (#573). */

export function lowQueues(issues) {
  const counts = queueCounts(issues);
  // Every role keeps ≥ MIN_QUEUE, the self-sourcing ones too (CEO, Oct 28: their queues drained in minutes, #364).
  return WORKERS.filter((r) => counts[r] + readyPool(issues, r, MIN_QUEUE).length < MIN_QUEUE).map((r) => ({ role: r, count: counts[r] }));
}

export const QUIET_MIN = 90;
export const STALE_PR_MIN = 60;

/**
 * CTO on-track check: workers with queued work who haven't signed a comment in QUIET_MIN
 * minutes, and open PRs untouched for STALE_PR_MIN minutes. `comments` are recent repo
 * comments (any order); `now` is epoch ms.
 */
export function offTrack({ issues, comments, prs, now }) {
  const counts = queueCounts(issues);
  const lastSeen = {};
  for (const c of comments) {
    for (const r of WORKERS) {
      if (matchers(r).writtenByMe(c.body ?? "")) {
        const t = Date.parse(c.created_at);
        if (!(lastSeen[r] >= t)) lastSeen[r] = t;
      }
    }
  }
  const quiet = WORKERS.filter((r) => counts[r] > 0 && !(now - (lastSeen[r] ?? 0) < QUIET_MIN * 60_000))
    .map((r) => ({ role: r, minutes: lastSeen[r] ? Math.floor((now - lastSeen[r]) / 60_000) : null }));
  const stale = prs.filter((pr) => !pr.draft && now - Date.parse(pr.updated_at) >= STALE_PR_MIN * 60_000)
    .map((pr) => ({ number: pr.number, title: pr.title, minutes: Math.floor((now - Date.parse(pr.updated_at)) / 60_000) }));
  return { quiet, stale };
}

/** One line from docs/ORCHESTRATION.md → Role cards ("Same as Dev" resolves to Dev's column). */
/**
 * Workflows failing on `min` or more distinct PR branches in the window: these never reach main/next pushes,
 * so without this the CTO only hears about them from the owner's inbox (#926's core-approval, Oct 27).
 */
export function systemicFailures(runs, min = 2) {
  const byName = new Map();
  for (const run of runs) {
    if (run.event !== "pull_request" || run.conclusion !== "failure") continue;
    const entry = byName.get(run.name) ?? { branches: new Set(), url: run.html_url };
    entry.branches.add(run.head_branch);
    byName.set(run.name, entry);
  }
  return [...byName].filter(([, e]) => e.branches.size >= min)
    .map(([name, e]) => `CI systemic: ${name} failed on ${e.branches.size} PR branches (${[...e.branches].slice(0, 4).join(", ")}); fix the check or the flaky test now ${e.url}`);
}

export function roleCard(markdown, role) {
  const rows = {};
  for (const line of markdown.split("\n")) {
    const m = /^\|\s*\*\*([^*]+)\*\*\s*\|([^|]*)\|([^|]*)\|/.exec(line);
    if (m) rows[m[1].trim()] = { owns: m[2].trim(), handsOff: m[3].trim() };
  }
  const row = rows[NAMES[role]];
  if (!row) return null;
  const same = /^Same as (.+)$/.exec(row.handsOff);
  const handsOff = same && rows[same[1].trim()] ? rows[same[1].trim()].handsOff : row.handsOff;
  return `${NAMES[role]} owns: ${row.owns}. Hand off: ${handsOff}`;
}

/** Your row (and the Everyone row) from the pinned Team board issue's worker table. */
export function boardRow(markdown, role) {
  const rows = new Map();
  for (const line of markdown.split("\n")) {
    const m = /^\|\s*([^|]+?)\s*\|(.*)\|\s*$/.exec(line);
    if (m) rows.set(m[1].replace(/\*/g, "").trim(), m[2].trim());
  }
  const out = ["Everyone", NAMES[role]].filter((w) => rows.has(w)).map((w) => `${w}: ${rows.get(w)}`);
  return out.length ? out.join("\n") : null;
}

/** Worktrees for your issues with work not yet safe in GitHub. `trees`: [{ path, branch, dirty, ahead }]. */
export function unsavedWork(trees, ownedNumbers) {
  return trees.filter((t) => (t.dirty > 0 || t.ahead > 0)
    && [...`${t.path} ${t.branch ?? ""}`.matchAll(/(?:^|[^\d])(\d{2,5})(?=[^\d]|$)/g)].some((m) => ownedNumbers.has(Number(m[1]))));
}

/** The task → skill map from AGENTS.md "Skills" (the only copy): [{ keywords, skills }]. */
export function skillMap(markdown) {
  const rows = [];
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 3 || /^-+$/.test(cells[0]) || cells[0] === "Task") continue;
    const skills = cells[2].split(",").map((x) => x.trim()).filter((x) => /^[a-z0-9-]+$/.test(x));
    const keywords = cells[1].split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (skills.length && keywords.length) rows.push({ keywords, skills });
  }
  return rows;
}

/** 1–2 skills for an item: the best-matching row's two, or the lead skill of the two best rows. */
export function skillsFor(map, title, labels = []) {
  const text = ` ${[title, ...labels].join(" ").toLowerCase()} `;
  const hits = (kw) => new RegExp(`(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(text);
  const scored = map.map((row, index) => ({ row, index, score: row.keywords.filter(hits).length }))
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  if (!scored.length) return [];
  if (scored.length === 1) return scored[0].row.skills.slice(0, 2);
  return [...new Set([scored[0].row.skills[0], scored[1].row.skills[0]])];
}

/** Bot posts that are not a word: the advisory AI review (#587) would wake the PR owner on every push, the daily core scoreboard (#681) every role on #681. */
const BOT_MARKERS = ["<!-- ai-review -->", "<!-- core-scoreboard -->"];

/** The latest word on an item across issue comments and PR reviews (verdicts are reviews since #423), bot posts left out. */
export function latestWord(comments = [], reviews = []) {
  const words = [
    ...comments.filter((c) => !BOT_MARKERS.some((marker) => (c.body ?? "").startsWith(marker))).map((c) => ({ body: c.body ?? "", at: c.created_at, url: c.html_url })),
    ...reviews.filter((r) => (r.body ?? "").trim()).map((r) => ({ body: r.body, at: r.submitted_at, url: r.html_url })),
  ].filter((w) => w.at).sort((a, b) => a.at.localeCompare(b.at));
  return words.at(-1) ?? null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();

async function main() {
const { values } = parseArgs({
  options: {
    me: { type: "string" },
    "max-min": { type: "string", default: "30" },
    "poll-sec": { type: "string", default: "90" },
    // #573: the supervisor's read-only check; never takes the role's lock, so a chat starting its waiter isn't refused.
    probe: { type: "boolean", default: false },
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
if (values.probe) values["max-min"] = "0";
else writeFileSync(lock, String(process.pid));
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
// A probe is a one-shot read for the supervisor, whose parent is launchd (#573), so it never counts as orphaned.
const exitIfOrphaned = () => {
  if (values.probe || !orphaned()) return;
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
  // All chats share one gh login (5,000 requests/hour): each poll makes 4–5 calls plus one per PR updated during the wait.
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
    if (!startOwned.has(item.number)) found.push(`#${item.number} is now labelled ${label}${withSkills(item)}: ${item.title}`);
  }
  const mineNumbers = new Set(mine.map(item => item.number));
  // A PR whose title names one of your issues is yours to watch too (QA's #309 verdict was for #274's owner).
  const openPulls = api(`repos/${repo}/pulls?state=open&per_page=100`);
  const linkedToMine = new Set(openPulls
    .filter(pr => linkedIssues(pr.title).some(n => mineNumbers.has(n))).map(pr => pr.number));
  // Verdicts are PR reviews (#423): read reviews on PRs touched since this wait began.
  for (const pr of openPulls.filter(pr => pr.updated_at >= since)) {
    for (const review of api(`repos/${repo}/pulls/${pr.number}/reviews?per_page=100`)) {
      const body = review.body ?? "";
      if (!body.trim() || !review.submitted_at || review.submitted_at < since || writtenByMe(body)) continue;
      if (mineNumbers.has(pr.number) || addressedToMe(body) || linkedToMine.has(pr.number)) {
        found.push(`#${pr.number} new review: "${brief(body)}" ${review.html_url}`);
      }
    }
  }
  // One repo-wide call (newest first) instead of one call per updated issue.
  const coOwned = new Set(mine.filter(item => (item.labels ?? []).filter(l => l.name.startsWith("owner:")).length > 1).map(item => item.number));
  for (const comment of freshComments(api(`repos/${repo}/issues/comments?since=${since}&sort=created&direction=desc&per_page=100`), since)) {
    const number = Number(comment.issue_url.split("/").pop());
    const body = comment.body ?? "";
    if (writtenByMe(body)) continue;
    // #1478: on a co-owned issue, a comment wakes you only when it names you.
    if (coOwned.has(number) && !addressedToMe(body)) continue;
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
    const runs = api(`repos/${repo}/actions/runs?status=completed&created=${encodeURIComponent(`>=${since}`)}&per_page=100`).workflow_runs ?? [];
    for (const run of runs) {
      if (run.conclusion === "failure" && run.event !== "pull_request") {
        found.push(`CI failed: ${run.name} on ${run.head_branch} (${run.head_sha.slice(0, 7)}) ${run.html_url}`);
      }
    }
    // CTO only: one workflow failing across several PR branches is systemic (a broken check or flaky test), not one PR's bug.
    if (role === "cto") for (const line of systemicFailures(runs)) found.push(line);
  }
  return found;
}

// Items you own where the last word is someone else's (said while you were busy, or before this wait).
function backlog() {
  const found = [];
  const items = owned();
  const snoozed = new Set();
  for (const item of items.slice(0, 20)) {
    const comments = item.comments ? api(`repos/${repo}/issues/${item.number}/comments?per_page=100`) : [];
    const reviews = item.pull_request ? api(`repos/${repo}/pulls/${item.number}/reviews?per_page=100`) : [];
    const last = latestWord(comments, reviews);
    const due = last && writtenByMe(last.body ?? "") ? snoozedUntil(last.body) : null;
    if (due !== null && Date.now() < due) snoozed.add(item.number);
    if (waitingOnMe(last?.body ?? null, m, (item.labels ?? []).map(l => l.name))) {
      found.push(last ? `#${item.number} is waiting on you${withSkills(item)}: "${brief(last.body)}" ${last.url}` : `#${item.number} is yours and not started${withSkills(item)}: ${item.title}`);
    }
  }
  // #364: nothing is waiting on you, but you still own work with no open PR: continue the oldest.
  if (!found.length) {
    const next = nextItem(items, api(`repos/${repo}/pulls?state=open&per_page=100`), snoozed);
    if (next) found.push(`#${next.number} is your next item${withSkills(next)}: ${next.title} (your oldest open item with no PR; continue it, ship it, or hand it off with its label)`);
  }
  // Nothing of yours is actionable: pull the next briefed item from your lane instead of idling.
  if (!found.length) {
    for (const item of readyPool(openIssues(), role, 1)) {
      found.push(`#${item.number} from the ready pool${withSkills(item)}: ${item.title}. Claim it first: gh issue edit ${item.number} --add-label owner:${role} --remove-label ready (or decline: --add-label declined:${role})`);
    }
  }
  return found;
}
// #384: restart-proof start. GitHub and git are the memory: role card, in-flight work, unsaved local work.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const card = (() => { try { return roleCard(readFileSync(join(repoRoot, "docs/ORCHESTRATION.md"), "utf8"), role); } catch { return null; } })();
// The live priorities and queues are the pinned Team board issue (#580), edited without a PR.
const BOARD_ISSUE = 580;
const board = () => { try { return boardRow(api(`repos/${repo}/issues/${BOARD_ISSUE}`).body ?? "", role); } catch { return null; } };
const report = (found) => {
  if (card) console.log(`Role: ${card}`);
  const row = board();
  if (row) console.log(`Team board #${BOARD_ISSUE} (your queue, in order):\n${row}`);
  console.log(`WORK for ${name} (${found.length}):\n- ${found.join("\n- ")}`);
  process.exit(0);
};
const git = (cwd, args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
function localTrees() {
  const trees = [];
  let current = null;
  for (const line of git(repoRoot, ["worktree", "list", "--porcelain"]).split("\n")) {
    if (line.startsWith("worktree ")) trees.push(current = { path: line.slice(9), branch: null });
    else if (line.startsWith("branch ") && current) current.branch = line.slice(7).replace("refs/heads/", "");
  }
  return trees.filter((t) => t.path.includes("/adbrain-wt/") && existsSync(t.path)).map((t) => {
    let dirty = 0; let ahead = 0;
    try { dirty = git(t.path, ["status", "--porcelain"]).split("\n").filter(Boolean).length; } catch { /* unreadable */ }
    try { ahead = Number(git(t.path, ["rev-list", "--count", t.branch ? "@{upstream}..HEAD" : "origin/main..HEAD"])) || 0; } catch {
      try { ahead = Number(git(t.path, ["rev-list", "--count", "origin/main..HEAD"])) || 0; } catch { /* no main */ }
    }
    return { ...t, dirty, ahead };
  });
}
const skillRows = (() => { try { return skillMap(readFileSync(join(repoRoot, "AGENTS.md"), "utf8")); } catch { return []; } })();
const withSkills = (item) => {
  const skills = skillsFor(skillRows, item.title ?? "", (item.labels ?? []).map((l) => (typeof l === "string" ? l : l.name)));
  return skills.length ? ` [skills: ${skills.join(", ")}]` : "";
};
function startupSummary() {
  if (card) console.log(`Role: ${card}`);
  const items = owned();
  console.log(items.length ? `In flight for ${name} (${items.length}):` : `Nothing labelled ${label}; take the next item in your worker-table row.`);
  for (const item of items) {
    const comments = item.comments ? api(`repos/${repo}/issues/${item.number}/comments?per_page=100`) : [];
    const reviews = item.pull_request ? api(`repos/${repo}/pulls/${item.number}/reviews?per_page=100`) : [];
    const last = latestWord(comments, reviews)?.body;
    console.log(`- ${item.pull_request ? "PR " : ""}#${item.number} ${item.title.slice(0, 70)}${withSkills(item)}${last ? ` | last: ${brief(last.split("\n")[0]).slice(0, 120)}` : " | no comments yet"}`);
  }
  const unsaved = unsavedWork(localTrees(), new Set(items.map((item) => item.number)));
  for (const t of unsaved) console.log(`Unsaved local work: ${t.path} (${t.branch ?? "detached"}): ${t.dirty} uncommitted, ${t.ahead} unpushed`);
}

try {
  startupSummary();
} catch (error) {
  console.error(`Start-up summary failed, continuing: ${error.message.split("\n")[0]}`);
}
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
    if (Date.now() >= nextDue) { nextDue = Infinity; const due = backlog(); if (due.length) report(due); }
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
// CTO: a regular on-track review at the end of every wait (once per cycle, so it never spins).
if (role === "cto") {
  try {
    const recent = api(`repos/${repo}/issues/comments?since=${new Date(Date.now() - 3 * 3_600_000).toISOString()}&sort=created&direction=desc&per_page=100`);
    const { quiet, stale } = offTrack({ issues: openIssues(), comments: recent, prs: api(`repos/${repo}/pulls?state=open&per_page=100`), now: Date.now() });
    const lines = [
      ...quiet.map(({ role: r, minutes }) => `Off track? ${NAMES[r]} has queued work but no signed comment in ${minutes ?? "180+"} min: check their issue/PR and nudge or unblock`),
      ...stale.map(({ number, title, minutes }) => `Stale PR #${number} (${minutes} min untouched): ${title}`),
    ];
    if (lines.length) report(lines);
  } catch { /* fall through */ }
}
console.log(`No new work for ${name} in ${values["max-min"]} min. Next: the next item in your worker-table row, then an unowned \`core\` issue in your area. Then run this waiter again; don't stop (owner, Oct 27).`);
process.exit(3);
}
