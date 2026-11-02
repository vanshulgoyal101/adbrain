import { execFileSync, spawnSync } from "node:child_process";
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

describe.each(["create-smoke.yml", "deploy-train.yml", "production-guard.yml"])("%s time budget", (name) => {
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

// #2642: the train's own PRs get every workflow held for approval. The helper deletes them, except it approves
// the PR's CI on the exact head when that commit had no push CI (main can't count dispatched CI for the PR).
function runTidy(pushRuns: object[] | null, heldRuns: object[]) {
  dir = mkdtempSync(join(tmpdir(), "train-tidy-"));
  if (pushRuns) writeFileSync(join(dir, "push.json"), JSON.stringify({ workflow_runs: pushRuns }));
  writeFileSync(join(dir, "held.json"), JSON.stringify({ workflow_runs: heldRuns }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  // Applies the workflow's real --jq filter to a fixture, so the selection logic is what's tested.
  writeFileSync(join(bin, "gh"), `#!/bin/bash
echo "$*" >> "${dir}/gh.log"
url=""; jqx=""
while [ $# -gt 0 ]; do case "$1" in api) ;; -X) shift ;; --jq) jqx=$2; shift ;; *) url=$1 ;; esac; shift; done
case "$url" in
  *event=push*) exec jq -r "$jqx" "${dir}/push.json" ;;
  *status=action_required*) exec jq -r "$jqx" "${dir}/held.json" ;;
esac
`);
  chmodSync(join(bin, "gh"), 0o755);
  const fn = /^tidy_held_runs\(\) \{[\s\S]*?^\}$/m.exec(stepScript("deploy-train.yml", "Promote next to main"));
  expect(fn).not.toBeNull();
  const output = execFileSync("bash", ["-c", `set -euo pipefail\nrepo=o/r\n${fn![0]}\ntidy_held_runs abc1234 deploy-train`], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  const calls = readFileSync(join(dir, "gh.log"), "utf8").split("\n").filter((line) => / -X (POST|DELETE) /.test(line));
  return { output, calls };
}

const held = (id: number, workflow: string, extra: object = {}) => ({
  id, path: `.github/workflows/${workflow}`, head_sha: "abc1234", conclusion: "action_required",
  actor: { login: "github-actions[bot]" }, head_repository: { full_name: "o/r" }, ...extra,
});
const pushCi = (conclusion: string | null) => ({ path: ".github/workflows/ci.yml", conclusion });

describe("deploy train held runs", () => {
  it("deletes every held run, CI included, when the commit's push CI passed", () => {
    const { calls } = runTidy([pushCi("success")], [held(1, "ci.yml"), held(2, "ai-review.yml"), held(3, "core-approval.yml")]);
    expect(calls).toEqual(["api -X DELETE repos/o/r/actions/runs/1", "api -X DELETE repos/o/r/actions/runs/2", "api -X DELETE repos/o/r/actions/runs/3"]);
  });

  it("approves only this commit's CI when it had no push CI, and deletes the rest", () => {
    const { calls } = runTidy([pushCi("failure"), { path: ".github/workflows/deploy-train.yml", conclusion: "success" }], [
      held(1, "ci.yml"), held(2, "core-approval.yml"), held(3, "ci.yml", { head_sha: "old0000" }),
    ]);
    expect(calls).toEqual(["api -X POST repos/o/r/actions/runs/1/approve", "api -X DELETE repos/o/r/actions/runs/2", "api -X DELETE repos/o/r/actions/runs/3"]);
  });

  it("counts a push CI still running as push CI", () => {
    const { calls } = runTidy([pushCi(null)], [held(1, "ci.yml")]);
    expect(calls).toEqual(["api -X DELETE repos/o/r/actions/runs/1"]);
  });

  it("never touches runs a person triggered, runs from another repo, or runs not held", () => {
    const { calls } = runTidy([], [
      held(1, "ci.yml", { actor: { login: "someone" } }), held(2, "ci.yml", { head_repository: { full_name: "fork/r" } }),
      held(3, "ci.yml", { conclusion: "success" }),
    ]);
    expect(calls).toEqual([]);
  });

  it("leaves this commit's CI held for the next try when the push CI lookup fails", () => {
    const { calls } = runTidy(null, [held(1, "ci.yml"), held(2, "ai-review.yml")]);
    expect(calls).toEqual(["api -X DELETE repos/o/r/actions/runs/2"]);
  });
});

// #2145: the dispatch input reaches the shell only through REQUESTED_MODE and a fixed `case`.
describe("create smoke mode", () => {
  const made: string[] = [];
  afterEach(() => { for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true }); });

  function run(step: string, env: Record<string, string>, smoke?: string) {
    const work = mkdtempSync(join(process.cwd(), ".create-smoke-test-"));
    made.push(work);
    const bin = join(work, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "timeout"), "#!/bin/bash\nshift 3\nexec \"$@\"\n");
    writeFileSync(join(bin, "node"), `#!/bin/bash\necho "node $*" >> "${work}/calls.log"\necho "PASS stub"\n`);
    writeFileSync(join(bin, "gh"), `#!/bin/bash\nprintf '%s\\n' "$*" >> "${work}/gh.log"\nexit 0\n`);
    for (const tool of ["timeout", "node", "gh"]) chmodSync(join(bin, tool), 0o755);
    if (smoke !== undefined) writeFileSync(join(work, "smoke.txt"), smoke);
    let status = 0;
    let out = "";
    try {
      out = execFileSync("bash", ["-c", stepScript("create-smoke.yml", step)], {
        cwd: work, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "1", GITHUB_EVENT_NAME: "schedule", ...env },
      });
    } catch (error) { status = (error as { status: number }).status; }
    const read = (file: string) => { try { return readFileSync(join(work, file), "utf8"); } catch { return ""; } };
    return { status, out, calls: read("calls.log"), gh: read("gh.log") };
  }

  const smoke = "Smoke (free picture, free-text Prepare, or a dispatched Create)";

  it("runs the free --picture smoke on schedule (no input) and on dispatch picture", () => {
    expect(run(smoke, { REQUESTED_MODE: "" }).calls).toBe("node scripts/smoke-core.mjs --picture\n");
    expect(run(smoke, { REQUESTED_MODE: "picture" }).calls).toBe("node scripts/smoke-core.mjs --picture\n");
  });

  it("schedules the picture check every 4 hours, keeping Cloudflare's free pictures for customers (#2405)", () => {
    const crons = [...workflow("create-smoke.yml").join("\n").matchAll(/- cron: "([^"]+)"/g)].map((match) => match[1]);
    expect(crons).toEqual(["17 */4 * * *", "47 8 * * *", "37 3 * * *"]);
  });

  it("runs --prepare when the daily schedule or a dispatch asks for it (#2230)", () => {
    expect(run(smoke, { REQUESTED_MODE: "prepare" }).calls).toBe("node scripts/smoke-core.mjs --prepare\n");
    const text = workflow("create-smoke.yml").join("\n");
    const daily = text.match(/- cron: "(47 8 \* \* \*)"/)?.[1];
    expect(daily).toBeTruthy();
    expect(text).toContain(`(github.event.schedule == '${daily}' && 'prepare')`);
  });

  it("runs --create when the daily 3-ad schedule or a dispatch asks for it (#2145)", () => {
    expect(run(smoke, { REQUESTED_MODE: "create" }).calls).toBe("node scripts/smoke-core.mjs --create\n");
    const text = workflow("create-smoke.yml").join("\n");
    const daily = text.match(/- cron: "(37 3 \* \* \*)"/)?.[1];
    expect(daily).toBeTruthy();
    expect(text).toContain(`SCHEDULED_MODE: \${{ inputs.mode || (github.event.schedule == '47 8 * * *' && 'prepare') || (github.event.schedule == '${daily}' && 'create') || 'picture' }}`);
  });

  // #2545: the chooser's answer reaches later steps only as one of the three modes.
  it("Choose mode passes the chooser's mode on, falls back to picture (prepare stays), and refuses anything else", () => {
    const chosen = (node: string, scheduled = "picture") => {
      const work = mkdtempSync(join(process.cwd(), ".create-smoke-test-"));
      made.push(work);
      const bin = join(work, "bin");
      mkdirSync(bin);
      writeFileSync(join(bin, "node"), `#!/bin/bash\n${node}\n`);
      chmodSync(join(bin, "node"), 0o755);
      const out = execFileSync("bash", ["-c", stepScript("create-smoke.yml", "Choose mode")], {
        cwd: work, encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SCHEDULED_MODE: scheduled, GITHUB_ENV: join(work, "env") },
      });
      return { out, env: readFileSync(join(work, "env"), "utf8") };
    };
    expect(chosen("echo create").env).toBe("REQUESTED_MODE=create\n");
    expect(chosen("exit 1", "prepare").env).toBe("REQUESTED_MODE=prepare\n");
    // #2593: a failed chooser never creates (today's may have run) and never passes `auto` on.
    expect(chosen("exit 1", "auto").env).toBe("REQUESTED_MODE=picture\n");
    expect(chosen("exit 1", "create").env).toBe("REQUESTED_MODE=picture\n");
    expect(chosen("printf 'create\\nPWNED=1'").env).toBe("REQUESTED_MODE=invalid\n");
  });

  it("marks the mode it runs, so tomorrow's chooser can count today's create (#2545)", () => {
    expect(run(smoke, { REQUESTED_MODE: "create" }).out).toContain("::notice title=Smoke mode::create\n");
  });

  it("refuses any other input without running the smoke", () => {
    const result = run(smoke, { REQUESTED_MODE: "create --campaign; touch pwned" });
    expect(result.status).toBe(1);
    expect(result.calls).toBe("");
  });

  it("says free pictures are failing when the picture step failed", () => {
    const { gh } = run("Alert on failure", { REQUESTED_MODE: "" }, "PASS Sign in\nFAIL Picture: New background returned HTTP 502\n");
    expect(gh).toContain("issue create");
    expect(gh).toContain("Create smoke failed in production");
    expect(gh).toContain("Free pictures are failing in production");
  });

  it("names Prepare's free-text plan when the prepare step failed", () => {
    const { gh } = run("Alert on failure", { REQUESTED_MODE: "prepare" }, "FAIL Prepare plan: HTTP 502 FREE_TEXT_UNAVAILABLE\n");
    expect(gh).toContain("Prepare's plan failed in production on free text");
    expect(gh).not.toContain("Free pictures are failing");
  });

  it("keeps the Create wording for a dispatched create", () => {
    const { gh } = run("Alert on failure", { REQUESTED_MODE: "create" },
      "FAIL Create: 1/3 saved\nNOTE missing ad \"Price\": Could not write this ad.\n");
    expect(gh).not.toContain("Free pictures are failing");
    expect(gh).toContain("NOTE missing ad");
    expect(gh).toContain("Create saved fewer ads than it asked for or stopped (#2504)");
  });
});

