#!/usr/bin/env node
// #573 A1: wake-up that doesn't need any chat to stay alive. launchd runs one tick every 10 min; a tick
// starts at most ONE bounded headless Copilot CLI run for the first role that has work while neither its
// waiter nor its chat is alive. Chat liveness = a ~/.copilot/session-state events.jsonl whose first prompt
// is "You are AdBrain's <Role>…" and that changed in the last --idle-min minutes.
// Usage:
//   node scripts/team-supervisor.mjs [--dry-run] [--roles devops,qa,…]   one tick (what launchd runs)
//   node scripts/team-supervisor.mjs --install | --uninstall              the LaunchAgent (StartInterval 600 s)
//   node scripts/team-supervisor.mjs --smoke                              prove the CLI runs headless here
//   node scripts/team-supervisor.mjs --restart-prompt <role|all|ceo>      the prompt to start a chat with create_session (#2476)
// Each tick also dispatches scheduled-jobs.yml when GitHub's own schedule has lapsed (#692), and once a
// night exports production to ~/.adbrain-backups and restore-drills it (#884).
// Kill switch for role runs: touch ~/.adbrain-supervisor/OFF (scheduled-job dispatch and the nightly backup keep running). Log: ~/.adbrain-supervisor/supervisor.log.
import { execFileSync as rawExecFileSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, freemem, homedir, loadavg, totalmem } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { NAMES } from "./wait-for-work.mjs";
import { probe } from "./team-status.mjs";

// One hung network call (a GitHub blip, Oct 27 16:14Z) froze a tick for 53 min and with it every wake-up: cap each call.
const CALL_TIMEOUT_MS = 120_000;
const execFileSync = (cmd, args, opts = {}) => rawExecFileSync(cmd, args, { timeout: CALL_TIMEOUT_MS, killSignal: "SIGKILL", ...opts });

/** Handoff bottlenecks first (reviews, releases), then builders. CTO/CEO coordinate through chat tools, so they're excluded. */
export const ORDER = ["devops", "qa", "reviewer", "qa2", "dev3", "dev", "dev2", "dev4", "dev5", "dev6", "speed", "janitor", "scout", "cpo", "analyst", "designer", "docs"];
export const LABEL = "in.adbrain.team-supervisor";
const HOME = homedir();
export const STATE_DIR = join(HOME, ".adbrain-supervisor");
const SESSIONS = join(HOME, ".copilot", "session-state");
const WT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// ADBRAIN_SUPERVISOR_CLI (JSON array) swaps the CLI for a stub in the detach smoke test; never set it in the LaunchAgent.
const CLI = process.env.ADBRAIN_SUPERVISOR_CLI ? JSON.parse(process.env.ADBRAIN_SUPERVISOR_CLI) : ["-y", "@github/copilot@1.0.103"];
const REPO = "vanshulgoyal101/adbrain";

