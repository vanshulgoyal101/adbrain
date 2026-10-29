---
name: verification-gates
description: "Use this skill for any change that crosses source, generated assets, shared modules, database behavior, or deployment state."
---

<!-- Generated from vanshulgoyal101/skills@b877c32 skills/verification-gates.md; edit upstream, then re-run scripts/sync-own-skills.mjs. -->

# Verification Gates

## Trigger

Use this skill for any change that crosses source, generated assets, shared modules, database behavior, or deployment state.

## Invariant

Every release claim is supported by evidence for the relevant source, dependencies,
configuration and runtime. Before promotion, verify compatibility; after promotion,
verify the actual deployment and affected workflow. Do not confuse those stages.

## Gate order

1. **Focused behavior check**: reproduce the reported or hypothesized failure.
2. **Narrow tests**: exercise the changed model, DOM path, or integration boundary.
3. **Affected consumers**: run applicable type, lint, schema and artifact checks;
	 widen coverage when shared contracts or dependencies change.
4. **Release gates**: run required CI on the exact candidate. Add browser or real
	 integration checks for changed workflows, not merely to reproduce a receipt.
5. **Live invariant check**: after authorized deployment, verify the exact source
	 and affected workflow. A homepage response is not authenticated acceptance.
6. **Handoff**: commit owned work, link evidence and state remaining limitations.

This is an ordering rule, not a requirement to run every kind of test for every edit.
Documentation-only changes need relevant documentation checks, not paid provider tests.
Full local suites/builds are appropriate when required or when matching CI cannot
cover the meaningful risk; do not repeat them solely because another worker joined.

## Risk and evidence reuse

| Changed surface | Minimum useful evidence |
| --- | --- |
| Documentation | Links/anchors, examples and source claims; preserve historical receipts |
| Local behavior | Causal regression and affected tests; applicable lint/types |
| Shared dependency or contract | Affected consumers, compatibility and changed dependency checks |
| Tenant, financial or schema boundary | Authorization/invariant tests and relevant real database or integration behavior |
| Release assembly | Changed integration edges, required exact-candidate CI, schema compatibility and deployed smoke |

- Reuse evidence when the relevant source, dependency lock, configuration and runtime
	match. A commit plus focused diff is usually enough to establish the changed scope;
	full-tree hashes are for a real snapshot/identity question, not every status update.
- QA can review while CI runs and accept an exact scope conditional on green required
	checks. A second review session merely to transcribe success adds no assurance.
- If the candidate changes, review the delta and its affected behavior. Do not replay
	an accepted workflow because unrelated documentation or receipt text changed.
- A lightweight isolated install may lack dependencies declared by another candidate.
	Diagnose that input mismatch before treating its type errors as a source regression.
- Owner-approved pre-customer production validation can replace elaborate staging or
	rehearsal projects. It does not waive required checks, known financial defects,
	tenant isolation, data preservation or a suitable recovery path for risky changes.
- Distinguish source, mocked workflow, real database, hosted CI, provider transaction
	and deployed-workflow evidence. A large test count does not convert one into another.
- Report a selected regression run as selected passes plus skipped cases, not a
	whole-suite pass. Source acceptance with old-base diagnostics does not waive a
	clean combined typecheck or required integration CI.

### Evidence levels for user-facing claims

| Claim | Required observation |
| --- | --- |
| Implemented or source-accepted | Exact candidate and applicable author/independent checks |
| Deployed | Exact successful deployment, canonical target and required configuration/schema |
| Frontend-verified | Visible authenticated affected workflow with actual actions and states |
| Provider or transaction verified | Actual authorized provider response/effect, with capture, signed delivery and settlement distinguished |

A feature can be mounted in deployed source but hidden by configuration, blocked
on auth or never exercised in a real browser. Preserve source acceptance while
reporting that gap. Configuration-only redeployment can change enabled behavior
without changing the Git SHA: retain deployment identity and configuration scope.
An anonymous denial changing from disabled to sign-in-required is a useful gate
signal, not evidence that checkout or a transaction completed.

## Reporting standard

Record exact counts and commands, distinguish warnings from failures, and call out anything not tested. A green unit suite does not prove generated assets or live SQL are correct.

