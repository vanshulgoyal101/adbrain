#!/usr/bin/env node
// #2481: a chat blocked in a long sync sleep or watch can't read steered messages. Refuse those bash calls and
// say what to do instead. Fails open: any error prints nothing, and the hook config adds `|| true`.
import { pathToFileURL } from "node:url";

const LONG_SLEEP_S = 60;
const UNIT = { s: 1, m: 60, h: 3600, d: 86400 };

function seconds(value, unit = "s") {
  return Number(value) * (UNIT[unit] ?? 1);
}

/** Why this bash command must not run synchronously, or null when it may. */
export function waitReason(command) {
  if (typeof command !== "string" || !command.trim()) return null;
  if (/#\s*allow-wait\b/.test(command) || /wait-for-work\.mjs/.test(command)) return null;
  if (/\bgh\s+run\s+watch\b/.test(command) || /\bgh\s+pr\s+checks\b[^\n;&|]*--watch\b/.test(command)) {
    return "watches a CI run until it ends";
  }
  const loop = /\b(while|until|for)\b[\s\S]*?\bdo\b[\s\S]*?\bsleep\b/.test(command);
  if (loop) return "polls in a sleep loop";
  for (const match of command.matchAll(/\bsleep\s+(\d+(?:\.\d+)?)([smhd]?)\b/g)) {
    if (seconds(match[1], match[2] || "s") >= LONG_SLEEP_S) return `sleeps ${match[1]}${match[2] || "s"}`;
  }
  return null;
}

/** The hook's decision for one preToolUse payload, or null to fall through. */
export function decide(input) {
  if (!input || input.toolName !== "bash") return null;
  let args = input.toolArgs;
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { return null; }
  }
  if (!args || args.mode === "async") return null;
  const reason = waitReason(args.command);
  if (!reason) return null;
  return {
    permissionDecision: "deny",
    permissionDecisionReason: `This command ${reason}, and a chat blocked on it can't read new messages (#2472, #2481). `
      + "Don't wait for CI, a deploy or the train: start your next item and check the result on your next pass. "
      + "Use the waiter (node scripts/wait-for-work.mjs) when nothing is actionable. If the wait is truly needed, add `# allow-wait`.",
  };
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const decision = decide(JSON.parse(raw));
  if (decision) process.stdout.write(JSON.stringify(decision));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {});
}
