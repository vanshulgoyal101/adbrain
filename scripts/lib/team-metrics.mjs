// #620 (#573 D8): DORA's four keys plus active hours per role, as pure functions over read-only gh data.

const isTrain = (pr) => /^Deploy train/.test(pr.title ?? "");

/** Deploys are merges to main (deploy trains and direct-to-main PRs): count and per day over the window. */
export function deployFrequency(mainMerges, hours) {
  const deploys = mainMerges.length;
  return { deploys, perDay: Math.round((deploys / (hours / 24)) * 100) / 100 };
}

/** #2796: a rate or percentile over no samples is unknown (null), never 0. */
const rate = (part, whole) => (whole ? Math.round((part / whole) * 100) / 100 : null);
export const median = (list) => (list.length ? [...list].sort((x, y) => x - y)[Math.floor(list.length / 2)] : null);
export const p90 = (list) => (list.length ? [...list].sort((x, y) => x - y)[Math.floor(list.length * 0.9)] : null);
export const formatMinutes = (ms, n) => (n === 0 || ms === null ? "n/a (n=0)" : `${Math.round(ms / 60000)} min`);

/**
 * Lead time from PR open to production (#2796): a PR into next ships with the deploy train whose
 * commits contain its squash `merge_commit_sha`; a PR into main ships when it merges. Trains are
 * `{ number, merged_at, shas }`. `pending` counts merged PRs in no merged train yet.
 */
export function leadTimes(prs, trains) {
  const trainOf = new Map(trains.flatMap((train) => train.shas.map((sha) => [sha, train])));
  const shipped = [];
  let pending = 0;
  for (const pr of prs) {
    if (!pr.merged_at || isTrain(pr)) continue;
    const train = pr.base?.ref === "main" ? null : trainOf.get(pr.merge_commit_sha);
    if (train === undefined) { pending += 1; continue; }
    shipped.push({ number: pr.number, train: train?.number ?? null, ms: Date.parse(train?.merged_at ?? pr.merged_at) - Date.parse(pr.created_at) });
  }
  return { times: shipped.map((entry) => entry.ms), shipped, pending };
}

const smoked = (run) => run.conclusion === "success" || run.conclusion === "failure";

/**
 * Change-failure rate per production deploy (#2796): the headline counts deploys whose core smoke
 * failed (`coreSmokeFailed`, read from the failed run's steps); `anyRate` counts a failure of any
 * step (e.g. the WS1 walk) and is report-only. Skipped, cancelled and dispatched runs don't count.
 */
export function changeFailureRate(guardRuns) {
  const deploys = guardRuns.filter((run) => run.event === "deployment_status" && smoked(run));
  const failed = deploys.filter((run) => run.conclusion === "failure");
  const coreFailures = failed.filter((run) => run.coreSmokeFailed).length;
  return { deploys: deploys.length, coreFailures, rate: rate(coreFailures, deploys.length), anyFailures: failed.length, anyRate: rate(failed.length, deploys.length) };
}

/**
 * Time to restore (#2796): from an incident's first failed guard run (created) to the completion of
 * the first passing run (a deploy or the daily smoke) created after every failure so far had finished;
 * a pass that started during a failure doesn't restore. Drills are left out; `open` counts an incident not yet restored.
 */
export function timeToRestore(guardRuns) {
  const runs = guardRuns.filter((run) => run.event !== "workflow_dispatch" && smoked(run))
    .map((run) => ({ ok: run.conclusion === "success", start: Date.parse(run.created_at), end: Date.parse(run.updated_at ?? run.created_at) }))
    .sort((a, b) => a.start - b.start);
  const times = [];
  let since = null;
  let failuresDone = 0;
  for (const run of runs) {
    if (!run.ok) { since ??= run.start; failuresDone = Math.max(failuresDone, run.end); continue; }
    if (since !== null && run.start > failuresDone) { times.push(run.end - since); since = null; }
  }
  return { times, open: since === null ? 0 : 1 };
}

/** Active hours per role: the distinct clock hours (UTC) in which the role posted. Unsigned posts don't count. */
export function activeHours(posts) {
  const hours = {};
  for (const post of posts) {
    if (!post.who || post.who === "?") continue;
    (hours[post.who] ??= new Set()).add(Math.floor(post.t / 3600e3));
  }
  return Object.fromEntries(Object.entries(hours).map(([who, set]) => [who, set.size]));
}
