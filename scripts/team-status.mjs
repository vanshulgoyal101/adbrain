#!/usr/bin/env node
// #573 A1: which roles have work and no running waiter. The supervisor chat (CEO or CTO) runs this,
// matches roles to chats with list_sessions, and wakes idle or stuck chats with send_message.
// Usage: node scripts/team-status.mjs [--json]. Read-only: one `wait-for-work --probe` per role (no lock).
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NAMES } from "./wait-for-work.mjs";

const waiter = join(dirname(fileURLToPath(import.meta.url)), "wait-for-work.mjs");
// 6: refused to wait because the role owns actionable items (#364).
const STATES = { 0: "has-work", 3: "no-work", 4: "waiting", 6: "has-work" };

/** One role's probe → { state, items }. Exit 4 = its waiter is running, so the chat is healthy. */
export function parseProbe(status, stdout) {
  const state = STATES[status] ?? "error";
  const block = stdout.split("\n");
  const start = block.findIndex((l) => /^WORK for /.test(l));
  const items = start < 0 ? [] : block.slice(start + 1).filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  return { state, items };
}

export function probe(role) {
  try {
    const out = execFileSync(process.execPath, [waiter, "--me", role, "--probe"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000, killSignal: "SIGKILL" });
    return parseProbe(0, out);
  } catch (error) {
    return parseProbe(error.status, String(error.stdout ?? ""));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = Object.keys(NAMES).map((role) => ({ role, name: NAMES[role], ...probe(role) }));
  if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
  else for (const r of rows) console.log(`${r.name.padEnd(9)} ${r.state.padEnd(9)} ${r.items.slice(0, 3).join(" | ").slice(0, 220)}`);
}
