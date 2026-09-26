> Historical reference frozen before O-11. The [current plan](ORCHESTRATION.md)
> supersedes all dispatch and permission instructions here. Do not execute old
> assignments or treat historical status as current acceptance.

# AdBrain Worker Orchestration

Revision O-10, September 26, 2026. Maintainer: CEO/coordinator.
Roster: CEO, Dev, Dev 2, DevOps, QA. This is the authoritative coordination board,
ownership register and decision log, not a new implementation backlog.

Read [Operating Brief](OPERATING-BRIEF.md) for product context,
[remediation packets](qa/remediation-plan-2026-09-26.md) for technical acceptance,
and [Releasing](RELEASING.md) for publication and production controls.
This document supersedes older worker assignments, not historical test receipts
or owner approval requirements. New owner instructions take precedence; record
their effect here before handing out conflicting work.

## Start and Reporting Protocol

1. Read the fast path below, your assigned GitHub issue and only the peer inputs
  needed for the next action. Check your branch and relevant ownership; do not
  reread the full board/history on every resume.
2. Include worker, packet, source and conflicts in the first progress update,
  then do the work. No acknowledgement-only turn or extra allocation sign-off.
3. Begin only the permitted phase. Contract work may start now; dependent writes
   wait for CONTRACT-BC acceptance and any shared-file reservation. A new file
   under another owner's module is still a cross-owner change.
4. Report at handoff, blocker, scope/interface change or failed acceptance. Avoid
   repeated full status reports and polling other workers for reassurance.
5. The coordinator reads saved worker receipts directly and updates this board.
  Workers own their receipts, not simultaneous edits to the central board.
  Owner copy/paste of chat responses is not a handoff requirement.

### Publication Policy Mismatch

Current recovery dispatch: owner reports only DevOps active; other workers idle.
- DevOps: diagnose/contain the two unexpected previews and establish effective
  deployment policy. If G-2 has already merged, verify its resulting deployment
  and affected workflow; do not repeat the merge or promote another candidate.
- Dev 2: fix QA's blocking #27 truncation-usage finding in the existing issue
  worktree. Preserve reported provider/model/token usage on terminal failure and
  record it exactly once through existing accounting; no extra paid attempt.
  Add the focused regression, commit locally, then hand the delta to QA. No push
  until this publication hold is resolved.
- QA: review #28's added status-filter fix from `853d197` to `bab47d0` only;
  retain prior accepted evidence. Then re-review #27's accounting repair when
  delivered, using the concrete finding on PR #29 as the acceptance criterion.
- Dev: standby for a concrete #28 review correction; do not start another feature
  or framework migration merely to keep the worker occupied.

Current hold: #27 and #28 report completed unintended Preview deployments from
`feature/issue-27-ai-sdk` at `da4f209` and `feature/issue-28-tanstack-query` at
`bab47d0`, despite the recorded disabled-feature configuration. Their saved
worker receipts/PR warnings supersede the earlier configuration-only assurance.
Pause further feature/release branch pushes and production promotion until
DevOps verifies effective branch matching and preview isolation. Local coding,
commits, QA review and already-running CI may continue; do not rerun application
tests merely for this hosting investigation.

DevOps owns the immediate diagnosis and verified containment of these specific
unintended previews. Check deployed environment scopes and possible runtime effects
without revealing secrets or exercising paid/customer workflows. Do not alter
production, rotate credentials or delete data under this instruction. Report the
actual cause, bounded corrective action and evidence that suppression/isolation
works before lifting the hold. No exposure or production impact is established
yet; a Ready preview status is not evidence of either safety or a data breach.

### O-10 Fast Path

G-2 repair handoff: coordinator fixed QA's P1 in `/tmp/adbrain-o8-ePtVWk/g2`
and releases its temporary source/test slot back to DevOps. Only Studio and its
existing test file changed; shared application files and #27/#28 are untouched.
Base remains `a7445f565586a2c4b484036b3bc12b01af28c7ea`; updated full diff SHA-256:
`f87cee447f67de82c9a6c6517841eb0c56b3513dbfd2303c477189809a118652`.
Cleanup now removes storage/local pending state only for its captured ID/count.
The React two-instance regression first failed with newer identity lost (null),
then passed. POST completion/rejection, GET recovery and storage read/removal
failure coverage now add five cases; all 35 Studio tests pass on Node 24.21.0
with the frozen unit guard and synthetic configuration. Touched ESLint,
`tsc --noEmit --incremental false`, whitespace and editor checks pass.
QA reviews the changed cleanup/regressions only; author tests are not independent
acceptance. DevOps captures this new diff, updates the patch secret scan and
proceeds through authorized commit/CI/protected release after QA approval. No
full-platform rerun, new install, migration, provider operation or publication
was performed by the coordinator. No current source/test slot is held.

Owner requests faster, higher-utility execution. These rules supersede older
procedural waits for acknowledgements, routine file/allocation approval, feature
branch publication and duplicate validation. They do not expand issue scope,
accept unfinished contracts or waive financial/data/tenant/release controls.

| Worker | Act autonomously now | Stop only at this boundary |
| --- | --- | --- |
| Dev / #28 | Implement, install issue-only dependencies, test and commit in its chosen issue worktree; push its own feature branch and open/update its issue-linked PR to dev | No shared checkout/index/lockfile changes, peer-worktree edits, unreviewed shared API redesign or merge into dev/main |
| Dev 2 / #27 | Same authority for the AI SDK issue; keep the existing facade and cost/cancellation rules | Same ownership boundaries; no provider/model/paid-service or financial-policy expansion |
| QA | Review a real diff immediately, in parallel with author/CI checks; post findings or approval conditional on exact-head required checks | No product fixes or substituted expectations; reopen for changed source or a failed required check, not merely because CI finished |
| DevOps | Integrate reviewed branches, resolve shared lockfile changes, batch ready backlog commits and promote approved release candidates | One writer to dev/main and production; required checks, compatible rollout and exact deployed-workflow verification remain |

Feature-branch publication/PR creation is authorized for #27/#28, without another
DevOps approval, after verifying effective deployment policy for that branch.
This is distinct from integration/main/production authority. Read-only audits and
local installs use the issue worktree, never the shared dependency tree. Reuse
the recorded allocation; creating a second copy is not progress. A required
helper/test file within an issue's owned module needs no naming approval; a new
cross-owner/shared interface or broader product scope still needs coordination.

Validation by risk, not ritual:

- Documentation-only: relevant link/format check; no application build or suite.
- Ordinary code: focused behavior tests plus applicable lint/types. Expand only
  for the change's real shared impact or a failure. Run checks after meaningful
  edits, not after every status note.
- Dependencies/shared contracts/data/auth/money: retain compatibility, audit,
  isolation and integration checks relevant to that risk; rare high-consequence
  failures are not waived as low utility.
- Release: reuse successful evidence for the exact source/dependencies/config and
  required runtime. Required hosted checks still run. Do not add duplicate local
  full-suite/build runs solely to repeat equivalent green CI; mismatched runtimes,
  changed dependencies or a changed candidate require the relevant new checks.

Keep review and validation independent but concurrent. QA may approve the reviewed
scope contingent on required checks; DevOps verifies those checks and proceeds
without another QA session to transcribe them. An actual regression or changed
diff reopens the affected review. Known unrelated backlog findings do not expand
the release; never suppress them or ignore a required failure to get green CI.

Use standard test commands and prepared environments; no bespoke test harness or
repeated whole-tree hash inventory for routine committed work. For a handoff,
record commit plus dirty diff when needed; full manifests are for genuinely
uncommitted multi-owner snapshots. Audit/install again when dependency inputs or
the target environment change, not because another worker wants a duplicate log.

Prefer a useful vertical slice over cosmetic refactors. Research ends when one
compatible maintained option and its focused verification path are identified;
any further spike must answer a named blocking question. Freeze agreed interfaces
and implement them instead of iterating on names. Ready related commits may share
one dependency-complete release; never include unfinished work just to fill a batch.