- Exercise integration contracts at their owning boundary: SDK auth callbacks, resolved error responses, delayed account changes, and private-view teardown need more than pure-model tests.
- A live integrity checker must report unreadable or unsupported records separately, not count them as healthy. Test that its readers cover every registered product and fail its gate on unreadable or inconsistent records.
- For randomized interaction tests, choose a deterministic setup that guarantees the intended transition. A swipe may legitimately be a no-op on a random board; fix the precondition without weakening the gesture assertion.
- Align reporting keys and labels with the backend's calendar timezone. Test near midnight where the reporting date differs from UTC and the viewer's local date, as well as delayed responses after filter or auth changes.
- Separate generated-page smoke checks, authenticated workflow tests, and deployed-byte checks. Visible sign-in controls do not prove OAuth consent or owner-only rendering.

## Core regression gates

A required merge gate for the product's core loop. AdBrain numbers are examples
from [the Create reliability incident](../incidents/adbrain-create-reliability-2026-10.md).

- Build it from recorded production responses, including their latencies, not
	hand-written mocks: a known-good provider run, a real planner reply, real
	provider campaign responses. Example: 28 tests in 6 files, about 4s offline;
	the CI job took 2m0s including dependency install (verified in CI).
- Mutation-check every gate: break the code on purpose and confirm it turns red.
	Nine mutations did, including validator always-fail and always-pass, a
	misclassified timeout, a loosened attempt limit, a removed key-skip, a narrowed
	CSP directive, objects created active instead of paused and a removed fallback.
- Test deadline budgets on a virtual clock that replays recorded latencies, plus
	a separate worst-case test (every attempt at its limit). The replay can pass
	while the worst case exceeds the deadline.
- Set routing variables explicitly in each test or assert the production default.
	A provider-order default change broke 3 recorded-path tests (expected 3 saved,
	got 6) until the order was stubbed in setup.
- Test a provider-dependent route twice: with the model call mocked, and through
	the real SDK with recorded transport replies (success, all providers 503, a hang
	that must fall back inside the route limit).
- Every core production fix ships with a core test shown to fail on main first.
- A stage-shaped synthetic fixture is temporary; replace it with a real capture
	as soon as one exists.
- Record provider fixtures from a disposable object created paused in an account
	whose spend cap is already reached, through a recorder that redacts tokens.
	This proves the API-client path only; the same flow through the UI is separate.
- Production smoke is read-only by default: block writes, suppress automatic sync
	and telemetry, print one PASS/FAIL line per step. Paid and provider-writing
	modes are opt-in flags. Run it headless; hidden shared-browser tabs and expiring
	shared sessions make browser-driven smoke unreliable.
- Production database evidence goes through one read-only command: a fixed target,
	a single SELECT/WITH statement, a read-only transaction, the token kept in memory.
	Reject write-shaped input before any network call.
- Done means repeated production success, for example two consecutive full runs,
	not one pass. One 3/3 run at 265s of a 270s deadline was not proof.

## Failed checks and reruns

- Read the specific failure before rerunning. Repair a repeatable touched-path defect and rerun the same check first.
- When evidence suggests timing or isolation sensitivity, rerun only the failures, optionally serially, without changing assertions. A successful rerun does not prove resource contention or fix the underlying cause.
- Preserve the initial failure, rerun conditions, and remaining uncertainty in the report. Do not repeatedly rerun until green or describe an intermittent suite as consistently clean.
- If an unchanged area blocks release, keep its checks intact. A bounded diagnostic rerun can inform the decision; persistent failures require investigation or an explicitly reported blocker.
- Distinguish applicable passes from intentional viewport skips, and focused checks from the full release suite.

## Concurrent deployment identity

- Inspect staged paths and preserve other actors' changes. Capture the commit identity from the commit operation; a later `rev-parse HEAD` may already name someone else's commit.
- In a shared worktree, inspect both `git status --short` and `git diff --cached` before staging. Stage only owned paths or hunks; explicit paths alone do not protect someone else's edits in the same file. Do not reset, stash, or unstage another actor's work to manufacture a clean index.
- When HEAD or the remote branch moves unexpectedly, inspect the reflog and ancestry before assuming work was lost. Fetch before an authorized push and compare revisions. Bot-generated commits are still concurrent changes; do not automatically rebase a dirty shared worktree or force-push over them.
- A modification may restore stale source and remove shipped behavior. Compare its intent with the relevant base and generated artifacts; reconcile with the owner rather than discarding it solely because it differs from the remote.
- Track workflow runs by full SHA, not an assumed current HEAD or an abbreviated filter that can miss results.
- If a descendant revision is deployed, confirm ancestry and identify the combined revision. Do not reset or force-push away concurrent work to recover the expected SHA.
- Use the repository's existing deployment mechanism. A Pages workflow deployment is not interchangeable with a separate branch-publishing command.
- Await the actual deployment conclusion and inspect the live invariant before saying the change is live. Avoid noisy repeated polling; use a completion wait with bounded output when available.
- Source/API inspection, blocked-network browser tests, and live checks prove different things. State which evidence supports each claim.

