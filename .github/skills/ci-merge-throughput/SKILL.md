---
name: ci-merge-throughput
description: "Use when several workers merge to one main branch many times a day, when a required check blocks every PR for reasons unrelated to the change, or when a new test suite should become a required merge check."
---

<!-- Generated from vanshulgoyal101/skills@77e6db7 skills/ci-merge-throughput.md; edit upstream, then re-run scripts/sync-own-skills.mjs. -->

# CI Merge Throughput

## Trigger

Use when several workers merge to one main branch many times a day, when a
required check blocks every PR for reasons unrelated to the change, or when a new
test suite should become a required merge check.

## Invariant

Required checks block only on defects the team can fix that day, every required
suite is its own named job, and a green PR reaches main promptly without manual
branch-update loops.

## Failure pattern

A blocking dependency-audit gate turns red on a new upstream advisory with no
patched release. Every PR fails, nobody owns the gate, and work stalls. The
tempting fix, `npm audit fix --force`, downgrades a major dev dependency. A strict
up-to-date rule makes each merge re-run every other PR. Auto-merge sits on green
PRs. Long-lived branches drift and fail CI on old dependencies. Observed in
[the AdBrain two-week CI stall](../incidents/adbrain-two-week-ci-stall.md).

## Recommended method

1. Run the dependency audit as a non-blocking report, or give it an owner who
   fixes it the same day. A blocking audit froze one team for about two weeks.
2. Scope a blocking audit if you keep one: high severity for runtime
   dependencies (`--omit=dev`), critical for the full tree. Never use
   `npm audit fix --force` for a dev-only advisory.
3. Split CI into parallel jobs, keep coverage instrumentation out of the PR path
   and cache the framework build. Measured:
   main push runs went from 164-217s to 95-148s.
4. Do not require branches to be up to date with main when merges are frequent.
5. Auto-merge may not fire on a green, mergeable PR (cause unknown). Rule: a PR
   green for 30 minutes gets merged by whoever sees it.
6. Merge main into long-lived branches after every release.
7. To make a suite required, give it its own named CI job, then add that job
   name to branch protection. A suite inside `npm test` cannot be required alone.
8. Edit shared docs on main only. Branch-side docs edits conflicted on every sync;
   the sync job now resolves doc-only conflicts toward main, failing on code (#170).
9. When many PRs append to one canonical file, freeze it and generate the tail from
   the files each PR already adds. Any two migration PRs conflicted on it (#227).
10. Vitest `--shard` splits by file count over hashed paths, not duration, and tests
    in a file run serially. One slow file sets the floor, so split it first (#226).

## Discriminating checks

- Does any required check fail on main itself? If so, every PR is blocked;
  fix or demote it before reviewing anything else.
- Does the proposed audit fix change a major version? Read the lockfile diff.
- Read branch protection through the API: required check names and `strict`.
- List green open PRs older than 30 minutes with auto-merge enabled.
- Compare each long-lived branch's lockfile with main after a release.

## Common traps

- Treating "high severity" as "affects production" without checking whether the
  package ships at runtime.
- Leaving a red required gate ownerless because it is "infrastructure".
- Assuming auto-merge will merge; checking hours later.
- Adding a suite to an existing job and expecting it to appear as a required check.
- Accepting a non-blocking audit without recording the trade-off: high-severity
  advisories no longer stop merges.
- Passing a short SHA to `gh pr merge --match-head-commit`: GraphQL coercion
  rejects it and nothing merges. Pass the full 40-character SHA (#208).
- A required aggregator that `needs:` the shards but lacks `if: always()`. A failed
  shard skips it, and a skipped required check counts as passing (#226).
- A migration PR opened against a train branch must be retargeted to `main` before
  release, and core approval needs QA plus CTO or Reviewer, so ask for both at once (#1138).
- In a train repo, a version bump is in production as soon as it merges to `next`. Run
  the "before promotion" checks before setting auto-merge (#1208).
- A flag flip needs a behavioural before/after (signed-in page text), not just the
  env var listing; the var only takes effect on the next deploy (#1016).
- Before building a lever's "smallest option", write the recorded test of today's
  path first. It can show no product change is needed (#1211).
- Run `tsc` on new test files; vitest strips types, so a test can pass locally and fail
  CI's build (#1580).
- Match CI's Node version locally (nvm Node 24 first in PATH); jsdom crashed on Node 22
  (#1551).
- When mocking a module wholesale, spread `importOriginal()` so new helpers aren't
  silently undefined (#1468).
- Make a review habit into a CI rule with an AST inventory plus a mutation check (#1518).
- Run a new lint or copy rule against the whole repo before merging; the first rule
  flagged hex colours (#1291).

## AdBrain lessons (Oct 29)

- A job that is neither required nor in the required aggregator's `needs` can go red
  without stopping auto-merge; read branch protection
  (`gh api repos/<o>/<r>/branches/<b>/protection/required_status_checks`) before
  calling it a gate (#1918). A size or import ratchet that isn't required drifts within
  hours; make it required on every base, hotfix branches included, in the release that
  adds it (#2071, #2157).
- A `--write-baseline` run always exits green and rewrites every ceiling: it raises
  grown files and lowers untouched ones, racing parallel PRs into red. Rebuild from the
  target branch, edit only your own entries, and review the baseline diff (#2167,
  #2096). A shrink-only baseline change belongs to the author's own extraction (#2157).
- Never enable auto-merge on a PR whose base is another feature branch: it merges there
  at once with no checks or review. Enable it after retargeting (#1255).
- A "skip the gate for the release train" rule must bind repository and base, not the
  branch name; on a public repo a fork can name its branch `next` (#1740).
- Dependabot reads the default branch; verify a real bot PR after the config reaches
  it (#1772).
- Two PRs that pass alone can break the target together. When a PR adds a hook-using
  child to a shared page, grep the tests that render that page and add the mock in the
  same PR (#1624).
- A move or split on the integration branch conflicts with any production hotfix to the
  old file and stalls the sync. Check with `git merge --no-commit origin/main`, carry
  the edit in a merge-commit back-merge PR (not squash), then confirm with
  `git merge-base --is-ancestor` (#1851, #2106).
- A component's real debounce in a test costs seconds in every test that triggers it;
  spy on that one timer in the describe (#1509).

## AdBrain lessons (Oct 31)

- Picking PR tests from changed files plus the import graph misses tests that read
  fixtures, docs or config with `fs`: those files have no importers. Always run the
  file-scanning tests on PRs, run the full suite when a PR changes any non-module file,
  and keep the full suite on push (#2386).
- Exempting wording-only changes from a human approval gate removed the slowest merges
  (37–47 h waits were copy and README edits). Do not detect "words only" from patch
  lines: an adversarial pass found 13 bypasses (code commented out, reordered lines,
  swapped values), then 22 more through constants, helpers, ASI and bundler
  directives. Parse base and head, compare tokens in order with comments ignored,
  require each changed token to be text in an allowlisted words place (message, error,
  label, toast, JSX text), require the same tree shape and directives, and keep the
  gate when any code reads the old or new words. Fail closed when the parser is
  missing and log why a file stays gated (#364, #2428).
