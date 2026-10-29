import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// #2029: a job timeout kills the runner before any `if: failure()` alert, and a cancelled job runs none.
const workflow = (name: string) => readFileSync(join(process.cwd(), ".github/workflows", name), "utf8").split("\n");

function jobBudgets(lines: string[]) {
  const jobs: { name: string; limit?: number; steps: { name: string; limit?: number }[] }[] = [];
  let inJobs = false;
  for (const line of lines) {
    if (line === "jobs:") { inJobs = true; continue; }
    if (!inJobs) continue;
    const job = /^ {2}([\w-]+):$/.exec(line);
    if (job) { jobs.push({ name: job[1], steps: [] }); continue; }
    const current = jobs.at(-1);
    if (!current) continue;
    const jobLimit = /^ {4}timeout-minutes: (\d+)$/.exec(line);
    if (jobLimit) current.limit = Number(jobLimit[1]);
    const step = /^ {6}- (?:name|uses|run): (.*)$/.exec(line);
    if (step) current.steps.push({ name: step[1] });
    const stepLimit = /^ {8}timeout-minutes: (\d+)$/.exec(line);
    if (stepLimit && current.steps.length) current.steps.at(-1)!.limit = Number(stepLimit[1]);
  }
  return jobs;
}

describe.each(["deploy-train.yml", "production-guard.yml"])("%s time budget", (name) => {
  const jobs = jobBudgets(workflow(name));

  it("bounds every step so the failure alert still runs inside the job limit", () => {
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.limit, `${job.name} job limit`).toBeGreaterThan(0);
      for (const step of job.steps) expect(step.limit, `${job.name}: ${step.name}`).toBeGreaterThan(0);
      const total = job.steps.reduce((sum, step) => sum + (step.limit ?? 0), 0);
      expect(total, `${job.name}: step bounds ${total} > job ${job.limit}`).toBeLessThanOrEqual(job.limit!);
    }
  });
});

function stepScript(file: string, stepName: string): string {
  const lines = workflow(file);
  const start = lines.findIndex((line) => line.includes(`- name: ${stepName}`));
  const run = lines.findIndex((line, index) => index > start && line.trim() === "run: |");
  const body: string[] = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() && !line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return body.join("\n");
}

let dir = "";
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });

const minutesAgo = (minutes: number) => `${Math.floor(Date.now() / 1000) - minutes * 60} +0000`;

function git(cwd: string, args: string[], date?: string) {
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
  if (date) Object.assign(env, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return execFileSync("git", ["-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false", ...args], { cwd, env, encoding: "utf8" });
}

// A PR merge into next: a branch commit from days ago, merged with --no-ff at `mergedMinutesAgo`.
function mergeIntoNext(origin: string, branch: string, mergedMinutesAgo: number) {
  git(origin, ["checkout", "-q", "-b", branch, "next"]);
  writeFileSync(join(origin, branch), branch);
  git(origin, ["add", branch]);
  git(origin, ["commit", "-q", "-m", branch], minutesAgo(3 * 24 * 60));
  git(origin, ["checkout", "-q", "next"]);
  git(origin, ["merge", "-q", "--no-ff", "-m", `merge ${branch}`, branch], minutesAgo(mergedMinutesAgo));
}

function runWatchdog(merges: number[], openIssue = "") {
  dir = mkdtempSync(join(tmpdir(), "train-watchdog-"));
  const origin = join(dir, "server", "repo");
  mkdirSync(origin, { recursive: true });
  git(origin, ["init", "-q"]);
  writeFileSync(join(origin, "README"), "base");
  git(origin, ["add", "README"]);
  git(origin, ["commit", "-q", "-m", "base"], minutesAgo(10 * 24 * 60));
  git(origin, ["branch", "next"]);
  git(origin, ["checkout", "-q", "next"]);
  merges.forEach((age, index) => mergeIntoNext(origin, `pr${index}`, age));

  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), `#!/bin/bash\necho "$*" >> "${dir}/gh.log"\n[ "$1 $2" = "issue list" ] && echo "${openIssue}"\nexit 0\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const runnerTemp = join(dir, "runner");
  mkdirSync(runnerTemp);

  const output = execFileSync("bash", ["-c", stepScript("deploy-train.yml", "Alert when next has waited too long for production")], {
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: runnerTemp, OVERDUE_MINUTES: "120",
      GITHUB_SERVER_URL: join(dir, "server"), GITHUB_REPOSITORY: "repo", GITHUB_RUN_ID: "1",
    },
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  try { log = readFileSync(join(dir, "gh.log"), "utf8"); } catch { /* gh never called */ }
  return { output, created: log.split("\n").filter((line) => line.startsWith("issue create")) };
}

describe("deploy train watchdog", () => {
  it("stays quiet when next has nothing main lacks", () => {
    const { output, created } = runWatchdog([]);
    expect(output).toContain("next has nothing main lacks.");
    expect(created).toEqual([]);
  });

  it("does not page for normal supersession, even when the merged branch's commits are days old", () => {
    const { created } = runWatchdog([40, 5]);
    expect(created).toEqual([]);
  });

  it("opens one Deploy train stuck issue when a change has waited past the limit", () => {
    const { created } = runWatchdog([150, 10]);
    expect(created).toHaveLength(1);
    expect(created[0]).toContain("-t Deploy train stuck");
    expect(created[0]).toContain("-l owner:devops");
  });

  it("does not repeat while a Deploy train stuck issue is open", () => {
    const { output, created } = runWatchdog([150], "2029");
    expect(output).toContain("Already alerted in #2029.");
    expect(created).toEqual([]);
  });
});
