#!/usr/bin/env node
// Team speed metrics (read-only, gh): DORA's four keys and active hours per role (#620), PR lead
// time, handoff latency, idle gaps, workflow time.
// Usage: npm run team-metrics [-- --hours 168 --until 2026-11-03T06:45Z]. The CTO posts the weekly result on #364.
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { activeHours, changeFailureRate, collectWorkflowRuns, deployFrequency, formatMinutes, isMetricPR, leadTimes, median as med, p90, productionGuardEvidence, roleForPost, rolesFromOwnerLabels, rolesMentionedInHandoff, timeToRestore, verifiedLiveShas } from "./lib/team-metrics.mjs";
const R = "vanshulgoyal101/adbrain";
const { values } = parseArgs({ options: { hours: { type: "string", default: "168" }, until: { type: "string" } } });
const hours = Number(values.hours);
const until = new Date(values.until ?? Date.now()).toISOString();
if (!(hours > 0) || until === "Invalid Date") throw new Error("--hours must be > 0 and --until an ISO time.");
const apiPages = (p) => JSON.parse(execFileSync("gh", ["api", "--paginate", "--slurp", p], { encoding: "utf8", maxBuffer: 1 << 28 }));
const api = (p) => apiPages(p)
  .flatMap((page) => (Array.isArray(page) ? page : page.workflow_runs ?? page.workflows ?? []));
const since = new Date(Date.parse(until) - hours * 3600e3).toISOString();
const inWindow = (t) => t > since && t <= until;
const min = (ms) => (ms === null ? "n/a" : Math.round(ms / 60000));
// PRs
const merged = api(`repos/${R}/pulls?state=closed&per_page=100&sort=updated&direction=desc`).filter(p => p.merged_at && inWindow(p.merged_at));
const prs = merged.filter(isMetricPR);
const lead = prs.map(p => Date.parse(p.merged_at) - Date.parse(p.created_at));
const byKind = {}; for (const p of prs) { const k = /worker table|docs:/i.test(p.title) ? "docs" : /migration|db:/i.test(p.title) ? "migration" : "code"; (byKind[k] ??= []).push(Date.parse(p.merged_at) - Date.parse(p.created_at)); }
console.log(`PRs merged (${hours}h, excl. trains): ${prs.length}; lead time median ${min(med(lead))} min, p90 ${min(p90(lead))} min`);
for (const [k, v] of Object.entries(byKind)) console.log(`  ${k}: n=${v.length} median ${min(med(v))} p90 ${min(p90(v))}`);
// comments
const cs = api(`repos/${R}/issues/comments?since=${since}&per_page=100`).filter(c => c.created_at <= until);
const roles = rolesFromOwnerLabels(api(`repos/${R}/labels?per_page=100`).map(label => label.name));
const who = (b) => roleForPost(b, roles);
const sorted = cs.map(c => ({ t: Date.parse(c.created_at), who: who(c.body), body: c.body ?? "", issue: c.issue_url.split("/").pop() })).sort((a, b) => a.t - b.t);
// handoff latency: "→ X" then next comment by X anywhere
const lat = {}; const missed = {};
for (let i = 0; i < sorted.length; i++) {
  const c = sorted[i];
  for (const r of rolesMentionedInHandoff(c.body, roles)) {
    if (c.who === r) continue;
    const next = sorted.slice(i + 1).find(d => d.who === r);
    if (next) (lat[r] ??= []).push(next.t - c.t); else (missed[r] = (missed[r] ?? 0) + 1);
  }
}
console.log("Handoff latency (→ Role until that role's next post), minutes: median / p90 / n / still waiting");
for (const r of roles) if (lat[r] || missed[r]) console.log(`  ${r}: ${min(med(lat[r] ?? []))} / ${min(p90(lat[r] ?? []))} / ${lat[r]?.length ?? 0} / ${missed[r] ?? 0}`);
// idle gaps > 60 min per role
console.log(`Activity gaps > 60 min (${hours}h), count and total hours:`);
for (const r of roles) { const ts = sorted.filter(c => c.who === r).map(c => c.t); let n = 0, tot = 0; for (let i = 1; i < ts.length; i++) { const g = ts[i] - ts[i - 1]; if (g > 3600e3) { n++; tot += g; } } console.log(`  ${r}: posts=${ts.length} gaps=${n} idle≈${(tot / 3600e3).toFixed(1)}h`); }
// Enumerate workflows first: the global actions/runs endpoint is capped at 1,000 results.
const workflows = api(`repos/${R}/actions/workflows?per_page=100`);
const allRuns = collectWorkflowRuns(workflows, (id, from, to) => {
  const range = encodeURIComponent(`${from}..${to}`);
  const pages = apiPages(`repos/${R}/actions/workflows/${id}/runs?created=${range}&per_page=100`);
  return {
    totalCount: Math.max(0, ...pages.map((page) => page.total_count ?? 0)),
    runs: pages.flatMap((page) => page.workflow_runs ?? []),
  };
}, since, until);
const runs = allRuns.filter(x => x.conclusion);
const byWf = {}; for (const r of runs) (byWf[r.workflow] ??= []).push(Date.parse(r.updated_at) - Date.parse(r.run_started_at ?? r.created_at));
const jobDetails = new Map();
const readJobs = (run) => {
  if (!jobDetails.has(run.id)) {
    const result = JSON.parse(execFileSync("gh", ["api", `repos/${R}/actions/runs/${run.id}/jobs?per_page=100`], { encoding: "utf8" }));
    jobDetails.set(run.id, result.jobs ?? []);
  }
  return jobDetails.get(run.id);
};
// #2361: a failed run with 0 jobs is GitHub's merge ref not being ready (#878), not a broken change; count it apart.
const jobless = new Set(runs.filter(x => x.conclusion === "failure")
  .filter(x => readJobs(x).length === 0).map(x => x.id));