/** Role named by a chat's first prompt ("You are AdBrain's Dev 2. …" → dev2); longest names first so "Dev 2" isn't "Dev". */
export function roleFromPrompt(text) {
  // "You are AdBrain's Dev 2.", "…'s Product Designer (…)", "…'s Competitive Intelligence Analyst": the role is
  // the first role name in the next few words. Helpers ("CTO helper") are separate chats, not the role itself.
  const m = /You are AdBrain's ([^.,;:(\n]{1,60})/i.exec(String(text ?? ""));
  if (!m) return null;
  const said = ` ${m[1].replace(/[*_`]/g, "").toLowerCase().replace(/\s+/g, " ").trim()} `;
  if (/ helper /.test(said)) return null;
  const names = Object.entries(NAMES).sort((a, b) => b[1].length - a[1].length);
  let best = null;
  for (const [role, name] of names) {
    const at = said.search(new RegExp(` ${name.toLowerCase()}(?=[ ])`));
    if (at >= 0 && (best === null || at < best.at)) best = { role, at };
  }
  return best ? best.role : null;
}

/** Event types after which a chat's turn is over: it ended, checkpointed or shut down (#573, CEO 14:25Z). */
const TURN_OVER = new Set(["assistant.turn_end", "session.usage_checkpoint", "session.shutdown", "session.task_complete", "session.idle", "hook.start", "hook.end"]);

/** The last event type in an events.jsonl tail; hooks after a turn end don't count as work. */
export function lastEventType(tail) {
  const types = String(tail ?? "").split("\n").map((line) => { try { return JSON.parse(line)?.type ?? null; } catch { return null; } }).filter(Boolean);
  const work = types.filter((t) => !t.startsWith("hook."));
  return work.at(-1) ?? types.at(-1) ?? null;
}

/** A chat is mid-turn (working) unless its last event ends the turn. */
export function midTurn(type) {
  return Boolean(type) && !TURN_OVER.has(type);
}

/** First user prompt of an events.jsonl head (only the first 64 KB is read). */
export function firstPrompt(head) {
  for (const line of head.split("\n")) {
    if (!line.includes('"user.message"')) continue;
    try { return JSON.parse(line)?.data?.content ?? null; } catch { return null; }
  }
  return null;
}

/** Roles whose chat (or a headless run) wrote an event in the last idleMin minutes. */
export function liveRoles(dir = SESSIONS, idleMin = 20, now = Date.now()) {
  const live = new Set();
  let entries = [];
  try { entries = readdirSync(dir); } catch { return live; }
  for (const id of entries) {
    const file = join(dir, id, "events.jsonl");
    let stat;
    try { stat = statSync(file); } catch { continue; }
    if (now - stat.mtimeMs > idleMin * 60_000) continue;
    const fd = openSync(file, "r");
    const head = Buffer.alloc(65_536);
    const n = readSync(fd, head, 0, head.length, 0);
    const tailSize = Math.min(16_384, stat.size);
    const tail = Buffer.alloc(tailSize);
    readSync(fd, tail, 0, tailSize, stat.size - tailSize);
    closeSync(fd);
    // A chat that finished its turn without starting its waiter is idle, however recent its last write.
    if (!midTurn(lastEventType(tail.toString("utf8")))) continue;
    const role = roleFromPrompt(firstPrompt(head.subarray(0, n).toString("utf8")));
    if (role) live.add(role);
  }
  return live;
}

/** When each role was last woken, from the state log. */
export function lastWakes(state) {
  const last = {};
  for (const r of state.runs ?? []) if (!last[r.role] || r.start > last[r.role]) last[r.role] = r.start;
  return last;
}

/**
 * The one role to wake this tick, among roles with work, no waiter and no live chat (#573).
 * A role not woken for `overdueMin` goes first (longest wait first, up to two windows, then in order), so the fixed order can't starve the
 * later roles and every role with queued work gets a wake at least hourly, even past the daily cap.
 * Otherwise, under the cap, the first in order.
 */
export function pickRole(statuses, live, roles = ORDER, { last = {}, now = Date.now(), capped = false, overdueMin = 60 } = {}) {
  const ready = roles.filter((role) => statuses[role]?.state === "has-work" && !live.has(role));
  // Waits are capped at two windows, so long-starved roles tie and the bottleneck-first order decides (stable sort).
  const since = (role) => Math.min(last[role] ? now - Date.parse(last[role]) : Infinity, 2 * overdueMin * 60_000);
  const overdue = ready.filter((role) => since(role) >= overdueMin * 60_000).sort((a, b) => since(b) - since(a));
  const role = overdue[0] ?? (capped ? undefined : ready[0]);
  return role ? { role, items: statuses[role].items, overdue: overdue[0] === role } : null;
}

/** The run's final words (the CLI prints its last message), so the log shows what a short run decided (#573). */
export function lastWords(output, max = 220) {
  const paragraphs = String(output ?? "").trim().split(/\n\s*\n/).filter(Boolean);
  const last = (paragraphs.at(-1) ?? "").replace(/\s+/g, " ").trim();
  return last ? last.slice(0, max) : "(no output)";
}

/** Runs today, from the state log. By default only runs that did work count toward the daily cap (#573); `all` counts every run. */
export function runsToday(state, now = new Date(), { all = false } = {}) {
  const day = now.toISOString().slice(0, 10);
  return (state.runs ?? []).filter((r) => String(r.start).startsWith(day) && (all || r.worked !== false)).length;
}

/** A run did work if it left a signed "<Role> (headless):" comment, review or PR on GitHub. */
export function didWork(bodies, role) {
  const sig = `${NAMES[role]} (headless):`;
  return bodies.some((b) => String(b ?? "").includes(sig));
}

/** GitHub text written since `start`: issue/PR comments, PR reviews and PR bodies (a gh failure counts as work, to stay safe on cost). */
function workSince(role, start) {
  try {
    const gh = (path) => JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 }));
    const bodies = gh(`repos/${REPO}/issues/comments?since=${start}&per_page=100`).map((c) => c.body);
    for (const pr of gh(`repos/${REPO}/pulls?state=all&sort=updated&direction=desc&per_page=30`).filter((p) => p.updated_at >= start)) {
      if (pr.created_at >= start) bodies.push(pr.body);
      for (const r of gh(`repos/${REPO}/pulls/${pr.number}/reviews?per_page=100`)) if ((r.submitted_at ?? "") >= start) bodies.push(r.body);
    }
    return didWork(bodies, role);
  } catch {
    return true;
  }
}

export function prompt(role, items, runMin) {
  const name = NAMES[role];
  return [
    `You are AdBrain's ${name}, started headless by the #573 A1 supervisor because no ${name} chat is alive.`,
    `Repo: ${WT} (current origin/main). Read AGENTS.md and the ${name} role card in docs/team/orchestration.md first.`,
    `Do ONE unit of work end to end: the first item below. Edit only in your own worktree (\`bash scripts/wt.sh <issue>\`), open a PR, and hand off with the owner label plus one arrow line. Sign every GitHub comment "${name} (headless):".`,
    `Your queue (from wait-for-work):`,
    ...items.slice(0, 3).map((i) => `- ${i}`),
    `Hard limits: no charges or refunds, no Meta writes or ad activation, no secrets printed or changed, no production settings or env changes, no force-push, no db:push, no paid Create beyond your budget share. If the item needs any of these, the owner, or the signed-in browser, post one line on the item saying what is needed (label waiting-owner, decision or owner:devops as fits) and stop.`,
    `Research and findings go in an issue comment, never as a file in the repo; outreach or contact data never in this public repo.`,
    `Never run wait-for-work and never leave anything running. Finish within ${runMin} minutes, remove your worktree once its PR is merged or handed off, then exit.`,
  ].join("\n");
}

