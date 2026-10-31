#!/usr/bin/env node
// Team speed metrics (read-only, gh): DORA's four keys and active hours per role (#620), PR lead
// time, handoff latency, idle gaps, workflow time.
// Usage: npm run team-metrics [-- --hours 168]. The CTO posts the weekly result on #364.
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { activeHours, changeFailureRate, deployFrequency, leadTimes, timeToRestore } from "./lib/team-metrics.mjs";
const R = "vanshulgoyal101/adbrain";
const { values } = parseArgs({ options: { hours: { type: "string", default: "168" } } });
const hours = Number(values.hours);
const api = (p) => JSON.parse(execFileSync("gh", ["api", "--paginate", "--slurp", p], { encoding: "utf8", maxBuffer: 1 << 28 }))
  .flatMap((page) => (Array.isArray(page) ? page : page.workflow_runs ?? []));
const since = new Date(Date.now() - hours * 3600e3).toISOString();
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const p90 = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * 0.9)]; };
const min = (ms) => Math.round(ms / 60000);
// PRs
const merged = api(`repos/${R}/pulls?state=closed&per_page=100&sort=updated&direction=desc`).filter(p => p.merged_at && p.merged_at > since);
const prs = merged.filter(p => !/^Deploy train/.test(p.title));
const lead = prs.map(p => Date.parse(p.merged_at) - Date.parse(p.created_at));
const byKind = {}; for (const p of prs) { const k = /worker table|docs:/i.test(p.title) ? "docs" : /migration|db:/i.test(p.title) ? "migration" : "code"; (byKind[k] ??= []).push(Date.parse(p.merged_at) - Date.parse(p.created_at)); }
console.log(`PRs merged (${hours}h, excl. trains): ${prs.length}; lead time median ${min(med(lead))} min, p90 ${min(p90(lead))} min`);
for (const [k, v] of Object.entries(byKind)) console.log(`  ${k}: n=${v.length} median ${min(med(v))} p90 ${min(p90(v))}`);
// comments
const cs = api(`repos/${R}/issues/comments?since=${since}&per_page=100`);
const roles = { "Dev 2": /^\W*Dev 2\b/, "Dev 3": /^\W*Dev 3\b/, DevOps: /^\W*DevOps\b/, Dev: /^\W*Dev\b(?! ?[23])/, QA: /^\W*QA\b/, CTO: /^\W*CTO\b/, CEO: /^\W*CEO\b/ };
const who = (b) => Object.entries(roles).find(([, r]) => r.test(b ?? ""))?.[0] ?? "?";
const sorted = cs.map(c => ({ t: Date.parse(c.created_at), who: who(c.body), body: c.body ?? "", issue: c.issue_url.split("/").pop() })).sort((a, b) => a.t - b.t);
// handoff latency: "→ X" then next comment by X anywhere
const lat = {}; const missed = {};
for (let i = 0; i < sorted.length; i++) {
  const c = sorted[i];
  for (const r of Object.keys(roles)) {
    const re = new RegExp(`→\\s*\\**${r.replace(" ", "\\s")}\\b${r === "Dev" ? "(?! ?[23])" : ""}`);
    if (!re.test(c.body) || c.who === r) continue;
    const next = sorted.slice(i + 1).find(d => d.who === r);
    if (next) (lat[r] ??= []).push(next.t - c.t); else (missed[r] = (missed[r] ?? 0) + 1);
  }
}
console.log("Handoff latency (→ Role until that role's next post), minutes: median / p90 / n / still waiting");
for (const r of Object.keys(roles)) if (lat[r] || missed[r]) console.log(`  ${r}: ${min(med(lat[r] ?? [0]))} / ${min(p90(lat[r] ?? [0]))} / ${lat[r]?.length ?? 0} / ${missed[r] ?? 0}`);
// idle gaps > 60 min per role
console.log(`Activity gaps > 60 min (${hours}h), count and total hours:`);
for (const r of Object.keys(roles)) { const ts = sorted.filter(c => c.who === r).map(c => c.t); let n = 0, tot = 0; for (let i = 1; i < ts.length; i++) { const g = ts[i] - ts[i - 1]; if (g > 3600e3) { n++; tot += g; } } console.log(`  ${r}: posts=${ts.length} gaps=${n} idle≈${(tot / 3600e3).toFixed(1)}h`); }
// CI duration
const runs = api(`repos/${R}/actions/runs?created=>${since.slice(0,10)}&per_page=100`).filter(x => x.conclusion);
const byWf = {}; for (const r of runs) (byWf[r.name] ??= []).push(Date.parse(r.updated_at) - Date.parse(r.run_started_at ?? r.created_at));
// #2361: a failed run with 0 jobs is GitHub's merge ref not being ready (#878), not a broken change; count it apart.
const jobless = new Set(runs.filter(x => x.conclusion === "failure")
  .filter(x => JSON.parse(execFileSync("gh", ["api", `repos/${R}/actions/runs/${x.id}/jobs?per_page=1`], { encoding: "utf8" })).total_count === 0)
  .map(x => x.id));
console.log("Workflow wall time (median min / runs / failures / 0-job failures):");
for (const [k, v] of Object.entries(byWf)) { const failed = runs.filter(x => x.name === k && x.conclusion === "failure"); const z = failed.filter(x => jobless.has(x.id)).length; console.log(`  ${k}: ${(med(v) / 60000).toFixed(1)} / ${v.length} / ${failed.length - z} / ${z}`); }
// DORA four keys (#620): deploys are merges to main; failures and restores come from the production guard's smoke.
const mainMerges = merged.filter(p => p.base?.ref === "main");
const guard = api(`repos/${R}/actions/workflows/production-guard.yml/runs?created=>${since.slice(0, 10)}&per_page=100`).filter(x => x.created_at > since);
const freq = deployFrequency(mainMerges, hours);
const lt = leadTimes(merged, mainMerges);
const cfr = changeFailureRate(guard);
const ttr = timeToRestore(guard);
console.log(`DORA (${hours}h):`);
console.log(`  Deploy frequency: ${freq.deploys} merges to main (${freq.perDay}/day)`);
console.log(`  Lead time, PR open → production: median ${min(med(lt.times) ?? 0)} min, p90 ${min(p90(lt.times) ?? 0)} min (n=${lt.times.length}, not shipped yet ${lt.pending})`);
console.log(`  Change-failure rate: ${cfr.failures} of ${cfr.deploys} production smokes failed (${Math.round(cfr.rate * 100)}%)`);
console.log(`  Time to restore: median ${min(med(ttr.times) ?? 0)} min, p90 ${min(p90(ttr.times) ?? 0)} min (n=${ttr.times.length}, open ${ttr.open})`);
const active = activeHours(sorted);
console.log(`Active hours per role (distinct hours with a post): ${Object.keys(roles).map(r => `${r} ${active[r] ?? 0}`).join(", ")}`);

