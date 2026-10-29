---
name: post-deploy-production-guard
description: "Use when merges auto-deploy to production and a CI workflow should smoke each deploy, roll back a bad one, run a scheduled smoke, or alert when production stops serving the main branch."
---

<!-- Generated from vanshulgoyal101/skills@b877c32 skills/post-deploy-production-guard.md; edit upstream, then re-run scripts/sync-own-skills.mjs. -->

# Post-Deploy Production Guard

## Trigger

Use when merges auto-deploy to production and a CI workflow should smoke each
deploy, roll back a bad one, run a scheduled smoke, or alert when production
stops serving the main branch.

## Invariant

The guard judges only the deploy production actually serves, ignores deploys a
newer one has replaced, rolls back only after a confirmed repeated failure, and
reports drift when production is not main HEAD within a fixed window.

## Failure pattern

A merge is declared undeployed because the platform has not finished yet. A
guard smokes production while it still serves the previous commit, or fires on a
deploy a newer one already replaced, and opens a false incident (or rolls back a
healthy newer deploy). A guard fix merges but older deploys keep running the old
guard. Scheduled-only jobs show as skipped checks on every push and read as
failures. Observed in
[AdBrain guard false alarms](../incidents/adbrain-guard-superseded-false-alarms.md).

## Recommended method

1. Expect deploy lag. Production deploys trailed merges by about 5-15 minutes;
   one merge at 15:34Z went live at 15:50Z after being reported as never deployed.
2. Before smoking, wait until production serves the deployed commit (compare the
   served deployment's commit with the event's commit).
3. If a newer deployment has replaced this one, skip with a logged reason instead
   of failing.
4. Smoke once with one retry. On a second failure, roll back automatically and
   open an issue labeled for the core queue.
5. Run a daily scheduled smoke that reports but never rolls back.
6. Alert when production does not serve main HEAD within 15 minutes.
7. Use a scoped deploy token stored as a repository secret. Never copy a person's
   CLI login into CI. Without it, make rollback and drift skip with a warning.