/** Worker roles a CEO keeps one live chat for (everyone but the CEO). */
export const WORKER_ROLES = Object.keys(NAMES).filter((r) => r !== "ceo");

/**
 * #2476: the owner rotates CEO chats often and closes the old one. The new CEO inherits everything from GitHub and
 * git, adopts the live worker chats and respawns missing ones as independent sessions, so closing a CEO chat never
 * takes a worker down with it.
 */
function ceoPrompt() {
  const roles = WORKER_ROLES.map((r) => `${NAMES[r]} (${r})`).join(", ");
  return [
    `You are AdBrain's CEO. The owner closed the previous CEO chat on purpose and will rotate CEO chats often. GitHub and git are your memory, not chat history; you have the owner's full authority.`,
    `1. Read AGENTS.md, then docs/team/orchestration.md (Current Dispatch, role cards, "CEO handover"), Team board #580 with today's priorities, experiments #2360, and .github/skills/multi-worker-delivery/SKILL.md.`,
    `2. Check in, in this order: CI on next and main (\`gh run list --branch next --limit 5\`); open PRs stuck green or red; production smoke and the deploy train; then everything addressed to you: \`gh issue list -l decision --state open\`, \`-l waiting-owner\`, and comments with "→ CEO". Commitments made by earlier CEOs live there or as "Next read <time>" comments; nothing else carries over.`,
    `3. The team: one live chat per role: ${roles}. Run list_sessions (workspace adbrain) and match chats by title "AdBrain <Role>" or a first prompt starting "You are AdBrain's <Role>". Read each chat's latest turn with get_session_context; adopt every live one, and never start a second chat for a role that has one. For each missing role, create_session with relationship "independent", workspace adbrain, title "AdBrain <Role>", and the prompt from \`npm run team-supervisor -- --restart-prompt <role>\`. Never nest worker chats in your own session and never delete another session: closing your chat must not take a worker down. If worker chats are nested inside an earlier CEO's session, ask the owner to close that session first (their worktrees and branches stay on disk, and each replacement's waiter lists its unsaved worktree), then start the independent replacements, so no role ever has two writers.`,
    `4. Reaching a chat: a running chat reads no chat messages (a steer stays "processing" for hours; a queued one lands only when the turn ends). Reach workers through GitHub: the owner label plus "→ <Role>:" on the issue, or a team-wide rule in the Everyone row of #580, which every waiter run prints. Use send_message (queue) only to start a chat whose status is idle. To stop harm now, kill the process by PID and post the rule on its issue.`,
    `5. Your job: delegate, decide, keep labels and priorities honest, and remove waits. Never build product code. Keep every worker on the #580 outcome filter. Money, Meta writes, secrets, migrations and production settings keep their gates. Ask the owner only in one batched list (label waiting-owner). Answer the owner with one line first, then a short table of what you saw / what it is / status, and at most one owner action.`,
    `6. Leave nothing in chat memory: every decision or promise goes on its GitHub issue the moment you make it, so the next CEO can take over at any time. Between owner requests, run \`node scripts/wait-for-work.mjs --me ceo\` in the foreground from a worktree on current origin/main, and run it again when it exits.`,
  ].join("\n");
}