One short issue/PR update per delivered slice or real blocker: source, what
changed, check result, next owner. Link evidence rather than recopying it into
multiple reports. Do not write tests whose only purpose is certifying a status
paragraph. Track elapsed time as coding, necessary checks/CI, or blocked handoff
in that update; use actual bottlenecks to improve the process, not a new dashboard.

Continue permissible work while a dependency is unavailable. Missing private
allocation, package selection or optional polish is not a reason for an idle
status-only turn. Independent chats still require a user resume; there is no
automatic wake-up service, polling loop or new worker requested by this policy.

Every update answers only:

> What changed? Which exact source was tested? What passed or failed? What
> dependency or decision blocks you? What is the next acceptance check?

All four O-1 acknowledgements were relayed by the owner on September 26 and are
recorded below. O-2 resolved their ownership/resource requests without changing
packet assignments. O-3 added a scoped Git checkpoint proposal. O-4 made saved
receipts the default communication channel. O-5 recorded developer checkpoints.
O-6 records completed D-1/runtime handoffs, approved G-1/G-2 publication and the
owner's standing production-promotion approval. O-7 created the GitHub reuse
milestone. O-8 records G-1 shipped, activates that milestone, and prioritizes
reconciling/publishing the remaining local backlog. Read the relevant delta and proceed;
do not spend another turn merely repeating the acknowledgement. Report only a
new conflict or material deviation. Delivery of board updates to other chats is not automatic;
there is no background scheduler or enforced file lock here.

### File-Based Handoffs

Use the existing files, not another inbox or a transcript relay:

- Dev: [delivery handoff](qa/db-a-dev-a-handoff-2026-09-26.md).
- Dev 2: [spend handoff](qa/dev2-devc-contract-o1.md).
- DevOps: [operations receipt](qa/ops-environment-2026-09-26.md).
- QA: [acceptance handoff](qa/qa-a-o1-handoff.md).

At a completed checkpoint, each worker saves its version, source identity,
results, unresolved requests, next consumer and held/released resources in its
owned receipt. Mark the checkpoint complete only after validation. Chat replies
may be a short pointer; do not ask the owner to relay the full response.

On resume and before declaring an upstream blocker, read this board and the
relevant peer receipt in the shared workspace, not a stale isolated source copy.
Consume delivered inputs within the assigned scope; changes to ownership,
contracts or external authority still require the existing gates. Never poll,
sleep or keep a process running merely to wait for another chat.

When the owner says **sync workers**, the coordinator reads all four receipts,
reconciles completed checkpoints and records decisions/next actions here. This is
a normal chat request, not an installed slash command. Recheck receipt versions
before acceptance; an incomplete or changing checkpoint is not a frozen handoff.

Active workers pick up updates at their next checkpoint. Idle chats still need
a manual **continue**; file changes do not wake them. A future coordinator-owned
subagent workflow can collect its own delegates' results without owner relaying,
but cannot attach to these existing chats. Transfer a packet only after its
current writer checkpoints and explicitly releases it; do not duplicate workers.

### O-7 GitHub Milestone

