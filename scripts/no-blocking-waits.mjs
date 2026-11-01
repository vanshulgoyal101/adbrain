#!/usr/bin/env node
// preToolUse hook (#2481): a chat running a long synchronous command reads no steered
// message until it ends, so refuse sleep/poll waits for deploys and CI. Always exits 0:
// a command preToolUse hook that crashes would deny every tool call.
import { pathToFileURL } from "node:url";

const MAX_SLEEP_SECONDS = 60;
const MAX_LOOP_SLEEP_SECONDS = 15;
const ESCAPE = "# allow-wait";

export const REASON =
  "AdBrain rule (#2472, #2481): don't wait for the deploy train or CI. A sync sleep/poll/watch blocks your chat, so steered messages go unread. " +
  "Enable auto-merge, start your next owned item now, and smoke production on your next pass. " +
  "If nothing is actionable, run `node scripts/wait-for-work.mjs --me <role>`. " +
  `For a genuine short local wait (server start-up), add "${ESCAPE}" to the command.`;

function sleepSeconds(command) {
  return [...command.matchAll(/\bsleep\s+(\d+(?:\.\d+)?)([smh]?)\b/g)].map(([, n, unit]) => {
    const value = Number(n);
    return unit === "h" ? value * 3600 : unit === "m" ? value * 60 : value;
  });
}

function toolArgs(payload) {
  const args = payload?.toolArgs ?? payload?.tool_input;
  if (typeof args !== "string") return args ?? {};
  try {
    return JSON.parse(args);
  } catch {
    return { command: args };
  }
}

export function verdict(payload) {
  const tool = String(payload?.toolName ?? payload?.tool_name ?? "").toLowerCase();
  if (tool !== "bash") return null;
  const args = toolArgs(payload);
  const command = typeof args?.command === "string" ? args.command : "";
  if (!command || args?.mode === "async" || command.includes(ESCAPE)) return null;

  const sleeps = sleepSeconds(command);
  const loops = /\b(while|until|for)\b[\s\S]*\bdo\b/.test(command);
  const blocked =
    sleeps.some((s) => s > MAX_SLEEP_SECONDS) ||
    (loops && sleeps.some((s) => s >= MAX_LOOP_SLEEP_SECONDS)) ||
    /\bgh\s+run\s+watch\b/.test(command) ||
    /\bgh\s+pr\s+checks\b[^\n|;&]*--watch\b/.test(command);
  return blocked ? { permissionDecision: "deny", permissionDecisionReason: REASON } : null;
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const decision = verdict(JSON.parse(input || "{}"));
  if (decision) process.stdout.write(JSON.stringify(decision));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {}).finally(() => process.exit(0));
}
