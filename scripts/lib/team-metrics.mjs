// #620 (#573 D8): DORA's four keys plus active hours per role, as pure functions over read-only gh data.

const isTrain = (pr) => /^Deploy train/.test(pr.title ?? "");

/** Deploys are merges to main (deploy trains and direct-to-main PRs): count and per day over the window. */
export function deployFrequency(mainMerges, hours) {
  const deploys = mainMerges.length;
  return { deploys, perDay: Math.round((deploys / (hours / 24)) * 100) / 100 };
}

/**
 * Lead time from PR open to production: a PR into next ships with the first merge to main at or
 * after its own merge; a PR into main ships when it merges. Deploy trains are not changes themselves.
 * `pending` counts merged PRs not yet on main.
 */
export function leadTimes(prs, mainMerges) {
  const shipped = mainMerges.map((merge) => Date.parse(merge.merged_at)).sort((a, b) => a - b);
  const times = [];
  let pending = 0;
  for (const pr of prs) {
    if (!pr.merged_at || isTrain(pr)) continue;
    const merged = Date.parse(pr.merged_at);
    const live = pr.base?.ref === "main" ? merged : shipped.find((at) => at >= merged);
    if (live === undefined) pending += 1;
    else times.push(live - Date.parse(pr.created_at));
  }
  return { times, pending };
}

/** Failed production-guard smokes per production deploy; cancelled runs and manual drills don't count. */
export function changeFailureRate(guardRuns) {
  const deploys = guardRuns.filter((run) => run.event === "deployment_status" && (run.conclusion === "success" || run.conclusion === "failure"));
  const failures = deploys.filter((run) => run.conclusion === "failure").length;
  return { deploys: deploys.length, failures, rate: deploys.length ? Math.round((failures / deploys.length) * 100) / 100 : 0 };
}

/**
 * Time to restore: from the first failed guard smoke of an incident to the next passing one (a deploy
 * or the daily smoke). Drills are left out; `open` counts an incident not yet restored.
 */
export function timeToRestore(guardRuns) {
  const runs = guardRuns.filter((run) => run.event !== "workflow_dispatch" && (run.conclusion === "success" || run.conclusion === "failure"))
    .map((run) => ({ ok: run.conclusion === "success", t: Date.parse(run.created_at) }))
    .sort((a, b) => a.t - b.t);
  const times = [];
  let since = null;
  for (const run of runs) {
    if (!run.ok && since === null) since = run.t;
    if (run.ok && since !== null) { times.push(run.t - since); since = null; }
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
