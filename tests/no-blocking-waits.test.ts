import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { verdict } from "../scripts/no-blocking-waits.mjs";

const bash = (command: string, mode = "sync") => ({ toolName: "bash", toolArgs: { command, mode } });
const denied = (payload: unknown) => verdict(payload)?.permissionDecision === "deny";

describe("no-blocking-waits hook (#2481)", () => {
  it("refuses the deploy-wait loops seen on Nov 1", () => {
    expect(denied(bash("sleep 420; cd ~/Development/copilot/adbrain && git fetch -q origin"))).toBe(true);
    expect(denied(bash("sleep 540; date -u +%T; gh run list --workflow 'Deploy train' -L 2"))).toBe(true);
    expect(denied(bash("for i in $(seq 1 45); do git fetch -q origin; sleep 60; done"))).toBe(true);
    expect(denied(bash("n=0; while [ $n -lt 15 ]; do sleep 60; n=$((n+1)); git fetch -q; done"))).toBe(true);
    expect(denied(bash("sleep 5m && gh pr view 1"))).toBe(true);
  });

  it("refuses watching CI", () => {
    expect(denied(bash("gh run watch 123 --exit-status"))).toBe(true);
    expect(denied(bash("gh pr checks 2481 --watch"))).toBe(true);
  });

  it("allows short waits, async commands, the waiter, other tools and the escape hatch", () => {
    expect(verdict(bash("sleep 30; ps -axo pid,command"))).toBeNull();
    expect(verdict(bash("for f in a b; do echo $f; done"))).toBeNull();
    expect(verdict(bash("for i in 1 2 3; do curl -s localhost:3000 && break; sleep 2; done"))).toBeNull();
    expect(verdict(bash("sleep 600", "async"))).toBeNull();
    expect(verdict(bash("node scripts/wait-for-work.mjs --me qa"))).toBeNull();
    expect(verdict(bash("gh pr checks 2481"))).toBeNull();
    expect(verdict(bash("sleep 120 # allow-wait"))).toBeNull();
    expect(verdict({ toolName: "view", toolArgs: { path: "sleep 999" } })).toBeNull();
  });

  it("reads string and VS Code-style payloads", () => {
    expect(denied({ toolName: "bash", toolArgs: JSON.stringify({ command: "sleep 300" }) })).toBe(true);
    expect(denied({ tool_name: "Bash", tool_input: { command: "sleep 300" } })).toBe(true);
  });

  it("runs as a hook: denies with JSON on stdout, always exits 0, and fails open on bad input", () => {
    const run = (input: string) => spawnSync(process.execPath, ["scripts/no-blocking-waits.mjs"], { input, encoding: "utf8" });
    const deny = run(JSON.stringify(bash("sleep 420")));
    expect(deny.status).toBe(0);
    expect(JSON.parse(deny.stdout).permissionDecision).toBe("deny");
    const allow = run(JSON.stringify(bash("git status")));
    expect([allow.status, allow.stdout]).toEqual([0, ""]);
    const broken = run("not json");
    expect([broken.status, broken.stdout]).toEqual([0, ""]);
  });

  it("is wired as a repository preToolUse hook for bash", () => {
    const config = JSON.parse(readFileSync(".github/hooks/no-blocking-waits.json", "utf8"));
    expect(config.hooks.preToolUse[0]).toMatchObject({ type: "command", matcher: "bash", bash: "node scripts/no-blocking-waits.mjs 2>/dev/null || true" });
  });
});
