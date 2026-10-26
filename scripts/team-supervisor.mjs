#!/usr/bin/env node
// #573 A1: wake-up that doesn't need any chat to stay alive. launchd runs one tick every 10 min; a tick
// starts at most ONE bounded headless Copilot CLI run for the first role that has work while neither its
// waiter nor its chat is alive. Chat liveness = a ~/.copilot/session-state events.jsonl whose first prompt
// is "You are AdBrain's <Role>…" and that changed in the last --idle-min minutes.
// Usage:
//   node scripts/team-supervisor.mjs [--dry-run] [--roles devops,qa,…]   one tick (what launchd runs)
//   node scripts/team-supervisor.mjs --install | --uninstall              the LaunchAgent (StartInterval 600 s)
//   node scripts/team-supervisor.mjs --smoke                              prove the CLI runs headless here
//   node scripts/team-supervisor.mjs --restart-prompt <role|all>          the prompt to resend with create_session
// Each tick also dispatches scheduled-jobs.yml when GitHub's own schedule has lapsed (#692).
// Kill switch: touch ~/.adbrain-supervisor/OFF. Log: ~/.adbrain-supervisor/supervisor.log.
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { NAMES } from "./wait-for-work.mjs";
import { probe } from "./team-status.mjs";

/** Handoff bottlenecks first (reviews, releases), then builders. CTO/CEO coordinate through chat tools, so they're excluded. */
export const ORDER = ["devops", "qa", "reviewer", "qa2", "dev3", "dev", "dev2", "dev4", "cpo", "analyst", "designer"];
export const LABEL = "in.adbrain.team-supervisor";
const HOME = homedir();
export const STATE_DIR = join(HOME, ".adbrain-supervisor");
const SESSIONS = join(HOME, ".copilot", "session-state");
const WT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = ["-y", "@github/copilot@1.0.103"];
const REPO = "vanshulgoyal101/adbrain";

/** Role named by a chat's first prompt ("You are AdBrain's Dev 2. …" → dev2); longest names first so "Dev 2" isn't "Dev". */
export function roleFromPrompt(text) {
  const names = Object.entries(NAMES).sort((a, b) => b[1].length - a[1].length);
  const m = /You are AdBrain's ([A-Za-z]+(?: \d)?)/i.exec(String(text ?? ""));
  if (!m) return null;
  const said = m[1].toLowerCase();
  const hit = names.find(([, name]) => said === name.toLowerCase() || said.startsWith(`${name.toLowerCase()} `));
  return hit ? hit[0] : null;
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
    let mtime;
    try { mtime = statSync(file).mtimeMs; } catch { continue; }
    if (now - mtime > idleMin * 60_000) continue;
    const buf = Buffer.alloc(65_536);
    const fd = openSync(file, "r");
    const n = readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);
    const role = roleFromPrompt(firstPrompt(buf.subarray(0, n).toString("utf8")));
    if (role) live.add(role);
  }
  return live;
}

/** The one role to wake this tick: first in order with work, no waiter and no live chat. */
export function pickRole(statuses, live, roles = ORDER) {
  for (const role of roles) {
    const s = statuses[role];
    if (s?.state === "has-work" && !live.has(role)) return { role, items: s.items };
  }
  return null;
}

/** Runs today, from the state log; the daily cap bounds cost. */
export function runsToday(state, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return (state.runs ?? []).filter((r) => String(r.start).startsWith(day)).length;
}

export function prompt(role, items, runMin) {
  const name = NAMES[role];
  return [
    `You are AdBrain's ${name}, started headless by the #573 A1 supervisor because no ${name} chat is alive.`,
    `Repo: ${WT} (current origin/main). Read AGENTS.md and the ${name} role card in docs/ORCHESTRATION.md first.`,
    `Do ONE unit of work end to end: the first item below. Edit only in your own worktree (\`bash scripts/wt.sh <issue>\`), open a PR, and hand off with the owner label plus one arrow line. Sign every GitHub comment "${name} (headless):".`,
    `Your queue (from wait-for-work):`,
    ...items.slice(0, 3).map((i) => `- ${i}`),
    `Hard limits: no charges or refunds, no Meta writes or ad activation, no secrets printed or changed, no production settings or env changes, no force-push, no db:push, no paid Create beyond your budget share. If the item needs any of these, the owner, or the signed-in browser, post one line on the item saying what is needed (label waiting-owner, decision or owner:devops as fits) and stop.`,
    `Never run wait-for-work and never leave anything running. Finish within ${runMin} minutes, remove your worktree once its PR is merged or handed off, then exit.`,
  ].join("\n");
}

