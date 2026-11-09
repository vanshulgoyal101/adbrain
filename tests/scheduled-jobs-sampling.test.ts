import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/scheduled-jobs.yml", "utf8").split("\n");

function stepScript(stepName: string): string {
  const start = workflow.findIndex((line) => line.includes(`- name: ${stepName}`));
  const run = workflow.findIndex((line, index) => index > start && line.trim() === "run: |");
  expect(start, `step exists: ${stepName}`).toBeGreaterThanOrEqual(0);
  expect(run, `run block exists: ${stepName}`).toBeGreaterThan(start);
  const body: string[] = [];
  for (const line of workflow.slice(run + 1)) {
    if (line.trim() && !line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return body.join("\n");
}

function runStep(stepName: string, runNumber: number) {
  return spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", stepScript(stepName)], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", GITHUB_RUN_NUMBER: String(runNumber), CRON_SECRET: "" },
  });
}

describe("scheduled advisory monitoring cadence", () => {
  it.each([
    "Pilot settings (#1875)",
    "OpenRouter credit (#449) and AI key health (#1569)",
  ])("samples %s every sixth scheduler launch", (stepName) => {
    const skipped = runStep(stepName, 5);
    expect(skipped.status).toBe(0);
    expect(skipped.stdout).toContain("Advisory monitoring runs once per 6 scheduler launches.");
    expect(skipped.stdout).not.toContain("CRON_SECRET is not set");

    const due = runStep(stepName, 6);
    expect(due.status).toBe(1);
    expect(due.stdout).toContain("CRON_SECRET is not set");
    expect(due.stdout).not.toContain("Advisory monitoring runs once per 6 scheduler launches.");
  });
});
