#!/usr/bin/env node
// #2545: the daily 3-ad Create smoke runs even when GitHub drops its 03:37Z cron. A scheduled picture run after
// 03:37Z becomes the day's `create` when no job of this workflow that started since 03:00Z marked itself `create`;
// a late 03:37Z run after that becomes `picture`. Still one create a day: the Smoke step marks its mode with a
// `Smoke mode` annotation as it starts, the job's concurrency group runs them one at a time, and anything uncertain
// (a failed lookup, a re-run) does `picture`, never an extra create. #2593: a dispatch with mode `auto` (the
// dispatch-workflows route making up a dropped slot) is treated as a scheduled picture run.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const MODES = ["picture", "prepare", "create"];
export const MARK_TITLE = "Smoke mode";
const WORKFLOW = "create-smoke.yml";
const DAY_MS = 24 * 60 * 60 * 1000;

const utcToday = (now, hour, minute) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute));

/** A job that started since then counts as today's create. */
export const createWindowStart = (now) => utcToday(now, 3, 0);

/** Whether today's create is due: the 03:37Z cron time has passed. */
export const createDue = (now) => now >= utcToday(now, 3, 37);

/**
 * `scheduled` is the mode the trigger asked for. `createdToday` is null when it couldn't be read, and `rerun` is true
 * for a re-run attempt; both pick `picture` once the create is due, so neither can add a second create.
 */
export function chooseSmokeMode({ event, scheduled, now, createdToday, rerun = false }) {
  if (event !== "schedule" || scheduled === "prepare") return scheduled;
  if (!createDue(now)) return scheduled === "create" ? "picture" : scheduled;
  return createdToday === false && !rerun ? "create" : "picture";
}

const lines = (text) => text.split("\n").map((line) => line.trim()).filter(Boolean);
const iso = (date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * True when a job of another run of this workflow started since `since` and marked itself `create`. Runs are listed
 * from a day earlier, because a run GitHub created before `since` can start long after it.
 */
export function createStartedSince({ gh, repo, runId, since }) {
  const query = `created=${encodeURIComponent(`>=${iso(new Date(since.getTime() - DAY_MS))}`)}&per_page=100`;
  const runs = lines(gh(["api", "--paginate", `repos/${repo}/actions/workflows/${WORKFLOW}/runs?${query}`, "--jq", ".workflow_runs[].id"]));
  for (const run of runs) {
    if (run === String(runId)) continue;
    const jobs = lines(gh(["api", "--paginate", `repos/${repo}/actions/runs/${run}/jobs?filter=all&per_page=100`, "--jq",
      `.jobs[] | select(.started_at != null and .started_at >= "${iso(since)}") | .id`]));
    for (const job of jobs) {
      const marks = lines(gh(["api", `repos/${repo}/check-runs/${job}/annotations`, "--jq", `.[] | select(.title == "${MARK_TITLE}") | .message`]));
      if (marks.includes("create")) return true;
    }
  }
  return false;
}

function main() {
  const env = process.env;
  const auto = env.SCHEDULED_MODE === "auto";
  const scheduled = MODES.includes(env.SCHEDULED_MODE) ? env.SCHEDULED_MODE : "picture";
  const now = new Date();
  const event = auto ? "schedule" : env.GITHUB_EVENT_NAME;
  const rerun = Number(env.GITHUB_RUN_ATTEMPT || 1) > 1;
  let createdToday = false;
  if (event === "schedule" && scheduled !== "prepare" && createDue(now) && !rerun) {
    try {
      const gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 });
      createdToday = createStartedSince({ gh, repo: env.GITHUB_REPOSITORY, runId: env.GITHUB_RUN_ID, since: createWindowStart(now) });
    } catch (error) {
      console.error(`NOTE could not read today's runs, so no create: ${error.message.split("\n")[0]}`);
      createdToday = null;
    }
  }
  const mode = chooseSmokeMode({ event, scheduled, now, createdToday, rerun });
  console.error(`NOTE smoke mode ${mode} (asked ${scheduled}; ${event}; re-run ${rerun}; create already today: ${createdToday})`);
  console.log(mode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