Owner selected open-source reuse plus GitHub issues/code review as the next major
task. [Milestone 1: Open-source integration: AI and campaign data](https://github.com/vanshulgoyal101/adbrain/milestone/1)
is created with two scoped implementation issues. GitHub owns their current
scope, acceptance checklist, review discussion and integration state; this board
owns worker/resource assignments. Do not maintain a second copy of the backlog.

| Next packet | Implementation / review | Start and boundary |
| --- | --- | --- |
| [#27: AI SDK integration](https://github.com/vanshulgoyal101/adbrain/issues/27) | Dev 2 / QA | Replace provider plumbing behind the existing LLM facade; preserve routing, usage, cost and cancellation behavior. No image/model/prompt overhaul |
| [#28: TanStack Query campaign list](https://github.com/vanshulgoyal101/adbrain/issues/28) | Dev / QA | One complete campaign-list read workflow; preserve tenant/filter/cursor behavior. No change to delivery, payments or automatic mutation retries |

O-9 authorizes both packets to start in their own allocated worktrees; actual
start is reported by each worker. Before starting, the worker
checkpoints/releases its prior active packet without deleting retained evidence;
use a clean current-dev worktree. Allocation does not wait for shared-checkout
reconciliation or a DevOps receipt. No shared branch switch or rewrite of the B copies.
DEV-B/C implementation and other queued work are parked for this bounded wave,
not marked complete or made safe by SDK adoption. Existing safety gates remain.

DevOps coordinates package/lock changes and serializes final integration; neither
developer changes the shared dependency tree. After allocation, the two isolated
implementation paths may proceed independently. Choose and audit suitable pinned
versions before writing adapters; do not change providers/accounts or introduce
a paid gateway. pg-boss/Meta SDK evaluations, MSW, Radix, phone utilities and other
audit candidates are later opportunities, not extra tasks in this milestone.

Each implementation gets a focused PR to dev referencing its issue, actual test
results, dependency/license assessment and rollback. QA records real findings or
a scoped no-blocking-findings review against the exact commit. If author and QA
use the same GitHub account, disclose the AI-assisted review in a PR comment;
do not fabricate a second human reviewer or self-approval. Required CI remains.
Closing keywords on a non-default dev-targeted PR may not close the issue; verify
closure and close manually only when its acceptance criteria are met. Production
release/deployed-workflow evidence remains separately recorded under O-6 authority.

No implementation PR or formal review is created before a real diff exists.
Public issue/PR content must exclude credentials, customer data and private local
artifacts. Use links to published source and sanitized evidence. Issue creation
is not implementation, acceptance or deployment. No additional workers requested.

### O-8 Dispatch and Faster Integration

Owner reports all workers idle and requests faster publication with fewer
redundant checks. The [completed G-1 release](qa/ops-environment-2026-09-26.md#o-6-g-1-production-release)
records PR #26, merge `a7445f565586a2c4b484036b3bc12b01af28c7ea`, four green
hosted CI runs and verified production deployment. DevOps released its heavy slot.
G-1 is not an outstanding release task; no repeat approval or full validation run.

At this sync, shared local dev remains `9da5b07`, four commits behind tracked
origin/dev. G-1's three files have no diff against origin/dev, despite showing
modified against old local HEAD. Most other local work is genuinely unpublished.
Do not promise that syncing three shipped files will clear the whole change list.

1. DevOps first preserves a reproducible snapshot of all pending tracked/untracked
  source (secrets and private evidence stay private), verifies current remote
  tips, then reconciles the shared checkout with shipped history while no other
  worker writes there. Preserve every unpublished hunk; no blanket reset, stash,
  force push or deletion. Stop on a concrete conflicting path, not a generic
  dirty-tree warning. Return before/after counts of pending versus already-shipped
  changes. This checkpoint is explicitly authorized, not permission to discard work.
2. The coordinator or assigned developer may allocate a fresh current-dev
  worktree/feature branch for its issue after checking for an existing allocation.
  DevOps is not a required intermediary. Existing B copies remain retained. Developers
  checkpoint their old packets, then implement their issues; no new contract
  drafting assignment. DEV-B/C safety work remains parked, not accepted.
3. DevOps publishes G-2 next, then assembles the existing DB-A code/schema/tests,
  disabled test-payment code/dependencies/tests, operations tooling/config/tests,
  and public coordination/docs as separate dependency-complete batches to dev.
  This is coordinator scope approval for the existing backlog, not arbitrary new
  features. Freeze exact hunks and have QA review each candidate; split shared
  files deliberately, never stage the whole dirty tree. Public docs need link and
  privacy checks; exclude private artifacts. Source publication of SQL is not
  authorization to apply it. Production promotion still needs O-6 release gates.
4. QA prioritizes frozen backlog/issue PR review and evidence consumption. Review
  the G-1 receipts without repeating its already completed runtime suite. Report
  actionable findings, not another setup narrative. Keep implementation review,
  hosted CI and production verification distinct.

For #27/#28 only, developers may add/pin/install the issue's dependencies in
their own allocated worktrees. DevOps retains sole shared package/lock ownership
and final lockfile integration; no shared installs or simultaneous integration.
Short isolated unit checks can proceed independently when resources permit;
DevOps schedules heavier builds/browser/DB runs. Do not serialize ordinary code
editing or read-only review behind a test slot.

Verification budget: one focused author check per meaningful source change, one
independent scoped review, required hosted CI and relevant release smoke. Reuse
completed evidence for identical source/config/runtime; repeat only affected
checks after a material change or an actual failure. No full-suite replay for
documentation-only status updates, repeated manifest rechecks for reassurance,
or generic infrastructure expansion before publishing a ready batch. Required
checks, secret review and financial/tenant protections are not waived.

### O-9 Allocation Unblock

Coordinator completed the one-time #27/#28 local allocation; DevOps keeps
shared-checkout reconciliation and publication. Created and verified from observed
origin/dev `a7445f565586a2c4b484036b3bc12b01af28c7ea`:

| Issue / writer | Worktree | Branch |
| --- | --- | --- |
| #27 / Dev 2 | `/tmp/adbrain-issue-27-o9` | `feature/issue-27-ai-sdk` |
| #28 / Dev | `/tmp/adbrain-issue-28-o9` | `feature/issue-28-tanstack-query` |

Both checkouts were verified clean on the branches/base above, with no .env.local
or installed dependencies. This section is the completed allocation handoff.
Reuse these paths, do not allocate duplicates. No additional DevOps approval or
receipt is required to begin coding.
Read current instructions from the shared workspace; the clean base predates
this board. Developers may install issue-scoped dependencies only in their own
worktree. Do not copy root environment files or alter shared dependencies.
O-10 permits each issue owner to publish its feature branch and PR after branch
deployment checks. Shared integration and production remain DevOps-owned.

Allocation overlap: DevOps also created `/tmp/adbrain-o8-ePtVWk/issue-27` and
`/tmp/adbrain-o8-ePtVWk/issue-28`. Use the O-9 allocations above by default; do not
start duplicate implementations. If an owner already began work in an O-8 copy,
keep that work there and report the chosen path in its receipt instead of moving
or discarding it. Preserve unused copies until their owner explicitly releases
them. DevOps' separate `/tmp/adbrain-o8-ePtVWk/g2` remains the G-2 release candidate.

### G-2 QA Dispatch

The coordinator's P1 repair and new diff identity in O-10 Fast Path supersede the
original frozen patch below for the next review. Old evidence remains historical.

QA's next task is [G2-QA-REVIEW-O8-1](qa/ops-environment-2026-09-26.md#g2-qa-review-o8-1),
now delivered. Review `/tmp/adbrain-o8-ePtVWk/g2`, branch
`release/o8-g2-eptvwk`, against base `a7445f565586a2c4b484036b3bc12b01af28c7ea`.
Frozen patch SHA-256 is
`edd3bbbd593bcb51e6a58f87120fb402656a7d3c283ffd177b5bda841ad05410`;
the Ops allocation receipt records both changed file hashes.

Scope: Studio and its tests only. Check saved generation identity before POST,
lost-response/reload recovery, duplicate-submit prevention, partial results and
blocked-storage behavior. Return scoped approval or actionable findings bound to
that diff; runtime checks and release acceptance remain separate. Preserve UI-01
and server-intent/quota limitations rather than claiming they are solved. Do not
rerun G-1, wait for unrelated reconciliation conflicts, edit the release candidate
or compete with DevOps' G-2 test slot. Record review in QA's existing receipt and
on the actual PR when available; no empty PR or duplicate test run is needed.

### Acknowledgement and Dispatch Record

Initial acknowledgement source: owner-relayed messages. Delivery updates now use
saved worker receipts, not new coordinator runtime verification. All four
reported dirty `dev` at `9da5b07b00e54fb552796cbcf01cc5fc7c2f02e7`, two commits
behind tracking refs, no new edits/tests during acknowledgement, and no held
server, database, VM, port or background execution. These are dated reports, not
proof of current availability. Candidate B remains the accepted local baseline.

| Worker | Recorded acknowledgement | Next deliverable | Actual start/completion |
| --- | --- | --- | --- |
| Dev | #28 implementation; prior DEV-B checkpoint retained | Implement TanStack Query campaign-list issue in its allocated current-dev worktree; focused tests and issue-linked PR | Owner reports idle; next issue start not yet reported |
| Dev 2 | #27 implementation; prior DEV-C checkpoint retained | Implement AI SDK facade issue in its allocated current-dev worktree; focused tests and issue-linked PR | Owner reports idle; next issue start not yet reported |
| DevOps | Sole shared Git/lockfile integration and release executor | Reconcile shipped local history, allocate two issue worktrees, publish G-2 and scoped existing backlog batches; report commits and remaining counts | G-1 shipped and verified at a7445f5; heavy slot released; all workers reported idle |
| QA | Independent backlog and issue PR review | Review the delivered G-2 frozen diff now; consume DevOps' focused results as available, then review subsequent backlog/#27/#28 PRs | G-1 completed evidence accepted, no new findings or application reruns. G-2 intake is available; prior missing-candidate blocker is superseded |

Current execution update: all workers idle per owner; O-8 is their next dispatch.
No worker is automatically started. Preserve existing resources; shared-checkout
reconciliation is DevOps-only, while new implementation belongs in isolated copies.

### G-1 Release Dispatch

O-8 supersedes the pending language below: G-1 is shipped and verified. Retain
this historical dispatch and its identities, but do not execute it again.

Immediate coordinator instruction to DevOps: **ship the accepted G-1 candidate
to production through the O-6 protected path; do not stop at another preparation
receipt or request owner permission again**. Required checks remain mandatory.
QA's independent exact-diff review is now satisfied for the pinned identity below.
DevOps continues candidate checks; runtime/release acceptance remains separate.

The [frozen candidate](qa/ops-environment-2026-09-26.md#o-6-g-1-frozen-review-candidate)
is available with base `2d94788ec2499b6ec7b9652d8b5fb2f0b898dea5`, manifest
`910fc4b0e57d6c7de44d686fb2b72095b298c996d119ecc9bce93efde57ff334` and diff
`de031df87ca155b3fc72fe804eb52fdf703c0f1d0f4f79a3129dc7bd1ac4782d`.
QA consumes those saved artifacts directly; missing later runtime results does
not block code review and is not permission to claim runtime acceptance.

G-1 has the next unoccupied resource-heavy slot. Before starting, DevOps checks
recorded active execution ownership; do not interrupt any running test. Queued,
not-started DEV-B/C baseline tests yield to this release and resume afterward.
Their known failures, full draft-fixture conversion, D-2 design and managed-funding
work are not dependencies of this three-file code-only fix. Candidate-required
tests and real shared regressions remain gates, regardless of packet labels.

Install/use a verified secret-scanner tool when absent rather than treating a
missing local executable as an indefinite blocker. Verify the target project,
committed Vercel configuration and documented Git-deployment behavior; if a
required rule cannot be established, return the exact missing evidence/action.
For any blocked gate, record command/check, result, responsible owner and next
action. No "awaiting approval" or "awaiting candidate" placeholder for delivered
inputs. No bypass of CI, review, protection or separately scoped financial/data
controls. Do not merge G-2 or unrelated dirty work merely to ship G-1.

Historical Vercel interpretation, superseded by the publication-policy hold above:
the coordinator fetched the
[official Git configuration reference](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled)
and the [published base configuration](https://raw.githubusercontent.com/vanshulgoyal101/adbrain/2d94788ec2499b6ec7b9652d8b5fb2f0b898dea5/vercel.json).
The documented controlling setting is git.deploymentEnabled in repository config:
the published base sets wildcard false, dev false and main true. Any matching
true rule enables deployment; therefore main is enabled and dev has no enabling
match. G-1 changes none of these rules. The absent dashboard/API branch map is
not itself a blocker or a reason to change settings. DevOps verifies the linked
project uses this repository-root config, no conflicting override, and unchanged
candidate/remote configuration before push. This establishes the documented
Git-trigger policy, not CLI-deployment prevention or post-deployment verification.

### O-6 Publication and Production Authority

On September 26 the owner explicitly approved G-1/G-2 commits and pushes to dev,
then granted standing permission to publish to production without repeated owner
prompts. This authorizes protected Git-driven promotion of completed, reviewed,
tested, dependency-complete work within the assigned project scope, starting with
G-1/G-2. It includes required release PR creation, review and merge after checks.
Earlier statements that all publication/production approval is pending are
superseded; missing technical acceptance is not superseded.

DevOps is the current executor. Any worker may assume execution after the
coordinator records the exact batch/target and transfer, and the previous executor
releases that lane. No simultaneous pushes/deployments and no implicit takeover.
QA remains independent of the author/release executor for acceptance.

Required path: focused commits into dev -> green exact-head CI and independent
review -> dependency-complete release candidate based on current main -> protected
PR with current required checks -> merge -> verify Vercel's exact deployed SHA
and the affected production workflow. Verify target/configuration and compatible
rollback before promotion. Never force-push, bypass protection, merge all dirty
work, use untested artifacts, or treat a homepage response as workflow acceptance.

This is software-release authority, not approval for production schema/data
migrations, credential changes, new paid infrastructure, preview enablement,
live payments, Meta activation/spending or unsolicited customer actions. Those
remain separately scoped. A release needing an unapproved migration stops at
that gate. Direct CLI production deployment is not the approved Git-driven path.

Use short-lived feature/release branches for isolation, dev for integration and
main for production; do not push the same work to every historical branch or
delete old branches/worktrees to tidy up. Check effective branch deployment rules
before publishing a new branch. Branch names do not isolate databases or secrets.
Commit accepted slices promptly instead of waiting for unrelated contracts.
Before starting another published batch, resolve or explicitly triage failed CI.

Use GitHub issues for substantial owned packets and acceptance/dependency links
when useful, not one ticket per handoff. PRs carry release code review; small
direct-dev batches use QA's recorded exact-diff review. No issues or PRs have
been created by this board update. No extra workers are needed for this sequence.

The [completed local readiness](qa/ops-environment-2026-09-26.md#o-4-completed-local-readiness)
and [unit execution contract](qa/ops-environment-2026-09-26.md#unit-execution-contract-and-slots)
unblock Dev then Dev 2's short serialized baseline tests. DevOps can assemble G-1
and QA can review its diff in parallel; schedule heavy candidate tests after
those slots release. Use owned executions and copies, never the shared dirty
tree as a frozen candidate. Next handoffs should be actual test/review results,
commit/CI/deployment evidence or a concrete new blocker, not repeated status prose.

### QA Checkpoint Recorded Under O-5

[QA-O4-review-1](qa/qa-a-o1-handoff.md#o-4-review-checkpoint) supports the
reconciled exposure/coverage principles, residual arithmetic and sweep-versus-
operation distinction. Do not report all six original objections as unchanged.
The five interface differences below, exact coverage-proof constraints and
provider/policy feasibility still block full CONTRACT-BC acceptance.

The delivered F-1 overlay has five files and seven supplemental vectors bring
the total to 32; these are not 32 passing product tests. The helper's six tests
use synthetic transport, not real Auth or browser execution. The two draft specs
remain preserved but unconverted; full browser acceptance cannot omit them.

DevOps consumes [QA-F1-SETUP-1](qa/qa-a-o1-handoff.md#f-1-remaining-fixture-request)
at its next safe checkpoint: supply run-scoped creative/draft identities and
preconditions tied to QA_BUSINESS_ID, plus reset/cleanup ownership or a bounded
owner-authenticated setup API. QA must not invent a service-role credential input.
QA resumes that conversion after this dependency arrives, or reviews a completed
developer delta independently. No polling or unchanged review reruns are needed.
DevOps' active work remains uninterrupted; QA retains its copy/artifacts and
reports no held service, database or heavy execution slot.

### O-5 Developer Integration Delta

Latest sync: [Dev 2's O-5 input review](qa/dev2-devc-contract-o1.md#o-5-input-review)
is complete. Its statement that Dev's file ends at B-3 is now superseded:
[D-1](qa/db-a-dev-a-handoff-2026-09-26.md#o-5-canonical-integration-delta-d-1)
is now complete with document/fixture validation recorded. Dev 2 and QA review
that pinned delta directly; no further finalization checkpoint is needed.
Do not infer finalization from terminal output or advance approval from Dev 2's
earlier flexibility on names. No additional input-only report is requested.
DevOps' completed local readiness unblocks baseline tests, not production or
browser acceptance. Its next priority is the O-6 publication sequence.

The latest completed inputs are [B-3](qa/db-a-dev-a-handoff-2026-09-26.md#o-4-b-3-contract-reconciliation-checkpoint)
and [C-draft-3](qa/dev2-devc-contract-o1.md#o-4-checkpoint-c-draft-3).
Both are delivered drafts, not implemented fixes or reciprocal sign-off: B-3
reviewed C-draft-2, while C-draft-3 reviewed B-2. Stop treating earlier versions
as the current agreement. CONTRACT-BC remains **DRAFT / not accepted**.

Dev, as shared-interface owner, consolidates these exact differences in its
existing handoff. Dev 2 responds to that delta, preserving agreed safety rules:

| Difference | Required single agreement |
| --- | --- |
| Timestamp names | B-3 selects requestStartedAt/responseReceivedAt; C-draft-3 selects collectionStartedAt/collectionCompletedAt. Choose one pair, preserving earliest request and oldest-page age semantics |
| Publication arguments | Reconcile collectionId versus runId, explicit scope/period, lease token and capacity revision; derive trusted data from validated stored pages, never caller completeness |
| Capacity read | Choose coherent snapshot projection versus a wrapper; prohibit independently assembled evidence reads |
| Pause/read result | Reconcile DeliveryRequestResult/DeliveryOperationView with PauseResult, observationId with triggeringObservationId, raw/coarse states and missing/error results; never report a confirmed ACTIVE operation as a confirmed pause |
| Errors and HTTP | Select one unknown-reason vocabulary; distinguish authority denied from authority unavailable instead of the current 403/503 disagreement; agree lease and storage failures without weakening tenant protections |

Return a compact canonical mapping and changes needed, not a new full proposal.
QA retains independent R1-R6 review; DevOps retains active provisioning ownership.
Neither active worker is interrupted or reassigned by this update. No developer
source reservation is released merely because its document checkpoint is complete.

Both drafts explicitly warn that strict reporting-watermark/coverage requirements
may block all managed starts with current Meta evidence. Provider feasibility and
owner risk policy remain unresolved; agreeing types does not establish a usable
production product or authorize a fabricated watermark/coverage credit.

The Dev 2 receipt keeps its proposed O-1 filename to avoid a second competing
proposal; its contents must state board O-2 and DRAFT contract status. QA may
create `docs/qa/qa-a-o1-handoff.md` with the same rule. DevOps appends its O-2
assembly/resource receipt to its owned ops report; dated historical evidence stays
intact. No new candidate acceptance or tests are inferred from these messages.

### First Checkpoint

1. QA extracts and hashes only the relevant preserved assertions/fixture overlays
  into its own namespace, without altering B's archive. Return expected results:
  two activation failures, two spend failures, two pagination failures and the
  separate F1/F7/UI-01 checks. Contract case drafting can proceed immediately.
2. DevOps reconstructs B once, verifies its manifest and overlays, and captures
  the current-source delta. Supply independent writable source copies for Dev
  and Dev 2 from the same identified input; QA receives a read-only baseline or
  independent copy. Do not have three workers repeat the full reconstruction.
3. Dev and Dev 2 draft their respective proposals now from B's documented behavior;
  they need no server or database for that work. Regression adoption/execution
  follows QA's artifact handoff and verified workspace allocation. Do not patch
  the moving shared test files merely to unblock an isolated run.
4. Dev and Dev 2 each review the other's proposal and return concrete agreement
  or conflicts. QA returns executable decision cases; DevOps returns cadence,
  isolation and recovery feasibility limits. CEO records one accepted contract
  version and its exact shared-interface work before product implementation.

No dependency cycle: contract drafts and QA artifact preparation do not wait for
provisioning; DevOps source reconstruction does not wait for contract acceptance.
DevOps may prepare its owned CI/provisioning tooling within the assigned slice,
but browser integration waits for QA's fixture handoff. No production approval
is bundled with this checkpoint.

## Roles and Authority

| Role | Accountable for | Must not do |
| --- | --- | --- |
| CEO/coordinator | Priority, scope, contract decisions, ownership arbitration, integration order, evidence-based ship/no-ship recommendation and this log | Quietly patch an assigned worker's code; treat a recommendation as owner approval |
| Dev | DEV-B delivery/activation and shared database authority; DB-A integration defects remain with Dev | Implement Dev 2's collector or start a competing spend policy |
| Dev 2 | DEV-C spend observations, completeness, freshness and sweep recovery | Change shared SQL/types/Meta client or activation policy without an explicit handoff |
| DevOps | Sole release executor; environment, CI, candidate assembly, migration sequencing, recovery/monitoring and resource coordination | Deploy, migrate, purchase, enable previews or change credentials without scoped owner approval |
| QA | Independent acceptance, preserved reproductions, fixture correctness and exact-candidate evidence | Silently repair product code, weaken failing assertions or certify a moving checkout |
| Owner: Vanshul | Business model, external consent, commercial/retention policy, expenditure and live-operation authority | Not assumed to be an available 24/7 incident responder |

QA supplies the independent acceptance decision. The CEO decides priority and
candidate scope; DevOps verifies release mechanics and executes only approved
operations. A failed required safety check is not waived by calling a packet done.

## Evidence Baseline

The [independent QA report](qa/independent-acceptance-2026-09-26.md) is the local
acceptance baseline. Candidate B has HEAD `9da5b07b00e54fb552796cbcf01cc5fc7c2f02e7`
plus manifest SHA-256
`9533d1d0e81069291536e6b97c020334eb1ddbf48858d31181a0181e0b5e4d13` (529 files).
HEAD alone does not identify that dirty source. Later edits require comparison
and revalidation; local acceptance does not transfer automatically to today's tree.

| Scope | Supported evidence | Still not established |
| --- | --- | --- |
| DB-A | Independent B local SQL fresh/upgrade/legacy, 13 Auth/PostgREST controls and four draft workflows pass | Production migration/legacy reconciliation, deployed grants and managed capacity authority |
| F5/F8 | B Studio recovery at 1440/390/320px and instruction-read rejection pass | Full DEV-A: server generation intent, simultaneous-request deduplication and atomic quota/liability |
| DEV-B | F1/F7 client reproductions plus two failing B activation regressions | Intended-child activation, capacity serialization and uncertain-outcome recovery |
| DEV-C | Two failing B stale/missing-spend regressions; incomplete reads source-confirmed | Complete fresh period-scoped evidence, restart behavior and measured confirmed-pause bound |
| DEV-D | Two failing B form/lead pagination regressions | Complete import, attribution, inbox paging and recipient handoff |
| QA-A | B focused tests/build and scoped browser evidence; UI-01 still fails at 320px | Full clean Node 24/Linux candidate gates, integrated hosted browser CI |
| OPS-A/B | [DevOps receipt](qa/ops-environment-2026-09-26.md) records inventory and guarded local tooling | Complete isolation, restore/alert drills, approved commercial hosting and unattended cadence |
| Payments | [Payment receipt](PAYMENTS-PLAN.md#september-26-real-razorpay-test-transactions): two genuine test captures and one intentional test-bank failure | Live collection, public webhook, refunds, settlement, spendable funds and Meta funding |

Preserve all six failing B assertions: two activation, two spend and two pagination.
F1/F7 and UI-01 remain additional checks; do not mistake six for the complete risk
register. Old reports saying DB-A/F5/F8 are wholly unaccepted are superseded only
for B's tested local scope. The receipt's temporary QA stacks have been removed;
their old paths, ports and launch commands are not reusable environment authority.

## Active Assignment Board

WIP limit: one active packet per worker, with contract and implementation phases
inside that packet. Review requests are bounded interruptions, not a second build.

The table below retains the pre-O-7 safety work. O-7's GitHub milestone is the next
implementation wave after release handoff; do not start both waves concurrently.

| Worker / packet | Objective and first action | Dependency / permitted phase | Next acceptance check |
| --- | --- | --- | --- |
| Dev / DEV-B | Draft CONTRACT-BC delivery/reservation section; adopt the two activation reproducers in owned tests; retain DB-A compatibility responsibility | Contract and regression work now; implementation after contract acceptance | Two INR 200/day starts cannot both pass an INR 2,000/week cap; saved-response failure does not blindly repeat provider mutation; only reviewed children activate |
| Dev 2 / DEV-C | Draft CONTRACT-BC observations/period/freshness section; adopt stale/missing regressions in owned tests | Contract and regression work now; collector/enforcement implementation after contract acceptance | Stale/missing/partial data is unknown, all required pages are accounted for, interrupted collection resumes and confirmed-pause timing is measured |
| DevOps / QA-A infrastructure slice | Produce reproducible isolated Node 24/Linux candidate provisioning and browser CI; identify compatible DB-A rollback artifact | Local tooling now; coordinate QA fixture handoff; no hosted publication or infrastructure purchase implied | Clean install, candidate/server identity, actual local Auth/REST/Storage, server-side provider blocking, no arbitrary server reuse, sanitized artifacts and owned teardown |
| QA / QA-A acceptance slice | Preserve B archive/reproducers; agree DEV-B/C tests and hand corrected browser fixtures to DevOps | Read-only product review and QA-owned fixtures now; test only frozen candidates for acceptance | Baseline failures preserved; joint contract edge cases agreed; independent packet and combined-candidate verdicts |
| CEO / BIZ-A and coordination | Approve contract scope after worker review; obtain named decisions for funding, terms, infrastructure, retention and handoff | No additional coding worker needed for these human decisions | Supported funding route or explicit blocked decision; each required approval has an owner and bounded next action |

Queued, not active: Dev 2 takes durable creative generation (remaining DEV-A)
after DEV-C acceptance, unless the CEO explicitly reassigns it. Dev takes DEV-D
after delivery/spend integration. DevOps takes the OPS-B restore/alert drill after
the CI provisioning slice, and may gather its read-only requirements meanwhile.
UI-01 and DOC-A remain visible follow-ups; no opportunistic cross-owner fixes.
PAY-A/B and DEV-E are parked with preserved evidence pending capacity/policy gates.
No extra worker is requested now; reassess only for a named independent packet
that can proceed without increasing shared-file contention.

### Bounded Acceptance and Exclusions

- DEV-B covers reviewed effective destination, exact intended children, generation
  fences, durable delivery operation, atomic capacity acquisition and verified
  pause/compensation/reconciliation. Preserve intentionally paused imported children.
  Test wrong tenant, changed review/budget/assets/link, simultaneous starts,
  provider-success/local-save-failure, process restart and failed compensation.
  Exclude checkout, provisioning, creative generation and live activation.
- DEV-C covers period-scoped provider collection, complete bounded pagination,
  durable continuation, freshness/invalid-currency handling and honest sweep
  outcomes. Test >1,000 records, busy-campaign crowding, partial page failure,
  timezone/week transitions, overlapping runs, externally activated campaigns,
  pause failure and local persistence failure. Exclude lead pagination, payment
  settlement and independent activation/reservation logic.
- DevOps owns CI/provisioning implementation, while QA owns test expectations and
  corrected fixtures. Use existing tools, not a second test framework. Node 24
  configuration alone is not a clean Linux/browser result. Production backup/key
  exports, public tunnels, alert registrations and paid services need approval.
- QA may correct synthetic fixtures and author tests in its reserved surfaces.
  Product failures go to the owning developer. Expected-failure baseline artifacts
  must not become skipped tests or inverted assertions in required passing CI.

## Single-Writer Register

Ownership is scoped to the listed packet, not permission to refactor the module.
Unlisted paths require an ownership decision before editing. Workers may inspect
any needed source without claiming it. Paths below include their packet-related
tests and documentation only as explicitly specified.

| Surface | Sole writer for this wave | Consumers / coordination rule |
| --- | --- | --- |
| Delivery service, activation review/status/create/preflight, campaign binding and worker code under `src/lib/campaign`; campaign status route | Dev | Dev 2 calls the agreed delivery/verified-pause interface; no duplicate provider mutation pipeline |
| `src/lib/campaign/spend.ts`, `spend-enforce.ts`; spend cron route; newly agreed spend collection/repository modules | Dev 2 | Exceptions to Dev's campaign ownership; exact new filenames must be included in contract acknowledgement |
| `src/lib/meta/client.ts`, `src/lib/types.ts`, `src/lib/supabase/queries.ts`, `src/lib/audit.ts`, trusted-write repository | Dev | Dev 2 sends required signatures/behavior; Dev supplies bounded shared changes first |
| `db/schema.sql`, migrations/preflight, `scripts/check-meta-connect-db.mjs` | Dev | Dev 2 specifies observation storage/invariants; Dev writes coordinated SQL/types. DevOps reviews order/locks but does not edit the same migration concurrently |
| Activation/create/refresh/trusted-write route tests and shared DB fixture contracts | Dev | QA supplies assertions/reviews; fixes remain with Dev |
| `tests/audit-spend-enforce.test.ts`, `meta-connect-w2-cron-binding.test.ts`, `spend-queries.test.ts`, new agreed collector tests | Dev 2 | Shared query implementation remains Dev-owned; test API changes require the contract handoff |
| `e2e/**`, independent QA report/reproducers and synthetic acceptance fixtures | QA | DevOps requests origin/server-isolation fixture changes; QA implements them before CI integration |
| CI, Playwright config, package/lock/runtime configuration, local QA/catalog/integration scripts and their tests, release/operations docs, `.gitignore` | DevOps | Developers request dependencies/config changes; no shared install or lockfile churn during another run |
| Operating brief, this board/decision log, roadmap priority and root worker instructions | CEO | Worker receipts propose status changes; coordinator applies them |
| `src/lib/llm/index.ts`, `providers/**`, needed LLM type adapters and existing `tests/llm*.test.ts` | Dev 2 for #27, after O-7 start conditions | Preserve facade/caller behavior; additional caller/config paths need a bounded request; package/lock writer remains DevOps |
| `src/lib/meta-connect-ui/use-campaign-list.ts`, campaign-list integration in `src/components/campaigns.tsx`, existing campaign-list component tests | Dev for #28, after O-7 start conditions | No delivery/mutation rewrite; request an exact path for any new query-provider boundary before editing it |
| Studio/image-generation modules, lead inbox/import, payment implementation | No new write reservation | Existing handoffs preserved; outside #27/#28 scope |

Each developer owns its own packet handoff document. Dev retains the existing
DB-A/DEV-A handoff for corrections; Dev 2 must not concurrently rewrite it. QA and
DevOps retain their own dated receipts. The remediation plan is a technical
reference, not a second live assignment board; route changes to it through CEO.

Cross-owner request: packet, exact paths/signature, required behavior, minimal
test and blocking consumer. CEO assigns the writer and a merge/review slot. The
writer returns the tested change before the consumer builds against it. Ownership
transfer needs explicit release and acknowledgement by both parties; silence or
an elapsed timeout never makes a path free.

### O-2 Ownership Reconciliation

For the four acknowledged sessions, the CEO confirms the existing register as
the forward-write boundary. Preserve earlier contributions; ownership is not
permission to revert or claim authorship of them.

- Dev's declared exclusion of spend-collector work and Dev 2's acceptance of the
  spend scope resolve the next-phase boundary: Dev 2 alone writes spend modules,
  cron and the three registered spend-test files. Dev routes DB-A compatibility
  corrections in those files through Dev 2, even if Dev authored the old change.
- The coordinator explicitly releases further writes to the instruction cases in
  `tests/spend-queries.test.ts` to Dev 2, and the shared query implementation to
  Dev. Preserve the F8 assertions and behavior. No new coordinator product edits.
- Dev 2 explicitly relinquished shared SQL/types/Meta client/queries/audit/trusted
  writes and the DB-A handoff to Dev. Dev retains the dirty activation-test work;
  preserve it when adopting QA's assertions.
- QA explicitly relinquished `.gitignore` to DevOps; preserve `/.qa-artifacts/`.
  Dev's declared tooling exclusion and DevOps' acceptance place the existing
  payment-launcher/tooling changes with DevOps. Preserve test-mode gates and
  existing package/lock changes; no new dependency install without a bounded need.
- QA alone writes `e2e/**` and its new handoff/fixture artifacts. Historical
  acceptance reports remain unchanged. DevOps requests fixture API changes rather
  than editing them, and remains the sole writer of CI/Playwright configuration.

These acknowledgements do not account for an unreported fifth session. If a
worker observes another active writer, stop only the overlapping edit, preserve
both versions and report the exact path. Continue independent drafting within
scope; dirty status alone is not a reason to block the whole packet indefinitely.

## CONTRACT-BC Gate

Status: **DRAFT / not accepted**. Dev owns the delivery half; Dev 2 owns the spend
half. Submit proposals in worker handoffs; CEO records one version here when
accepted. QA reviews executable decision cases; DevOps reviews achievable cadence
and recovery. Do not create two incompatible interpretations of the contract.

O-3 progress: [C-draft-2](qa/dev2-devc-contract-o1.md) is delivered, including a
review of B-1. The [Dev handoff](qa/db-a-dev-a-handoff-2026-09-26.md) now contains
B-2, which explicitly revises coverage arithmetic. The next review must compare
these latest versions, not approve agreement with superseded B-1. Liability
coverage, late-reporting reconciliation and exact shared API mappings remain
acceptance items; document checks do not establish runtime correctness.

Required agreement before dependent implementation:

| Topic | Required contract output / invariant |
| --- | --- |
| Identity | Business, campaign, account, connection generation, reviewed children, effective destination and review digest; ownership/binding checked on every mutation path |
| Money and period | Explicit currency and safe integer minor units at the shared boundary; conversion rules for existing rupee fields; account timezone and precise UTC interval boundaries. Weekly commitment, period spend, annual allocation and available cash are distinct |
| Exposure | One decision function and examples for incurred spend, outstanding reservations and uncertain liability without double-counting. Paused campaigns' already-incurred cost cannot disappear |
| Observation envelope | Agreed field names/types for period, provider source, observation/collection times, currency, completeness, validity, continuation and stale/unknown reason; older/out-of-order results cannot replace newer trusted state |
| Concurrency | Shared serialization key/revision; acquire/check reservations atomically and idempotently; define protection against concurrent refresh, pause, refund holds and second starts. Never hold a DB lock during a provider request |
| Uncertainty | Persist intent before mutation; checkpoint known effects; reconcile ambiguous results. Timeouts, stale observations and expired leases never by themselves free potentially spent capacity |
| Freshness and action | Required policy inputs, no silent production defaults. Unknown evidence blocks new managed starts; verified protective pause remains possible. Agree active-delivery pause/escalation policy and how failure stays visible |
| Integration API | Exact writer/reader interfaces, errors and permitted states for observation publication, activation decision, reservation, pause request/confirmation and reconciliation; identify single writer for every SQL/type/client change |
| Compatibility | Accepted DB-A foundation, incremental storage/grants, old-caller behavior, migration order and minimum rollback-compatible app; do not extend create-only operation identity naively |
| Tests | Both activation failures and both stale/missing failures, period boundary, partial/restarted scans, double-counting, concurrent observation/reservation changes and provider success followed by failed persistence |

The suggested five-minute cadence in the ops receipt is a proposal, not an
approved service promise. Test policy values may be explicit fixtures; production
values need achievable infrastructure and owner approval. No new paid managed
execution may be enabled while those choices are unresolved.

Contract acceptance record (CEO fills after review): version, Dev acknowledgement,
Dev 2 acknowledgement, QA case list, DevOps feasibility limits, concrete interfaces
and paths, outstanding owner decisions, permitted implementation phase. Any later
semantic change increments the version and reopens affected acceptance checks.

## Integration Queue and Evidence States

| Order | Candidate content | Exit condition |
| --- | --- | --- |
| I-0 | Preserve/reconstruct accepted B and compare current source; DevOps assembly, QA verification | Exact manifest and overlay identities; changed paths identified. DB-A/F5/F8 acceptance retained only where evidence still applies |
| I-1 | CONTRACT-BC plus minimum shared SQL/types/provider interfaces supplied by Dev | Contract accepted; Dev 2 can consume the same tested interfaces; migration compatibility reviewed |
| I-2 | DEV-B and DEV-C bounded implementations | Developer regressions pass separately, then QA challenges their combined failure/concurrency behavior |
| I-3 | Dependency-complete local candidate plus isolated Node 24/browser tooling | Clean candidate checks and independent browser/DB acceptance; explicit residual failures. Do not bundle unrelated payment/creative work |
| I-4 | Applicable operational/provider/commercial gates and approved promotion | Scoped authorization, required hosted checks, compatible schema/rollback, exact deployment and affected-workflow evidence |

This queue does not require one giant production release. CEO and DevOps may
select an independently useful, dependency-complete slice (including DB-A) for
separate review; local acceptance alone is never production approval.

Track work state as assigned / acknowledged / contract-blocked / implementing /
handoff-ready / under-QA / accepted-for-scope / blocked. Track these evidence fields
separately per candidate: implemented; developer-local; independent-local;
clean-Node-24-Linux; hosted-CI; provider-test; provider-live; deployed;
production-workflow-verified. Each field carries pass/fail/not-run/not-applicable,
source, receipt and date. They are not one percentage or a linear "done" badge.
Provider-test does not satisfy provider-live; deployed does not mean verified.

### Candidate Freeze

DevOps assembles; QA independently verifies. Use a clean approved commit where
available, or a reproducible source snapshot with base HEAD, ordered per-file
hashes and manifest digest. Include required untracked source, lockfiles, config,
SQL and tests; exclude all environment files, secrets and generated outputs.
Record QA fixture/network-guard overlays separately with hashes, plus runtime,
dependency-install method, database/service versions and migration checksums/order.

Never test the shared dirty source as a frozen release candidate. Preserve the
source reconstruction and sanitized evidence outside Playwright's cleanup tree.
Changes after freeze create a new candidate; report changed dependencies and rerun
affected checks plus required assembled gates. No automatic reuse of old green
checks. A worker may continue development in its separate workspace while QA tests
the frozen candidate. Creating a snapshot is not approval to commit or publish.

### Git Checkpoints: O-6

Status: **G-1/G-2 publication approved; execution pending**. Production promotion
is covered by O-6 standing authority only after the release gates pass. Other
batches still need exact coordinator scope and acceptance, not a bulk checkpoint.
DevOps remains
the sole executor. CEO has inspected the initial file scope, not staged, committed,
pushed or certified a new candidate. Actual completion requires commit, CI and,
for production, deployment/workflow evidence; permission is not proof of delivery.

| Order / batch | Candidate scope | Required before commit/push |
| --- | --- | --- |
| G-1 / F8 | Only `src/lib/supabase/queries.ts`, `tests/spend-queries.test.ts`, `tests/creative-generation-route.test.ts`: instruction-read failure and five regressions | Freeze those hunks; QA reviews exact candidate diff; test on current `origin/dev` in an isolated candidate, with touched lint/types and affected query/generation/assistant/planner suites; review secret scan and exact staged diff |
| G-2 / F5 | Only `src/components/studio.tsx`, `tests/studio.test.tsx`; return newly discovered dependencies for explicit coordinator scope review | Establish independence against G-1/current base; QA reviews exact diff; rerun Studio and isolated recovery checks; retain UI-01 and durable server-intent/quota limitations rather than claiming full DEV-A acceptance |
| G-3 / coordination and evidence | Root worker instructions, orchestration/operating docs and their necessary references; contract proposals remain clearly DRAFT | Public-repository privacy review; freeze worker-owned receipts with their writers; validate links against the published tree, not just the dirty workspace. Exclude private artifacts; do not publish docs claiming uncommitted files are available |
| Later / DB-A, payment test, infrastructure | Separate dependency-complete batches, not loose individual files | Dev/QA/DevOps return exact source, dependency and candidate checks; keep SQL with compatible callers/tests, payment routes with gates/SDK/config, and source tooling with tests/config. Local acceptance is not production approval |

Publication preparation rules:

1. DevOps checks its current execution before taking a bounded checkpoint slot;
  do not interrupt the source-copy/provisioning work or start a second release
  worker. Existing developers keep their assignments and isolated source identity.
2. After scoped authorization, fetch remote state and prepare an isolated candidate
  based on current `origin/dev`. The inspected local checkout was two commits
  behind its tracking ref; never pull/rebase/reset/stash the shared dirty tree to
  make publication easy. No branch deployment is presumed harmless.
3. Verify effective `dev` deployment policy before pushing. Stage explicit paths
  or reviewed hunks, never `git add .`. No environment files, private QA archives,
  provider proofs, generated output or unrelated worker edits in a commit.
4. Run checks on the actual assembled candidate using isolated configuration and
  the supported runtime. Previous B/local green checks are supporting evidence,
  not a substitute. Capture exact hashes at extraction and after validation.
5. Use focused commit messages and a normal fast-forward-only push to `dev`.
  If the remote advances, stop, reassemble and revalidate; never force-push.
  Return commit SHA(s), exact scope, local results and hosted CI for the pushed
  head. G-1's required hosted checks must pass before G-2 publication. Record how
  the shared checkout differs without changing it underneath active workers.
  Isolated publication does not itself remove shared dirty flags; reconcile only
  proven equivalent local changes in a coordinated cleanup, never a blanket reset.
6. Dev publication does not automatically promote to main. Use the separate O-6
  protected production path and exact candidate checks. Publishing migration
  source does not authorize applying it; provider/credential/financial gates remain.

Do not wait for the whole managed business to be launch-ready before versioning
independently useful code. Conversely, committing unfinished contracts or test-only
payment code does not make them accepted or eligible for production.

### Handoff Template

```text
Worker / packet / board revision / contract version:
Source: commit, or HEAD + manifest digest; reproducible artifact location:
Changed paths and ownership transfers:
Required migrations (order/checksums), config and dependencies:
Failure before -> required behavior -> result after:
Checks: exact command, runtime, environment identity, exit/result, evidence link:
Not run / failing / residual risks:
Blocker or decision needed, decision owner, next acceptance check:
Rollout / rollback compatibility; external actions taken (or none):
Resources held / released; next consumer:
```

## Shared Resources

O-2 approves the following logical reservations and local preparation requests.
Nothing has been created, started or availability-checked by the coordinator.
DevOps verifies actual paths, execution identities and service targets, then
records allocation/start/release in its receipt; CEO incorporates the next status
update here. Do not confuse a logical reservation with an operating-system lock.

| Resource / requested identity | Owner / use | O-2 status and activation condition |
| --- | --- | --- |
| `/tmp/adbrain-dev-b-o1` | Dev; source copy and activation unit regressions | Reserved for DevOps provisioning; verify absence/ownership first, otherwise choose a new unique suffix without overwriting |
| `/tmp/adbrain-dev2-devc-o1` | Dev 2; source copy and spend unit regressions | Reserved for DevOps provisioning from the same identified input as Dev; same no-overwrite rule |
| `/tmp/adbrain-devops-qa-a-o1-<unique>/` | DevOps; B reconstruction and infrastructure candidate | Approved for local preparation; record actual unique path and manifest before use |
| `.qa-artifacts/dev-b-o1/` | Dev; activation evidence | Reserved namespace, not created; no writes to QA's baseline archive |
| `.qa-artifacts/dev2-devc-o1/` | Dev 2; spend evidence | Reserved namespace, not created; validate ignore coverage and use immutable run subdirectories |
| `.qa-artifacts/devops-qa-a-o1/` | DevOps; assembly/provisioning evidence | Reserved namespace, not created; preserve prior payment and QA artifacts |
| `.qa-artifacts/qa-a-o1/` | QA; contract cases and preserved fixture/reproducer handoff | Reserved; may prepare now after checking ignore coverage and avoiding existing-file overwrite; no service allocation needed |
| Dedicated worker executions | DevOps allocates; Dev/Dev 2/QA each use their own | Requested, no execution IDs recorded. Never reuse a busy shared terminal; serialize resource-heavy runs |
| Synthetic `adbrain-ci-o1-<unique>`; app 4039, API 56321, DB 56322 | DevOps only; isolated integration | Conditional reservation, not running. Check listeners, project/container/volume identities, approved local target and isolation before startup; choose new ports on conflict, never evict an occupant |
| QA acceptance workspace and execution | QA; independent verification | Pending candidate handoff and DevOps allocation; not permission to mutate DevOps' running database |

DevOps has the first resource-heavy slot for clean provisioning/CI validation.
After reporting release, schedule the requested Dev and Dev 2 regression slots,
then QA's combined acceptance slot when a candidate exists. Short contract edits,
read-only review and artifact preparation need no heavy-run slot. A blocked heavy
run yields its slot explicitly; it must not idle-lock all four workers.

For every started resource record actual path/project/port/execution ID, source
manifest, owning worker, checkpoint, permitted mutations and teardown condition.
Never store secrets. No shared package install, branch change or Git publication
is authorized by allocating a source copy. Paid or remote resources still need
their own owner approval.

- Prefer separate workspaces from an agreed source. Do not switch/reset/stash the
  shared branch, copy dirty files wholesale or create/push branches without the
  applicable release procedure and authorization. A worktree does not isolate DBs,
  providers, environment files, package installations or ports by itself.
- Use unique verified synthetic projects and server identities. Never infer safety
  from localhost or a demo label; the default local environment targets production.
  Reusing a server requires owner permission and matching candidate/environment;
  frozen browser CI must not reuse an arbitrary existing server.
- Do not issue a new command into a terminal running another required command,
  stop another worker's process/VM/container, migrate its database, change shared
  credentials or delete its artifacts. Use an owned execution or wait for release.
- Reserve expensive local builds/browser/DB runs through DevOps to avoid memory
  contention. Parallel read-only reviews are fine; shared terminal execution is
  not an independent resource. CI isolation and server-side egress blocking remain
  mandatory, even when browser routes are intercepted.
- Clean only owned fixtures/services after capturing sanitized evidence. Stop
  temporary servers you start; no detached workers left behind. Suspended worker
  reservations remain held until explicitly reconciled, not reclaimed by guesswork.

O-4 allocation update: DevOps' saved assembly receipt supersedes the historical
reservation-only rows above. It reports Dev/Dev 2 source copies at their reserved
paths and QA at `/tmp/adbrain-devops-qa-a-o1-xvr7Uk/qa-candidate-b`; source only,
no dependencies or services. Preparation slot released; execution readiness still
requires verification. QA's hashed handoff is now available. Do not reconstruct
B again or claim these inputs are still awaiting delivery.
The QA receipt reports its former 3939/55321/55322 services removed; this is not a
fresh port-availability check. Never reuse its deleted temporary guard paths.

## Decision Log

Single log for cross-worker decisions. IDs remain stable; append a dated revision
and explicit supersession when a decision changes. Workers propose here through
the coordinator rather than making competing decisions in separate chats.

| ID / state | Decision and accountable owner | Evidence / next action |
| --- | --- | --- |
| O-01 / accepted | CEO assigns Dev to DEV-B and Dev 2 to DEV-C; durable creative generation queued | Supersedes three-worker queue and earlier creative-first suggestion; all four O-1 acknowledgements received via owner; O-2 next actions issued |
| O-02 / accepted | DB-A and F5/F8 accepted only for QA B local scope; full DEV-A open | Independent QA report above; DevOps/QA identify current candidate delta |
| O-03 / accepted | CONTRACT-BC must be jointly agreed before dependent implementation; one writer per shared file | Dev/Dev 2 submit exact interfaces and cases; CEO records accepted version |
| O-04 / accepted | DevOps is sole release executor; QA independent; CEO owns integration scope | Owner approval still separate for publication, deployment, migrations, credentials, resources and provider/financial mutations |
| O-05 / accepted, O-2 | Record four acknowledgements and reconcile forward-write ownership, including coordinator F8 tests and QA ignore-file release | Preserve prior work; concrete unreported conflicts block only the affected path; no acknowledgement-only repeat turn |
| O-06 / accepted, O-2 | Reserve requested local namespaces and delegate verified allocation to DevOps; QA artifact handoff and developer contract drafts proceed now | No resources started or ports verified by CEO; one B reconstruction, independent writable copies, serialized heavy runs |
| BIZ-01 / unresolved | Owner with Meta/gateway/bank: account-specific automatic funding and actual operator/agency authority | CEO obtains supported route, required consent and bounded proof proposal; no manual-top-up substitution |
| BIZ-02 / unresolved | Owner with accountant/gateway: annual service/tax/fee/refund/unused-fund terms | INR 10,000 total and 20/80 tax-inclusive Meta allocation remain selected; do not ask workers to invent treatment |
| OPS-01 / unresolved | Owner: commercial infrastructure budget, RPO/RTO, monitoring destination and named primary/backup responders | DevOps supplies costed options and measurable drill; Hobby/backup limitations in ops receipt remain launch gates; nothing purchased |
| DATA-01 / unresolved | Owner with legal/accounting input: deletion, media and financial retention | CEO obtains policy; no broad data cleanup or unapproved production export |
| LEAD-01 / unresolved | Owner and intended recipient: consent-safe access, qualification and response window | No automated outreach, personal-data sharing or test submission authorized by orchestration |
| PAY-01 / held | Test capture evidence remains separate from refund/webhook/settlement/funding | Preserve existing uncertain orders; new provider tests need appropriate scoped authorization |

Blocked workers report the precise dependency immediately. CEO routes a bounded
shared change or authorizes a genuinely independent next task; the worker may
prepare tests/fixtures or review within its reserved scope meanwhile. Do not add
features merely to appear busy. If a packet is reassigned, preserve its handoff,
release reservations explicitly and update the board before the next worker edits.

Managed paid launch remains blocked until financial authority, reviewed delivery,
fresh complete spend, operational recovery, funding and commercial gates pass
with the required evidence and separate owner approval.