8. Put scheduled-only jobs in their own workflow file.
9. Keep the smoke read-only by default (see
   [verification gates](verification-gates.md#core-regression-gates)).
10. Treat an untested rollback as residual risk. Schedule an approved drill.
11. Follow every rollback with an explicit promote. A Vercel rollback pinned
   production, so later deploys stayed unpromoted; alert while it is pinned (#111).
12. Bound each slow step below the job timeout. A job timeout cancels the run and
   skips `if: failure()` alerts; a step timeout fails, so the alert fires (#210).
13. Change the smoke in the same PR as any login or UI step it walks. Otherwise the
   guard rolls back and every later deploy waits for a manual promote (#316).
14. After a rollback, fix forward and confirm promotion resumed before reading later
   guard failures; each frozen deploy opens its own misleading bug (#319, #322).
15. Give every new secret a read-only health check in the guard from day one (#520).
16. Never pass a token as a CLI argument in CI. A failing CLI echoes argv, and the guard
   posted it to a public issue. Pass secrets by env and redact before posting (#413).
17. On a metered deploy plan, merges are a budget. Batch them through a train branch,
   gate on the provider's own refusal rather than a proxy count, and guard on changed
   files, not commit counts, when branches merge into each other (#461, #468).
18. Docs-only merges still deploy unless an ignore step says otherwise (#461).
19. When a change adds background network calls, run the smoke's sequence against it
   before merging. Start any in-step request allowance before the user action that can
   trigger it, since prefetches move requests earlier (#504, #531).
20. A UI copy change on a step the smoke reads must update the smoke in the same PR, and
   the core-approval paths should include the components the smoke walks.
21. GitHub `schedule:` is best effort (gaps of 2–5 h, as low as 1 run in 14). Run real
   work on pg_cron or your own dispatcher, and alert from a trigger you can prove.
22. Free-plan databases may have no backups (`GET /database/backups` → `[]`). A nightly
   encrypted logical dump by CI, a fresh dump gate before every migration and a weekly
   restore drill cover it for ₹0, with at most a day of data at risk.
23. Anything run by launchd gets an empty env and its own worktree: reproduce with
   `env -i` plus the plist PATH, and check that worktree's dependencies.
24. A 0-job CI run on a fresh merge ref is GitHub not ready yet; rerun once, but stop at
   once on a failure that ran jobs. A cancelled suite's checks can read 'failure'.
25. Token-looking test fixtures need a fingerprint allowance in the same PR, and stale
   remote branches are scanned by the train too; delete merged branches.

## Discriminating checks

- Merge two commits a few minutes apart; the older deploy's guard must skip as
  superseded, not fail.
- Run the guard script read-only against production for an old and a current
  commit before enabling rollback.
- Workflows triggered by `deployment_status` run the workflow and scripts from
  the deployed commit. After fixing the guard, confirm which commits contain the
  fix; deploys of older commits still run the old guard.
- Check the drift alert reports OK only when the served commit equals main HEAD.
- Before reporting an incident, read the newest main commit's checks and confirm
  production serves it. A "6/7 checks" count with a green tick can include a job
  skipped by design; a red X on an older commit can be a superseded-deploy alarm.
- Force a smoke failure and confirm the run turns red. Without `shell: bash`
  (pipefail) in GitHub Actions, `smoke | tee log` exited 0 on a FAIL (#153).
- A merge's guard skips the smoke when production already serves a newer commit.
  Confirm that commit contains the merge, then read that commit's guard (#216).
- Check `GET /v1/security/firewall/events?projectId=…&startTimestamp=…` (Vercel API)
  before debugging an edge 403: it names the rule, IP, window and count (#240).

## Common traps

- Calling a merge "not deployed" before the 15-minute window passes.
- Smoking the canonical URL right after the deploy event without checking which
  commit it serves.
- Assuming a guard fix on main protects deploys of commits that predate it.
- Giving rollback a personal login token, or letting a daily smoke roll back.
- Mixing scheduled and per-deploy jobs in one workflow.
- Counting the guard as full protection while rollback has never run.
- Merging during a rollback drill: with promotion stopped it raises a false
  "still serves" alarm. Pause merges, then check drift on the real HEAD (#111).
- Blaming the browser CDN for a slow `playwright install --with-deps`: the Ubuntu
  apt mirror ran at 22 kB/s. Bound apt; fall back to a browser-only install (#210).
- Bursts of headless browser loads from one machine drew the platform's DDoS
  challenge (403) while curl passed. Pace browser walks; run bursts from CI (#240).
- A 100-load timing burst drew the same challenge. Paced passes (one sign-in, 2-3 cold
  loads 5 s apart, abort on `x-vercel-mitigated`) gave stable before/after numbers (#230).


## AdBrain lessons (Oct 28–29)

- Verify which build is live from the app itself (a release header), not a timer (#1457).
- After a rollback, promote **main HEAD's** deployment and check the domain serves it
  (#1329, #1347). Check the rollback token exists before you need it (#1745).
- `vercel.json` is read from the pushed commit, so a branch without main's history
  ignores main-only rules (#1337).
- On a guard failure, capture `requestfailed` before judging the release; "Failed to
  fetch" was our own route block (#1329).
- Two schedulers on one route make benign lost-race 5xx errors; look for a second
  invocation in the same minute (#1416).
- A smoke step can fail on a renamed role (button → link) while the product works;
  assert on the role users see (#1227).

## AdBrain lessons (Oct 29)

- Serializing guard jobs doesn't serialize deployments; re-check the served SHA at the
  rollback mutation itself (#2014).
- A guard has many skipped runs per SHA (non-production deployment statuses); pick the
  run by conclusion, not recency (#2138).
- A cancelled or timed-out job never runs `if: failure()`; put the stall check in a
  separate job that isn't cancelled with it (#2029).
- Smoke a production edit by blocking every non-GET request in Playwright except the
  free preview route, so the shared account never changes (#1904).
- A state that needs an account you can't safely create can't be smoked; check that
  production serves its words and rely on the recorded core test (#1990).
- The free hosting tier can't allowlist its DDoS challenge; keep heavy smokes on CI
  runners, not one office IP (#1814).