/** The restart prompt a supervisor chat resends with create_session after a VS Code restart (#573; GitHub is the memory). */
export function restartPrompt(role) {
  const name = NAMES[role];
  if (!name) throw new Error(`unknown role ${role}`);
  return [
    `You are AdBrain's ${name}. Your old chat was lost in a VS Code restart, so start fresh.`,
    `Read AGENTS.md, then the Current Dispatch and your role card in docs/ORCHESTRATION.md, then your row and today's priorities on Team board #580.`,
    `Your queue: \`gh issue list -R vanshulgoyal101/adbrain -l owner:${role} --state open\`; work the top item of your #580 row first.`,
    `Work only in your own worktree under ~/Development/copilot/adbrain-wt/ (\`bash scripts/wt.sh <issue>\`). Run commands in the foreground only and never leave anything running. Sign your comments "${name}:".`,
    `When idle, run \`node scripts/wait-for-work.mjs --me ${role}\` in the foreground from a worktree on current origin/main; stop only when it times out.`,
  ].join("\n");
}

/** GitHub runs scheduled-jobs.yml every 2–5 h instead of every 15 min (#692): dispatch when its latest run started over `staleMin` ago and none is waiting or running. */
export function scheduledJobsDue(latest, now = Date.now(), staleMin = 14) {
  if (!latest) return true;
  if (latest.status && latest.status !== "completed") return false;
  const started = Date.parse(latest.createdAt);
  return !Number.isFinite(started) || now - started > staleMin * 60_000;
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

/** Keep this worktree on origin/main so each tick runs current code; skipped if anyone left edits here. */
function refresh() {
  const dirty = execFileSync("git", ["-C", WT, "status", "--porcelain"], { encoding: "utf8" }).trim();
  if (dirty) return log("refresh skipped: worktree has local changes");
  execFileSync("git", ["-C", WT, "fetch", "-q", "origin", "main"]);
  execFileSync("git", ["-C", WT, "checkout", "-q", "--detach", "origin/main"]);
}

function runCli(args, runMin, outFile) {
  return new Promise((done) => {
    const out = openSync(outFile, "a");
    const child = spawn("npx", [...CLI, ...args], { cwd: WT, stdio: ["ignore", out, out], env: { ...process.env, ADBRAIN_HEADLESS: "1" } });
    const timer = setTimeout(() => { log(`run over ${runMin} min, stopping pid ${child.pid}`); child.kill("SIGTERM"); }, runMin * 60_000);
    child.on("exit", (code, signal) => { clearTimeout(timer); closeSync(out); done(signal ? `signal ${signal}` : `exit ${code}`); });
  });
}

const agentArgs = (text, credits) => [
  "-p", text, "-C", WT, "--autopilot", "--no-ask-user", "--allow-all-tools",
  "--deny-tool", "shell(launchctl)", "--deny-tool", "shell(vercel)", "--deny-tool", "shell(supabase)",
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
      credits: { type: "string", default: "150" },
    },
  });
  const roles = values.roles ? values.roles.split(",").map((r) => r.trim()).filter((r) => ORDER.includes(r)) : ORDER;
  const runMin = Number(values["run-min"]);
  const agentFile = join(HOME, "Library", "LaunchAgents", `${LABEL}.plist`);
  const domain = `gui/${process.getuid()}`;

  if (values["restart-prompt"]) {
    const which = values["restart-prompt"] === "all" ? Object.keys(NAMES).filter((r) => r !== "ceo") : [values["restart-prompt"]];
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
  if (existsSync(join(STATE_DIR, "OFF"))) return log("tick skipped: OFF switch");
  dispatchScheduledJobs(values["dry-run"]);
  const state = readState();
  if (runsToday(state) >= Number(values["max-runs-day"])) return log(`tick skipped: daily cap ${values["max-runs-day"]} reached`);
  if (!values["dry-run"]) refresh();

  const live = liveRoles(SESSIONS, Number(values["idle-min"]));
  const statuses = {};
  for (const role of roles) if (!live.has(role)) statuses[role] = probe(role);
  const pick = pickRole(statuses, live, roles);
  const summary = roles.map((r) => `${r}:${live.has(r) ? "live" : statuses[r]?.state}`).join(" ");
  if (!pick) return log(`tick: nothing to wake (${summary})`);
  if (values["dry-run"]) return console.log(`would wake ${NAMES[pick.role]} on: ${pick.items[0]}\n(${summary})`);

  const run = { role: pick.role, item: pick.items[0]?.slice(0, 160), start: new Date().toISOString() };
  log(`waking ${pick.role}: ${run.item} (${summary})`);
  state.runs = [...(state.runs ?? []), run];
  writeState(state);
  run.result = await runCli(agentArgs(prompt(pick.role, pick.items, runMin), values.credits), runMin, join(STATE_DIR, `run-${pick.role}.log`));
  run.end = new Date().toISOString();
  writeState(state);
  log(`run ${pick.role} ended: ${run.result}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