describe("scheduled parent-token health check", () => {
  function runParentCheck(scenario: string) {
    dir = mkdtempSync(join(tmpdir(), "parent-health-step-"));
    writeFileSync(join(dir, "curl"), `#!/bin/bash
count=0
[ -f calls ] && count=$(wc -l < calls)
count=$((count + 1))
printf '%s\\n' "$*" >> calls
output=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then output="$2"; shift; fi
  shift
done
case "$SCENARIO:$count" in
  timeout:*) echo '{"ok":true,"configured":true,"enabled":false}' > "$output"; echo 'curl: (28) Connection timed out' >&2; printf 000; exit 28 ;;
  recover:1) echo 'curl: (28) Connection timed out' >&2; printf 000; exit 28 ;;
  tls:*) echo 'curl: (60) Certificate verification failed' >&2; printf 000; exit 60 ;;
  refused:*) echo '{"ok":false,"configured":true,"enabled":false,"errorCode":"META_190"}' > "$output"; printf 503; exit 0 ;;
esac
echo '{"ok":true,"configured":true,"enabled":false}' > "$output"
printf 200
`);
    chmodSync(join(dir, "curl"), 0o755);
    const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c",
      stepScript("scheduled-jobs.yml", "2-Tier parent token")], {
      cwd: dir,
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CRON_SECRET: "test-cron-secret", SCENARIO: scenario },
    });
    const calls = readFileSync(join(dir, "calls"), "utf8").trim().split("\n");
    return { ...result, calls };
  }

  it("retries one timed-out read-only check and succeeds when the retry succeeds", () => {
    const result = runParentCheck("recover");
    expect(result.status).toBe(0);
    expect(result.calls).toHaveLength(2);
    expect(result.calls[0]).toContain("--connect-timeout 10 --max-time 30");
    expect(result.calls[1]).toContain("--connect-timeout 10 --max-time 10");
    for (const call of result.calls) {
      expect(call).toContain("Authorization: Bearer test-cron-secret");
      expect(call).toContain("https://adbrain.vanshul.com/api/cron/meta-parent-health");
    }
    expect(result.stdout).toContain("retry");
    expect(result.stdout).toContain("HTTP 200");
    expect(result.stdout + result.stderr).not.toContain("test-cron-secret");
  });

  it("fails after a second timeout rather than hiding a persistent outage", () => {
    const result = runParentCheck("timeout");
    expect(result.status).toBe(1);
    expect(result.calls).toHaveLength(2);
    expect(result.stdout).toContain("FAIL 2-Tier parent token: HTTP 000");
    expect(result.stdout).toContain('"error":"request failed"');
    expect(result.stdout).not.toContain('"ok":true');
  });

  it("does not retry or hide an HTTP error from the health endpoint", () => {
    const result = runParentCheck("refused");
    expect(result.status).toBe(1);
    expect(result.calls).toHaveLength(1);
    expect(result.stdout).toContain("HTTP 503");
    expect(result.stdout).toContain("META_190");
  });

  it("does not retry a non-timeout curl error", () => {
    const result = runParentCheck("tls");
    expect(result.status).toBe(1);
    expect(result.calls).toHaveLength(1);
    expect(result.stdout).toContain("FAIL 2-Tier parent token: HTTP 000");
  });
});