/** The prompt a CEO sends with create_session to (re)start a role's chat (#573, #2476; GitHub is the memory). */
export function restartPrompt(role) {
  const name = NAMES[role];
  if (!name) throw new Error(`unknown role ${role}`);
  if (role === "ceo") return ceoPrompt();
  return [
    `You are AdBrain's ${name}. Your old chat ended (a VS Code restart or a CEO handover), so start fresh.`,
    `Read AGENTS.md, then the Current Dispatch and your role card in docs/team/orchestration.md, then your row and today's priorities on Team board #580.`,
    `Your queue: \`gh issue list -R vanshulgoyal101/adbrain -l owner:${role} --state open\`; work the top item of your #580 row first.`,
    `Work only in your own worktree under ~/Development/copilot/adbrain-wt/ (\`bash scripts/wt.sh <issue>\`). Run commands in the foreground only and never leave anything running. Sign your comments "${name}:".`,
    `This task never completes: do not call task_complete and do not end your turn after an item. Loop: work → \`node scripts/wait-for-work.mjs --me ${role}\` in the foreground from a worktree on current origin/main → work. Stop only when the waiter times out.`,
  ].join("\n");
}

/** GitHub runs scheduled-jobs.yml every 2–5 h instead of every 15 min (#692): dispatch when its latest run started over `staleMin` minutes ago (9: every 10-minute tick) and none is waiting or running. */
export function scheduledJobsDue(latest, now = Date.now(), staleMin = 9) {
  if (!latest) return true;
  if (latest.status && latest.status !== "completed") return false;
  const started = Date.parse(latest.createdAt);
  return !Number.isFinite(started) || now - started > staleMin * 60_000;
}

/** #1495: the reason to hold a headless run while the shared Mac is overloaded, or null to launch. */
export function loadSkip({ load1, cores, availableBytes }, { maxLoadPerCore = 1.5, minFreeGb = 2 } = {}) {
  const perCore = load1 / Math.max(1, cores);
  if (perCore > maxLoadPerCore) return `load ${load1.toFixed(1)} on ${cores} cores (${perCore.toFixed(2)}/core > ${maxLoadPerCore})`;
  const gb = availableBytes / 2 ** 30;
  if (gb < minFreeGb) return `${gb.toFixed(1)} GB memory available (< ${minFreeGb} GB)`;
  return null;
}

/**
 * os.freemem() on macOS counts only never-used pages (≈0.2 GB on a healthy 8 GB Mac), so use the kernel's memory-pressure
 * level instead. Absolute path: the LaunchAgent's PATH has no /usr/sbin, and a missing sysctl fell back to freemem().
 */
export function machineLoad() {
  let availableBytes = freemem();
  if (process.platform === "darwin") {
    const level = Number(spawnSync("/usr/sbin/sysctl", ["-n", "kern.memorystatus_level"], { encoding: "utf8" }).stdout?.trim());
    if (Number.isFinite(level) && level > 0) availableBytes = (totalmem() * level) / 100;
  }
  return { load1: loadavg()[0], cores: cpus().length, availableBytes };
}

export const BACKUP_DIR = join(HOME, ".adbrain-backups");
const BACKUP_KEEP = 7;

/** One export a night: due once the newest is older than the latest 20:00Z (01:30 IST). A Mac that slept through it catches up on wake. */
export function exportDue(newest, now = new Date()) {
  let cutoff = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 20);
  if (now.getTime() < cutoff) cutoff -= 24 * 3_600_000;
  return !newest || Date.parse(newest) < cutoff;
}

/** Exports are named by their ISO time: an encrypted `<time>.tar.gz.cms` (#1762) or a legacy plaintext folder. */
export const EXPORT_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}Z(\.tar\.gz\.cms)?$/;

/** Keep the newest `keep` exports. */
export function exportsToPrune(names, keep = BACKUP_KEEP) {
  return names.filter((n) => EXPORT_NAME.test(n)).sort().reverse().slice(keep);
}

const OPENSSL = ["/opt/homebrew/opt/openssl@3/bin/openssl", "/usr/local/opt/openssl@3/bin/openssl"].find((p) => existsSync(p)) ?? "openssl";