## Branch and worktree parity

- Fetch remote state before comparing branches. Report local branch, remote branch,
	worktree HEAD, and deployed SHA separately; they can all differ.
- Prove containment with `git merge-base --is-ancestor <candidate> origin/main`
	or inspect `git log origin/main..<candidate>`. A historical release branch can
	contain no missing work even when its tip differs from main. Use `git diff` to
	establish exact tree equality when that is the requirement.
- Selective cherry-picks can make ancestry and merge-base comparisons misleading
	for a feature inventory. Compare production and candidate endpoint trees plus
	relevant patch content before calling retained branches unshipped work. Integrate
	a full accepted stack once; do not apply both its original commits and copies.
- Preserve dirty work during a release. An isolated worktree can ship a reviewed
	subset, but its cleanliness says nothing about the original checkout. List
	excluded modified and untracked paths explicitly; `git diff` omits untracked
	file contents.
- Before integrating preserved edits, compare their intent with the current
	released base. Keep concurrent changes, resolve overlaps deliberately, and
	test the assembled result. Never discard apparent stale changes by assumption.
- Stage explicit paths and inspect the staged diff. Follow the repository's
	protected promotion path, bind checks and merge to the exact reviewed head,
	then synchronize the production merge back into development.
- Branch deletion is a separate cleanup decision. First prove containment;
	do not delete branches or attached worktrees merely to make counts match.

### Already-published changes in an older checkout

- A large modified/untracked count can be an old local baseline, not missing
	publication. Compare every changed path, including untracked contents, with
	the fetched release tree before committing or deploying again.
- For explicitly requested cleanup, first require an empty staged diff, correct
	branch, fast-forward ancestry, and exact equality with the intended remote.
	Any differing or missing path stops this procedure for separate review.
- With writers paused and those conditions proved, a mixed reset to the verified
	commit can align the branch/index without rewriting working files. This is a
	narrow reconciliation operation, not a general dirty-worktree cleanup recipe.
	Never substitute a hard reset, clean, or stash.
- Fingerprint file contents, modes, and symlink targets before and after; verify
	no working-file changes, clean status, and local/remote commit equality. Inspect
	other worktrees independently rather than assuming they contain no new work.

### Deployment state is not deployment completion

- A project's production-target pointer can name an INITIALIZING deployment.
	Require the exact commit's successful deployment state and canonical-host
	evidence, then test the affected authenticated workflow. A preview success or
	homepage response does not satisfy this gate.
- If management access fails, report that failure separately. An exact-SHA
	successful provider/GitHub deployment receipt plus canonical workflow evidence
	can support a qualified report; do not invent an alias API verification.
- Follow existing build events before requesting another deployment. A manual
	fallback needs its own approval and must bind to the tested immutable SHA.
	If the original catches up, reconcile duplicates and cancel only an owned,
	redundant queued build; never promote an arbitrary preview to clear a queue.
- Distinguish a missing Git-triggered deployment from a queued build: check the
	exact merge SHA in deployment records and verify project/repository/branch
	linkage. Green CI and correct linkage alone do not prove delivery or explain
	the missing trigger.
- Obtain fallback approval for this release, not a previous one. Once approved,
	recheck for an existing build, deploy the immutable Git source with existing
	settings, and require READY plus canonical-alias verification. A successful
	fallback does not establish that automatic Git delivery is repaired.

## Evidence and authorization boundaries

- Record code publication, migration, environment changes, deployment, and live
	provider mutations separately. Approval for one does not imply the others.
- Record current standing authority by scope and target. Explicit newer authority
	can supersede a historical approval hold; do not resurrect it from old receipts.
	Still report factual readiness gaps. Broad software access is not a spending mandate.