console.log("Workflow wall time (median min / runs / failures / 0-job failures):");
for (const [k, v] of Object.entries(byWf)) { const failed = runs.filter(x => x.workflow === k && x.conclusion === "failure"); const z = failed.filter(x => jobless.has(x.id)).length; console.log(`  ${k}: ${(med(v) / 60000).toFixed(1)} / ${v.length} / ${failed.length - z} / ${z}`); }
// DORA four keys (#620): deploys are merges to main; incident clocks use recorded production checks.
const mainMerges = merged.filter(p => p.base?.ref === "main");
const guard = runs.filter(run => run.workflow === "Production guard" && run.event === "deployment_status"
  && (run.conclusion === "success" || run.conclusion === "failure"));
for (const run of guard) {
  Object.assign(run, productionGuardEvidence(readJobs(run)));
}
// A PR into next ships with the train whose commits contain its squash commit (one call per train).
const liveShas = verifiedLiveShas(guard);
const trains = mainMerges.filter(p => /^Deploy train/.test(p.title)).map(p => ({ number: p.number, merged_at: p.merged_at,
  verified: liveShas.has(p.merge_commit_sha), shas: api(`repos/${R}/pulls/${p.number}/commits?per_page=100`).map(c => c.sha) }));
const freq = deployFrequency(mainMerges, hours);
const lt = leadTimes(prs, trains, liveShas);
const byTrain = {}; for (const s of lt.shipped) byTrain[s.train ? `#${s.train}` : "direct to main"] = (byTrain[s.train ? `#${s.train}` : "direct to main"] ?? 0) + 1;
const cfr = changeFailureRate(guard);
const incidentChecks = runs.filter(run => ["Create smoke", "Scheduled jobs", "Production guard"].includes(run.workflow))
  .map(run => ({ ...run, source: run.workflow }));
const ttr = timeToRestore(incidentChecks);
console.log(`DORA (${hours}h):`);
console.log(`  Deploy frequency: ${freq.deploys} merges to main (${freq.perDay}/day)`);
const pct = (r) => (r === null ? "n/a (n=0)" : `${Math.round(r * 100)}%`);
console.log(`  Lead time, PR open → production: median ${formatMinutes(med(lt.times), lt.times.length)}, p90 ${formatMinutes(p90(lt.times), lt.times.length)} (n=${lt.times.length}, not shipped yet ${lt.pending}); shipped by ${Object.entries(byTrain).map(([t, n]) => `${t} ×${n}`).join(", ") || "none"}`);
console.log(`  Change-failure rate (core smoke failed): ${cfr.coreFailures} of ${cfr.deploys} production deploys, ${pct(cfr.rate)} (target ≤ 5%)`);
console.log(`  Guard failures of any step, e.g. WS1 (report only): ${cfr.anyFailures} of ${cfr.deploys}, ${pct(cfr.anyRate)}`);
console.log(`  Time to restore: median ${formatMinutes(med(ttr.times), ttr.times.length)}, p90 ${formatMinutes(p90(ttr.times), ttr.times.length)} (n=${ttr.times.length}, open ${ttr.open})`);
const active = activeHours(sorted);
console.log(`Active hours per role (distinct hours with a post): ${roles.map(r => `${r} ${active[r] ?? 0}`).join(", ")}`);
