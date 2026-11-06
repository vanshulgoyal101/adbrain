// #620 (#573 D8): DORA's four keys plus active hours per role, as pure functions over read-only gh data.

const isTrain = (pr) => /^Deploy train/.test(pr.title ?? "");
const isTrainSync = (pr) => /^Train sync:\s*main\s*(?:→|->)\s*next\b/i.test(pr.title ?? "");

/** Deploys are merges to main (deploy trains and direct-to-main PRs): count and per day over the window. */
export function deployFrequency(mainMerges, hours) {
  const deploys = mainMerges.length;
  return { deploys, perDay: Math.round((deploys / (hours / 24)) * 100) / 100 };
}

/** #2796: a rate or percentile over no samples is unknown (null), never 0. */
const rate = (part, whole) => (whole ? Math.round((part / whole) * 100) / 100 : null);
export const median = (list) => {
  if (!list.length) return null;
  const sorted = [...list].sort((x, y) => x - y);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
export const p90 = (list) => (list.length ? [...list].sort((x, y) => x - y)[Math.floor(list.length * 0.9)] : null);
export const formatMinutes = (ms, n) => (n === 0 || ms === null ? "n/a (n=0)" : `${Math.round(ms / 60000)} min`);

export const isMetricPR = (pr) => !isTrain(pr) && !isTrainSync(pr)
  && pr.user?.type !== "Bot" && !/\[bot\]$/i.test(pr.user?.login ?? "");

export function collectWorkflowRuns(workflows, readRuns, since, until) {
  const start = Date.parse(since);
  const end = Date.parse(until);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    throw new Error("Invalid workflow run time window");
  }

  const readWindow = (id, from, to) => {
    const result = readRuns(id, new Date(from).toISOString(), new Date(to).toISOString());
    if (!Number.isFinite(result.totalCount)) throw new Error(`Missing workflow run count for workflow ${id}`);
    if (result.totalCount <= result.runs.length) return result.runs;

    const middle = Math.floor((from + to) / 2_000) * 1_000;
    if (to - from <= 1_000 || middle <= from || middle >= to) {
      throw new Error(`Workflow ${id} returned ${result.runs.length} of ${result.totalCount} runs in the smallest query window`);
    }
    return [...readWindow(id, from, middle), ...readWindow(id, middle, to)];
  };

  return workflows.flatMap(({ id, name }) => {
    const runs = readWindow(id, start, end);
    return [...new Map(runs.map((run) => [run.id, run])).values()].map((run) => ({ ...run, workflow: name }));
  });
}

const OWNER_ROLE_NAMES = { ceo: "CEO", cpo: "CPO", cto: "CTO", devops: "DevOps", qa: "QA" };

export function rolesFromOwnerLabels(labels) {
  return labels
    .map((label) => (typeof label === "string" ? label : label.name))
    .filter((name) => name.startsWith("owner:"))
    .map((name) => {
      const slug = name.slice("owner:".length);
      const match = slug.match(/^(.*?)(\d*)$/);
      const base = match[1];
      const role = OWNER_ROLE_NAMES[base] ?? base[0].toUpperCase() + base.slice(1);
      return match[2] ? `${role} ${match[2]}` : role;
    });
}

const escapeRole = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
const rolePrefix = (role) => new RegExp(`^\\W*${escapeRole(role)}(?!\\s*\\d)\\b`, "i");
const roleHandoff = (role) => new RegExp(`→\\s*\\**${escapeRole(role)}(?!\\s*\\d)\\b`, "i");

export function roleForPost(body, roleNames) {
  return [...roleNames].sort((a, b) => b.length - a.length).find((role) => rolePrefix(role).test(body ?? "")) ?? "?";
}

export function rolesMentionedInHandoff(body, roleNames) {
  return roleNames.filter((role) => roleHandoff(role).test(body ?? ""));
}

/** Successful core smoke is required for a SHA to count as live; a later rollback removes it. */
export function verifiedLiveShas(guardRuns) {
  const live = new Map();
  for (const run of [...guardRuns].sort((a, b) => Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? ""))) {
    if (!run.head_sha) continue;
    if (run.rolledBack || run.coreSmokeFailed) live.set(run.head_sha, false);
    else if (run.coreSmokePassed) live.set(run.head_sha, true);
  }
  return new Set([...live].filter(([, verified]) => verified).map(([sha]) => sha));
}

export function productionGuardEvidence(jobs) {
  const steps = jobs.flatMap((job) => job.steps ?? []);
  const smoke = steps.find((step) => step.name.startsWith("Read-only core smoke"));
  if (!smoke) throw new Error("Production guard run is missing the Read-only core smoke step");
  return {
    coreSmokeFailed: smoke.conclusion === "failure",
    coreSmokePassed: smoke.conclusion === "success",
    servedDomainFailed: steps.some((step) => /Wait until (the domain|production) serves/.test(step.name) && step.conclusion === "failure"),
    rolledBack: steps.some((step) => step.name === "Roll production back" && step.conclusion === "success"),
  };
}

/**
 * Lead time from PR open to production (#2796): a PR into next ships with the deploy train whose
 * commits contain its squash `merge_commit_sha` and its guard passed core smoke without rollback;
 * a PR into main needs the same live-SHA evidence. Trains are `{ number, merged_at, shas, verified }`.
 * `pending` counts merged PRs not yet verified live.
 */
export function leadTimes(prs, trains, liveShas = new Set()) {
  const trainOf = new Map(trains.filter((train) => train.verified)
    .flatMap((train) => train.shas.map((sha) => [sha, train])));
  const shipped = [];
  let pending = 0;
  for (const pr of prs) {
    if (!pr.merged_at || isTrain(pr)) continue;
    const directToMain = pr.base?.ref === "main";
    const train = directToMain ? null : trainOf.get(pr.merge_commit_sha);
    if (directToMain ? !liveShas.has(pr.merge_commit_sha) : train === undefined) { pending += 1; continue; }
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
 * Time to restore (#2796): from the first failed Create, scheduler or served-domain check until all
 * affected sources have a later successful check. Drills are left out; `open` counts an incident not yet restored.
 */
export function timeToRestore(checks) {
  const runs = checks.filter(smoked)
    .map((run) => {
      const source = run.source ?? run.workflow ?? "Production guard";
      if (source === "Production guard" && run.event === "workflow_dispatch") return null;
      const failed = source === "Production guard"
        ? run.coreSmokeFailed || run.servedDomainFailed || run.rolledBack
        : run.conclusion === "failure";
      const healthy = source === "Production guard" ? run.coreSmokePassed : run.conclusion === "success";
      return failed || healthy
        ? { source, failed, healthy, start: Date.parse(run.created_at), end: Date.parse(run.updated_at ?? run.created_at) }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
  const times = [];
  const failingSources = new Map();
  let since = null;
  for (const run of runs) {
    if (run.failed) {
      since ??= run.start;
      failingSources.set(run.source, Math.max(failingSources.get(run.source) ?? 0, run.end));
    } else if (run.healthy && failingSources.has(run.source) && run.start > failingSources.get(run.source)) {
      failingSources.delete(run.source);
      if (failingSources.size === 0) {
        times.push(run.end - since);
        since = null;
      }
    }
  }
  return { times, open: failingSources.size ? 1 : 0 };
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