/** #1762: tar the drilled export, CMS-encrypt it to the backup certificate (the private key stays in the keychain), then delete the plaintext. */
export function encryptExport(dir, run = spawnSync) {
  const tarball = `${dir}.tar.gz`, sealed = `${dir}.tar.gz.cms`;
  const tar = run("tar", ["-czf", tarball, "-C", dirname(dir), basename(dir)], { encoding: "utf8" });
  const cms = tar.status === 0 ? run(OPENSSL, ["cms", "-encrypt", "-binary", "-aes256", "-outform", "DER", "-in", tarball, "-out", sealed,
    join(WT, ".github/backup/backup-cert.crt")], { encoding: "utf8" }) : null;
  rmSync(tarball, { force: true });
  rmSync(dir, { recursive: true, force: true });
  if (cms?.status === 0 && existsSync(sealed)) {
    chmodSync(sealed, 0o600);
    return true;
  }
  rmSync(sealed, { force: true });
  return false;
}

const folderTime = (name) => `${name.slice(0, 13)}:${name.slice(14, 16)}:00Z`;

/** #1857: once a UTC day, warn 90 days before the Meta API version we call is retired (scripts/graph-sunset.mjs). */
function dailyGraphSunsetCheck(dry) {
  const stamp = join(STATE_DIR, `graph-sunset-${new Date().toISOString().slice(0, 10)}`);
  if (existsSync(stamp)) return;
  if (dry) return console.log("would check the Meta API version's retirement date");
  const result = spawnSync(process.execPath, ["scripts/graph-sunset.mjs"], { cwd: WT, encoding: "utf8", timeout: 60_000 });
  log(`graph sunset: ${`${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").join(" | ").slice(0, 240)}`);
  if (result.status === 0) writeFileSync(stamp, "");
}

/** Nightly free-plan backup (#884): export, restore-drill it, prune, and open one issue when it fails. */
function nightlyExport(dry) {
  mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const names = readdirSync(BACKUP_DIR).filter((n) => EXPORT_NAME.test(n)).sort();
  const newest = names.at(-1);
  if (!exportDue(newest ? folderTime(newest) : null)) return;
  if (dry) return console.log(`would export production to ${BACKUP_DIR} (newest ${newest ?? "none"})`);
  const name = new Date().toISOString().slice(0, 16).replace(":", "-") + "Z";
  const dir = join(BACKUP_DIR, name);
  const run = (command) => spawnSync(process.execPath, ["scripts/db-export.mjs", command, dir], { cwd: WT, encoding: "utf8", timeout: 15 * 60_000 });
  const exported = run("export");
  const restored = exported.status === 0 ? run("restore") : null;
  // Encrypt whatever the drill says: plaintext never stays on the shared Mac (#1762).
  const sealed = exported.status === 0 && encryptExport(dir);
  const ok = exported.status === 0 && restored?.status === 0 && sealed;
  // The error line first (stacks end in "Node.js vNN"), never anything that looks like a credential.
  const tail = (r) => {
    if (!r) return "not run";
    const lines = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").map((l) => l.trim()).filter((l) => l && !/token|secret|password|apikey/i.test(l));
    const error = lines.find((l) => /^(\w*Error|Error)\b|ERR_|failed/i.test(l));
    return [error, ...lines.slice(-2)].filter(Boolean).join(" | ");
  };
  if (ok) {
    log(`nightly export ${name}: ${tail(restored).slice(0, 200)}`);
    // #1891: after a good backup, drop the core smoke's old unreferenced images so Storage stays under the free plan.
    const pruned = spawnSync(process.execPath, ["scripts/prune-smoke-storage.mjs", "--apply"], { cwd: WT, encoding: "utf8", timeout: 5 * 60_000 });
    log(`smoke storage prune: ${tail(pruned).slice(0, 200)}`);
    for (const old of exportsToPrune([...names, `${name}.tar.gz.cms`])) rmSync(join(BACKUP_DIR, old), { recursive: true, force: true });
    return;
  }
  rmSync(dir, { recursive: true, force: true });
  log(`nightly export ${name} FAILED: export ${exported.status}, restore ${restored?.status ?? "-"}, encrypted ${sealed}`);
  try {
    const title = "Nightly production export failed";
    const open = JSON.parse(execFileSync("gh", ["issue", "list", "-R", REPO, "--state", "open", "--search", `in:title "${title}"`, "--json", "number"], { encoding: "utf8" }));
    if (open.length) return;
    execFileSync("gh", ["issue", "create", "-R", REPO, "-l", "core", "-l", "bug", "-l", "owner:devops", "-t", title, "-b",
      `The supervisor's nightly export (#884) failed at ${name}. Export exit ${exported.status}; restore drill exit ${restored?.status ?? "not run"}; encrypted ${sealed}.\nLast lines: ${tail(restored ?? exported).slice(0, 300)}\n\nRerun by hand: \`node scripts/db-export.mjs export ~/.adbrain-backups/<now>\` then \`restore\` (docs/operations/backups.md#data-safety-and-recovery). Until an export succeeds, no destructive migration.`], { stdio: "ignore" });
  } catch (error) {
    log(`nightly export alert failed: ${String(error?.message ?? error).split("\n")[0].slice(0, 160)}`);
  }
}

/** #1856: once a UTC day, alert at 80% of a Supabase free-plan quota (scripts/plan-usage.mjs opens or updates one issue). */
function dailyUsageCheck(dry) {
  const stamp = join(STATE_DIR, `usage-${new Date().toISOString().slice(0, 10)}`);
  if (existsSync(stamp)) return;
  if (dry) return console.log("would check Supabase free-plan usage");
  const result = spawnSync(process.execPath, ["scripts/plan-usage.mjs"], { cwd: WT, encoding: "utf8", timeout: 2 * 60_000 });
  log(`plan usage: ${`${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").join(" | ").slice(0, 240)}`);
  if (result.status === 0) writeFileSync(stamp, "");
}

/** The nightly encrypted pg_dump (#884): GitHub's schedule is best effort, so dispatch it when its newest run is over 23 h old. */
function dispatchBackup(dry) {
  try {
    const [latest] = JSON.parse(execFileSync("gh", ["run", "list", "-R", REPO, "-w", "db-backup.yml", "-L", "1", "--json", "createdAt,status"], { encoding: "utf8" }));
    if (!scheduledJobsDue(latest, Date.now(), 23 * 60)) return;
    if (dry) return console.log(`would dispatch db-backup.yml (last run ${latest?.createdAt ?? "none"})`);
    execFileSync("gh", ["workflow", "run", "db-backup.yml", "-R", REPO, "--ref", "main"], { stdio: "ignore" });
    log(`dispatched db-backup.yml (last run ${latest?.createdAt ?? "none"})`);
  } catch (error) {
    log(`db-backup dispatch failed: ${String(error?.message ?? error).split("\n")[0].slice(0, 160)}`);
  }
}

/** At most one dispatch per tick; a gh failure is logged and never stops the tick. */
function dispatchScheduledJobs(dry) {
  try {
    const [latest] = JSON.parse(execFileSync("gh", ["run", "list", "-R", REPO, "-w", "scheduled-jobs.yml", "-L", "1", "--json", "createdAt,status"], { encoding: "utf8" }));
    if (!scheduledJobsDue(latest)) return;
    if (dry) return console.log(`would dispatch scheduled-jobs.yml (last run ${latest?.createdAt ?? "none"})`);
    execFileSync("gh", ["workflow", "run", "scheduled-jobs.yml", "-R", REPO, "--ref", "main"], { stdio: "ignore" });
    log(`dispatched scheduled-jobs.yml (last run ${latest?.createdAt ?? "none"})`);
  } catch (error) {
    log(`scheduled-jobs dispatch failed: ${String(error?.message ?? error).split("\n")[0].slice(0, 160)}`);
  }
}

function log(line) {
  mkdirSync(STATE_DIR, { recursive: true });
  appendFileSync(join(STATE_DIR, "supervisor.log"), `${new Date().toISOString()} ${line}\n`);
}

function readState() {
  try { return JSON.parse(readFileSync(join(STATE_DIR, "state.json"), "utf8")); } catch { return { runs: [] }; }
}

function writeState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  state.runs = (state.runs ?? []).slice(-200);
  writeFileSync(join(STATE_DIR, "state.json"), JSON.stringify(state, null, 2));
}

/** Keep this worktree on origin/main so each tick runs current code; false (no refresh) if anyone left edits here. */
function refresh() {
  const dirty = execFileSync("git", ["-C", WT, "status", "--porcelain"], { encoding: "utf8" }).trim();
  if (dirty) {
    log("refresh skipped: worktree has local changes");
    return false;
  }
  // stdio ignored: a killed git can leave git-remote-https holding a pipe, and the call would wait on it.
  try {
    execFileSync("git", ["-C", WT, "fetch", "-q", "origin", "main"], { stdio: "ignore" });
    execFileSync("git", ["-C", WT, "checkout", "-q", "--detach", "origin/main"], { stdio: "ignore" });
  } catch (error) {
    log(`refresh failed, running the current checkout: ${String(error?.message ?? error).split("\n")[0].slice(0, 160)}`);
  }
  return true;
}

/** The headless run still going, if any: runs are detached from the tick (#766), so a tick checks the recorded pid. */
export function activeRun(state, alive = pidAlive) {
  const run = (state.runs ?? []).findLast((r) => r.pid && !r.end);
  return run && alive(run.pid) ? run : null;
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function runCli(args, runMin, outFile) {
  return new Promise((done) => {
    const out = openSync(outFile, "a");
    const child = spawn("npx", [...CLI, ...args], { cwd: WT, stdio: ["ignore", out, out], env: { ...process.env, ADBRAIN_HEADLESS: "1" } });
    const timer = setTimeout(() => { log(`run over ${runMin} min, stopping pid ${child.pid}`); child.kill("SIGTERM"); }, runMin * 60_000);
    child.on("exit", (code, signal) => { clearTimeout(timer); closeSync(out); done(signal ? `signal ${signal}` : `exit ${code}`); });
  });
}

// #1513: deny rules beat --allow-all-tools. `gh auth token` prints the GitHub token; secrets and variables are DevOps's.
// Releases, applied migrations and Meta writes are refused in code via ADBRAIN_HEADLESS (scripts/lib/headless.mjs).
export const agentArgs = (text, credits, wt = WT) => [
  "-p", text, "-C", wt, "--autopilot", "--no-ask-user", "--allow-all-tools",
  "--deny-tool", "shell(launchctl)", "--deny-tool", "shell(vercel)", "--deny-tool", "shell(supabase)",
  "--deny-tool", "shell(gh auth)", "--deny-tool", "shell(gh secret)", "--deny-tool", "shell(gh variable)",
  "--max-ai-credits", String(credits), "-s",
];

/** `roles` null = every role in ORDER at tick time, so new roles need no reinstall. */
function plist(roles) {
  const path = [dirname(process.execPath), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":");
  const cmd = `cd '${WT}' && exec '${process.execPath}' scripts/team-supervisor.mjs${roles ? ` --roles ${roles.join(",")}` : ""}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>${cmd}</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${path}</string></dict>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${join(STATE_DIR, "launchd.out.log")}</string>
  <key>StandardErrorPath</key><string>${join(STATE_DIR, "launchd.err.log")}</string>
</dict></plist>
`;
}

async function main() {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      install: { type: "boolean", default: false },
      uninstall: { type: "boolean", default: false },
      smoke: { type: "boolean", default: false },
      "restart-prompt": { type: "string" },
      roles: { type: "string" },
      "idle-min": { type: "string", default: "20" },
      "run-min": { type: "string", default: "40" },
      "max-runs-day": { type: "string", default: "8" },
      "max-runs-hard": { type: "string", default: "30" },
      "overdue-min": { type: "string", default: "60" },
      credits: { type: "string", default: "150" },
      "run-role": { type: "string" },
      "run-start": { type: "string" },
    },
  });
  const roles = values.roles ? values.roles.split(",").map((r) => r.trim()).filter((r) => ORDER.includes(r)) : ORDER;
  const runMin = Number(values["run-min"]);
  const agentFile = join(HOME, "Library", "LaunchAgents", `${LABEL}.plist`);
  const domain = `gui/${process.getuid()}`;

  if (values["restart-prompt"]) {
    const which = values["restart-prompt"] === "all" ? WORKER_ROLES : [values["restart-prompt"]];
    return console.log(which.map((r) => `## ${NAMES[r]}\n${restartPrompt(r)}`).join("\n\n"));
  }
  if (values.install || values.uninstall) {
    try { execFileSync("launchctl", ["bootout", domain, agentFile], { stdio: "ignore" }); } catch { /* not loaded */ }
    if (values.uninstall) { rmSync(agentFile, { force: true }); return console.log(`removed ${LABEL}`); }
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(agentFile, plist(values.roles ? roles : null));
    execFileSync("launchctl", ["bootstrap", domain, agentFile]);
    return console.log(`installed ${LABEL}: every 10 min from ${WT} for ${roles.join(",")}`);
  }

  mkdirSync(STATE_DIR, { recursive: true });
  if (values.smoke) {
    const out = join(STATE_DIR, "smoke.log");
    const result = await runCli(["-p", "Reply with exactly the word: ok", "-C", WT, "--no-ask-user", "--max-ai-credits", "30", "-s"], 5, out);
    return console.log(`${result}: ${readFileSync(out, "utf8").trim().split("\n").pop()}`);
  }
  // OFF stops only the headless role runs (#1525): production's scheduled jobs and the nightly backup depend on these dispatches.
  dispatchScheduledJobs(values["dry-run"]);
  dispatchBackup(values["dry-run"]);
  dailyGraphSunsetCheck(values["dry-run"]);
  const fresh = values["dry-run"] ? true : refresh();
  nightlyExport(values["dry-run"]);
  dailyUsageCheck(values["dry-run"]);
  // A detached run (#766) finishes the run it was given and records it; the tick that started it has long returned.
  if (values["run-role"]) return finishRun(values["run-role"], values["run-start"], runMin, values.credits);
  if (existsSync(join(STATE_DIR, "OFF"))) return values["dry-run"] ? console.log("no role runs: OFF switch") : log("tick: no role runs (OFF switch)");
  // #1513: runs share this worktree; edits left here (this script included) would be what the next run executes.
  if (!fresh) return log("tick: no role runs: the supervisor worktree has local edits; clean it to resume");
  const state = readState();
  for (const r of state.runs ?? []) if (r.pid && !r.end && !pidAlive(r.pid)) Object.assign(r, { end: new Date().toISOString(), result: "lost (process gone)" });
  const busy = activeRun(state);
  if (busy) return log(`tick: ${busy.role} run still going (pid ${busy.pid}, since ${busy.start})`);
  // The hard ceiling bounds cost whatever the runs did; the daily cap counts only runs that did work.
  if (runsToday(state, new Date(), { all: true }) >= Number(values["max-runs-hard"])) return log(`tick skipped: hard ceiling ${values["max-runs-hard"]} runs reached`);
  const capped = runsToday(state) >= Number(values["max-runs-day"]);

  const live = liveRoles(SESSIONS, Number(values["idle-min"]));
  const statuses = {};
  for (const role of roles) if (!live.has(role)) statuses[role] = probe(role);
  const pick = pickRole(statuses, live, roles, { last: lastWakes(state), capped, overdueMin: Number(values["overdue-min"]) });
  const summary = roles.map((r) => `${r}:${live.has(r) ? "live" : statuses[r]?.state}`).join(" ");
  if (!pick) return log(capped ? `tick: daily cap ${values["max-runs-day"]} reached, nobody overdue (${summary})` : `tick: nothing to wake (${summary})`);
  const overloaded = loadSkip(machineLoad(), {
    maxLoadPerCore: Number(process.env.ADBRAIN_SUPERVISOR_MAX_LOAD ?? 1.5),
    minFreeGb: Number(process.env.ADBRAIN_SUPERVISOR_MIN_FREE_GB ?? 2),
  });
  if (overloaded) {
    const why = `tick skipped: Mac overloaded, ${overloaded}; would wake ${pick.role}`;
    return values["dry-run"] ? console.log(why) : log(why);
  }
  if (values["dry-run"]) return console.log(`would wake ${NAMES[pick.role]}${pick.overdue ? " (overdue)" : ""} on: ${pick.items[0]}\n(${summary})`);

  const run = { role: pick.role, item: pick.items[0]?.slice(0, 160), items: pick.items.slice(0, 3), start: new Date().toISOString() };
  log(`waking ${pick.role}${pick.overdue ? " (overdue)" : ""}${capped ? " past the daily cap" : ""}: ${run.item} (${summary})`);
  // Detached, so this tick returns and the next ones keep dispatching scheduled jobs on time (#766).
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--run-role", pick.role, "--run-start", run.start, "--run-min", String(runMin), "--credits", String(values.credits)],
    { cwd: WT, detached: true, stdio: "ignore" });
  child.unref();
  run.pid = child.pid;
  state.runs = [...(state.runs ?? []), run];
  writeState(state);
}

/** Runs one headless role run to the end and records it on its state entry (re-read: ticks may have written meanwhile). */
async function finishRun(role, start, runMin, credits) {
  const entry = readState().runs?.find((r) => r.role === role && r.start === start);
  const items = entry?.items ?? (entry?.item ? [entry.item] : []);
  const runLog = join(STATE_DIR, `run-${role}.log`);
  writeFileSync(runLog, "");
  const result = await runCli(agentArgs(prompt(role, items, runMin), credits), runMin, runLog);
  const state = readState();
  const run = state.runs?.find((r) => r.role === role && r.start === start) ?? { role, start };
  if (!state.runs?.includes(run)) state.runs = [...(state.runs ?? []), run];
  run.result = result;
  run.summary = lastWords(readFileSync(runLog, "utf8"));
  run.end = new Date().toISOString();
  run.worked = workSince(role, start);
  writeState(state);
  log(`run ${role} ended: ${run.result}${run.worked ? "" : " (no signed GitHub work: not counted)"} · ${run.summary}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
