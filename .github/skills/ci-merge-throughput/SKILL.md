---
name: ci-merge-throughput
description: "Use when several workers merge to one main branch many times a day, when a required check blocks every PR for reasons unrelated to the change, or when a new test suite should become a required merge check."
---

<!-- Generated from vanshulgoyal101/skills@fb8f6e0 skills/ci-merge-throughput.md; edit upstream, then re-run scripts/sync-own-skills.mjs. -->

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
