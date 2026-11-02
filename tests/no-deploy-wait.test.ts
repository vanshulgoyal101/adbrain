import { describe, expect, it } from "vitest";
import { decide, waitReason } from "../scripts/no-deploy-wait.mjs";

const bash = (command: string, mode?: string) => ({ toolName: "bash", toolArgs: { command, ...(mode ? { mode } : {}) } });

describe("no-deploy-wait hook (#2481)", () => {
  it.each([
    "sleep 300",
    "sleep 2m && gh pr view 12",
    "while true; do gh run list; sleep 20; done",
    "until gh pr view 5 --json state | grep MERGED; do sleep 30; done",
    "for i in $(seq 20); do curl -s x; sleep 15; done",
    "gh run watch 123",
    "gh pr checks 42 --watch",
  ])("refuses %s", (command) => {
    expect(waitReason(command)).not.toBeNull();
    expect(decide(bash(command))?.permissionDecision).toBe("deny");
  });

  it.each([
    "sleep 5 && curl -s localhost:3000",
    "node scripts/wait-for-work.mjs --me cto",
    "sleep 600 # allow-wait",
    "gh run view 123 --log-failed",
    "npx vitest run tests/foo.test.ts",
    "for f in a b; do echo $f; done",
    "",
  ])("allows %s", (command) => {
    expect(decide(bash(command))).toBeNull();
  });

  it("allows async commands and other tools", () => {
    expect(decide(bash("sleep 300", "async"))).toBeNull();
    expect(decide({ toolName: "view", toolArgs: { path: "/x" } })).toBeNull();
  });

  it("reads toolArgs given as a JSON string and fails open on bad input", () => {
    expect(decide({ toolName: "bash", toolArgs: JSON.stringify({ command: "gh run watch 1" }) })?.permissionDecision).toBe("deny");
    expect(decide({ toolName: "bash", toolArgs: "{not json" })).toBeNull();
    expect(decide(null)).toBeNull();
  });
});