- Check how required CI is triggered. A feature-branch push may create zero checks
	when workflows listen only to integration branches or targeted PRs. Obtain the
	required checks through the authorized workflow rather than treating zero as green
	or repeatedly asking for already-granted publication authority.
- A preview URL or configured deployment-disable rule does not prove isolation.
	Verify actual deployment behavior and credential/database targets before use.
- Authenticate the intended owner and business before acceptance testing. An
	HTTP 200 with empty results for another tenant proves neither saved-result
	recovery nor that the correct account was selected.
- Consent mocks, application publication, and API-tier approval do not prove
	real customer consent. Record the last completed step and leave the cause of
	an external restriction unconfirmed until evidence distinguishes it.
- Date demo receipts and name their tested commit, request count, and writes.
	A successful one-item generation does not validate a default multi-item batch.
	Never repeat a paid rehearsal under an already-consumed approval.
- A read-only provider estimate proves request acceptance and returned estimates,
  not persisted configuration, exact geographic boundaries, delivery, or paid
  output quality. Do not silently replace a saved-behavior gate with that result;
  obtain an explicit decision and retain the limitation in the release receipt.

## Common traps

- Trusting stale language-server diagnostics over the build.
- Running only the full suite after a bug fix and missing the causal check.
- Calling a database definition check “functional” without exercising the trigger.
- Forgetting to rebuild all consumers of a shared module.
- Committing generated output from another actor or leaving the tree dirty.
- Treating rerun success as a diagnosed or repaired flaky test.
- Claiming the deployed SHA is the agent's commit when a concurrent descendant was actually released.
- Mocking a follow-up list reload as `results: {}`: it silently wipes the refreshed state under test. Return the stored result the server would send (#173).
- Changing a pre-filled default without grepping the tests for its old value: every route test that asserts the default total shifts with it (#225).
- Faking an auth outage with a 5xx in a unit test: Supabase auth-js treats every 5xx as retryable and backs off for seconds. Use a non-5xx error (a 429) or fake timers (#237).
- Trusting a test run after editing through an editor tool: edits to two files stayed in unsaved editor buffers, so the tests ran the old files on disk. Check `git status` after editing (#229).
- Using hex-looking test values in fields named `key` (`key: "0123456789ab"`): gitleaks `generic-api-key` flags them, and it scans every commit in a PR, so a later fix does not clear it (#258).
- Pushing without a local secret scan: run `gitleaks git --log-opts=origin/main..HEAD --redact` first, and use low-entropy fixture values such as `aaaaaaaaaaaa` (#258).

## Evidence

See [portfolio shelf and release](../incidents/portfolio-shelf-and-release.md): local failures passed serial reruns, CI failed unchanged sculpture assertions before a successful failed-job rerun, and a concurrent descendant was the deployed revision. No assertions were weakened; failure causes remain uncertain.

[AdBrain PR #18](https://github.com/vanshulgoyal101/adbrain/pull/18) (2026-09-19)
recorded delayed deployment completion, exact-commit provider evidence, and
canonical authenticated checks. Follow-up reconciliation found 93 local paths
already equal to the released tree; all 490 fingerprinted working files remained
unchanged while the old branch/index baseline was aligned with explicit approval.

## AdBrain lessons (Oct 29)

- When a rule tightens what an input may mean, run the production smoke's own saved
  data through it before merging (#1745).
- A structural (AST) guard test doesn't prove behaviour. Plant a failing case first,
  then pair it with a recorded route case and one mutation per layer, each turning only
  its own case red (#1729, #1961).
- Gate checks done at preflight go stale across a multi-minute step; re-check right
  before the irreversible action (#2187).
- Delete old secret copies only after proving the new path succeeds and the policy
  denies the branch, then test again without fallback credentials (#1893).
- Trace a stored-format change to every consumer of the bytes: a shared validator
  re-encoded to PNG, so a later converter was dead code and exports shipped PNG. Test
  real bytes at each consumer, not mocked buffers (#1963, #2016, #1897).
- Pure move refactor: re-export from the old module so call sites don't change and the
  type check is the proof; move each test's module mock with the import, or
  `instanceof` compares different classes (#1824, #2165). Keep a helper a client needs
  in a neutral module rather than importing an adapter for it (#1968).
- A scheduled job is live when its log line appears, not when it merges: the supervisor
  runs main and may skip ticks under load. Grep the logged text, not the script name
  (#1856, #1857).
