import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// #766: the kick workflow's script, run as written with a stub gh, so "dispatch only when stale and idle" is tested.
const file = readFileSync(join(process.cwd(), ".github/workflows/scheduled-jobs-kick.yml"), "utf8");

function script(): string {
  const lines = file.split("\n");
  const run = lines.findIndex((line) => line.trim() === "run: |");
  const body: string[] = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() && !line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return body.join("\n");
}

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function kick(runs: { status: string; minutesAgo: number }[]) {
  dir = mkdtempSync(join(tmpdir(), "kick-"));
  const list = runs.map((r) => ({ status: r.status, createdAt: new Date(Date.now() - r.minutesAgo * 60_000).toISOString().replace(/\.\d+Z$/, "Z") }));
  writeFileSync(join(dir, "runs.json"), JSON.stringify(list));
  writeFileSync(join(dir, "gh"), `#!/bin/bash\necho "$*" >> "${dir}/gh.log"\n[ "$1 $2" = "run list" ] && cat "${dir}/runs.json"\nexit 0\n`);
  chmodSync(join(dir, "gh"), 0o755);
  execFileSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script()], {
    env: { PATH: `${dir}:${process.env.PATH}`, STALE_MINUTES: "14" },
    stdio: "pipe",
  });
  return readFileSync(join(dir, "gh.log"), "utf8").includes("workflow run scheduled-jobs.yml --ref main");
}

describe("Scheduled jobs kick (#766)", () => {
  it("dispatches when the newest run is stale and none is active", () => {
    expect(kick([{ status: "completed", minutesAgo: 90 }, { status: "completed", minutesAgo: 200 }])).toBe(true);
  });
  it("dispatches when the workflow has never run", () => {
    expect(kick([])).toBe(true);
  });
  it("skips when the newest run is recent", () => {
    expect(kick([{ status: "completed", minutesAgo: 5 }, { status: "completed", minutesAgo: 200 }])).toBe(false);
  });
  it("skips while a run is queued or in progress", () => {
    expect(kick([{ status: "queued", minutesAgo: 60 }, { status: "completed", minutesAgo: 200 }])).toBe(false);
  });
});

describe("workflow shape", () => {
  it("is trusted-only: default-branch workflow_run, no checkout, only actions:write", () => {
    expect(file).toContain("workflow_run:");
    expect(file).not.toMatch(/pull_request|checkout|actions\/download-artifact/);
    expect(file).toMatch(/permissions:\n {2}actions: write\n/);
  });
});
