# AdBrain Worker Orchestration

Revision O-11, September 26, 2026. Maintainer: coordinator.
Goal: ship useful customer workflows quickly, with checks proportional to risk.
This file is the current dispatch. GitHub issues own scope and acceptance; PRs
own review and CI evidence. Historical dispatches do not grant or block work.

## Current Dispatch

Owner reports only DevOps active; Dev, Dev 2 and QA idle. Do not interrupt or
restart ongoing work. Read this section and your issue, then act within scope.

| Worker | Current outcome | Next useful action |
| --- | --- | --- |
| Dev 2 | Finish #27 handoff, then [#34 lead import](https://github.com/vanshulgoyal101/adbrain/issues/34) | Update/publish the existing repaired candidate with corrected deployment config first. Then implement complete resumable import on a new isolated issue branch; do not wait for shared-checkout cleanup |
| DevOps | Ship the completed code-only release first | Owner selected code-only promotion while migrations remain pending. Finish the existing SDK/query integration, required checks and protected production release. Exclude DB-A-dependent callers until their schema rollout is separately approved; report deployed SHA and deferred batches |
| Dev | Finish #28 handoff, then [#35 follow-up inbox](https://github.com/vanshulgoyal101/adbrain/issues/35) | Update/publish the reviewed candidate with corrected deployment config first. Then implement paginated saved-lead listing and persistent follow-up on its own issue branch |
| QA | Review backlog first, then the enquiry milestone | Prioritize DevOps' actual backlog candidates; review #34/#35 as code arrives using existing lead regressions and one combined owner workflow. No generic audit or repeat of completed reviews |
| Coordinator | Priorities and genuine cross-owner decisions | The three reconciliation content decisions are resolved. Owner explicitly chose code-only release first; no DB-A migration approval was granted |

Current release decision: code-only first. Production DB-A migrations and their
dependent application changes remain pending; do not infer approval from the
general request to ship all completed features. Test-only payments stay disabled.
The SDK/query lock merge may legitimately change @standard-schema/spec 1.1.0 from
dev-only to runtime because @ai-sdk/provider-utils requires it. Preserve its
version/resolved artifact/integrity; an exact match to the old dev flag is not a
release gate. The focused integration finding is recorded on PR #31. Reuse
unchanged feature evidence and run required checks on the assembled candidate.

Reconciliation handoff: current [payment plan](PAYMENTS-PLAN.md) preserves the
INR 10,000 annual-total allocation and the unformalized future Solaride arrangement;
the [roadmap](ROADMAP.md) retains both current merchant identity and the shipped
identity-only release boundary. The two shipped identity assertions are restored
in [the payment panel test](../tests/payment-funding-panel.test.tsx); its focused
"shows planned economics" case passes. Preserve these resolved versions and all
other pending hunks during Git reconciliation; overlapping text may still require
manual merge resolution. Bring forward the published G-2 repair rather than
overwriting it with the older shared Studio copy. No files are staged or committed
by this content repair; DevOps owns that next operation and the final counts.

## Next Delivery

[Milestone 2: Enquiries to follow-up](https://github.com/vanshulgoyal101/adbrain/milestone/2)
is prepared, not implemented. #34 (Dev 2) owns complete/resumable provider import;
#35 (Dev) owns paginated listing, saved workflow status/note and inbox interaction.
GitHub issues contain the agreed small API and acceptance criteria; do not draft
another competing contract or duplicate their checklists here. Dev owns combined
db/schema.sql integration; Dev 2 supplies its sync-specific migration/type additions.
Import must preserve owner-managed follow-up values. Final end-to-end acceptance
requires both changes; each can be built with synthetic fixtures independently.
Finish or explicitly hand off the prior PR before starting a new active packet.
No new queue/CRM framework, live outreach/ad spending or production migration
permission is included. DevOps' existing-backlog priority is unchanged.

### Publication Policy Mismatch

[PR #32](https://github.com/vanshulgoyal101/adbrain/pull/32) is merged at
`174d3585ed3357dbd10131b2ed68434763589d32`; the config repair commit is `1a04cd2`.
DevOps' [hosted verification](qa/ops-environment-2026-09-26.md#o-11-preview-policy-hold)
records no deployment for the repair branch/commit, successful intended main
deployment, and the existing previews' production-variable absence and SSO barrier.
All four exact-head CI runs passed. Coordinator accepts that evidence; the blanket
project-level publication hold is replaced by the candidate prerequisite below.

An older candidate remains held until its writer incorporates the corrected
config, verifies branch matching and confirms no conflicting configuration.
Then its publication may proceed under existing authority and exact-head CI,
without another approval or replay of the platform investigation. Stop if actual
deployment behavior contradicts the verified policy. Do not push unchanged #27
or #28 source still containing the old single-star rule.

[Issue #33](https://github.com/vanshulgoyal101/adbrain/issues/33) stays open for
tracking the older-branch updates; link their corrected SHAs before closing it.
Reusing the project's verified evidence does not prove retrospective absence of
exposure or certify other projects. No credential/data/provider changes or broad
preview cleanup are authorized by this decision. Local coding and review continue.

## Priority Filter

Start work only if it completes a core customer workflow, clears an active release
blocker, or removes a demonstrated recurring customer/operating cost. A severe
money, privacy, security or data-loss risk is high value even if uncommon.

1. Finish and integrate the current implementations; no new library migration wave.
2. Deliver one usable campaign-to-enquiry journey: reviewed ads, bounded delivery,
   honest spend/status, complete enquiry import and practical follow-up.
3. Complete payment-to-funding only against a verified provider route and approved
   commercial rules. Investigate that feasibility alongside the customer journey.
4. Expand after actual usage shows what customers need next.

Use maintained libraries to deliver these outcomes, not as an end in themselves.
Defer optional polish, speculative frameworks, large-account generalization and
exhaustive rare-state automation. Big product milestones still use focused commits.
SDK adoption does not close the parked delivery/spend safety work or CONTRACT-BC.

## Decision Rights

- An assigned issue authorizes necessary implementation, related helpers/tests,
  issue-local dependency selection/install, local commits and a focused PR.
  No acknowledgement-only turn, per-file naming permission or allocation ceremony.
- Reuse the existing issue worktree. If none exists, the assigned owner can create
  a unique local feature worktree from dev after checking existing allocations.
  Do not wait for shared-checkout cleanup or copy production environment files.
- Developers may publish their own feature branch after the publication hold is
  lifted and its deployment policy is verified. No extra DevOps approval is needed.
- Discuss a necessary shared interface directly with its owning worker in the
  issue/PR. Involve the coordinator only for a conflicting owner, material scope,
  product/policy decision or unavailable external authority. Choose one interface
  and implement it; do not create parallel naming proposals.
- DevOps is the single writer for integration into dev/main and production.
  Feature editing, independent installs and small tests need no global test slot.
  Coordinate only real CPU/memory contention, shared services and release writes.
- An idle worker is acceptable. Do not create work or documentation to fill capacity.

## Single-Writer Register

| Surface | Owner |
| --- | --- |
| #27 issue code and dependency files in `/tmp/adbrain-issue-27-o9` | Dev 2 |
| #28 issue code and dependency files in `/tmp/adbrain-issue-28-o9` | Dev |
| #34 Meta lead/form paging, sync route/modules, sync-specific migration/types and existing related tests on its new issue branch | Dev 2; no campaign mutation changes |
| #35 inbox/page/CSS, lead list/update routes, lead-row fields, follow-up migration/tests and combined schema integration on its new issue branch | Dev; no edits to Dev 2's sync implementation |
| G-2 candidate `/tmp/adbrain-o8-ePtVWk/g2`; shared Git/index/lockfile integration; CI/hosting and release mechanics | DevOps |
| Independent review, QA fixtures and e2e acceptance assertions | QA; product repairs stay with the author |
| Current plan, root worker instructions and priority conflicts | Coordinator |

Do not edit a peer's worktree, kill its process, switch the shared branch, reset
unpublished work or remove retained artifacts. Duplicate O-8 allocations and old
B copies are retained references, not additional implementation branches. If an
owner already uses another recorded copy, keep that work and identify it once.
Broader product changes need a scoped issue; this plan is not blanket write access.

## Testing Budget

| Change | Smallest sufficient verification |
| --- | --- |
| Documentation/status | Relevant format/link check only; no application suite |
| Ordinary behavior | Test the changed workflow and likely failure; applicable lint/types. Use existing suites |
| Shared logic or dependencies | Affected consumer tests and compatibility/audit checks for the changed inputs |
| Auth, tenant boundaries, money, paid execution or schema | Targeted security/financial invariants and relevant real integration/schema checks; mocks cannot prove external effects |
| Release | Current required CI on the assembled candidate plus a relevant deployed-workflow smoke and compatible rollback |

During development run focused checks, not the whole platform after every edit.
Full local suites/builds are needed only where required or where equivalent CI
evidence cannot cover the relevant source, dependencies, configuration and runtime.
Keep required GitHub checks; do not weaken assertions, skip failures or bypass
protection to speed a release. Test counts are not a productivity target.

Reuse evidence when those inputs still match. Do not repeat installs, audits,
browser journeys or whole-tree hash inventories just for a second handoff. Use
commit plus diff for routine work; manifests are for genuinely uncommitted snapshots.
When something fails, fix that slice and rerun the discriminating check before
expanding. Do not build a new harness when an existing test can express the case.

## Review and Release

1. Author delivers a useful slice, focused tests and a commit/PR. QA reviews while
   CI runs; it need not wait for the final test report to inspect the diff.
2. Fix blocking correctness, financial or security findings. Non-blocking polish
   becomes backlog, not a release hold. Review later corrections as deltas only.
3. QA may approve the exact scope conditional on green required checks. DevOps
   verifies them and proceeds without another QA session to transcribe success.
   Changed source or an actual failure reopens only the affected review.
4. After the current publication hold is resolved, DevOps batches related ready
   commits and uses the protected [release process](RELEASING.md). Never merge
   unfinished work merely to make one large release or clear a local counter.
5. Verify the deployed SHA and affected workflow, then stop. No broad production
   audit for every ordinary release; no outage injection or paid test by default.

Standing owner approval covers reviewed, tested software releases through protected
PRs. Production migrations/data repair, credentials, paid services, preview
enablement, live payments and Meta spending remain separately scoped. No repeated
owner permission request for an already-authorized operation; no expansion of it.
Reuse known-good CI/tooling; optimize actual slow steps separately, not mid-release.

## File-Based Handoffs

GitHub is the durable task/review record. A normal handoff is a short update with
issue/PR, source commit, result, concrete blocker and next owner. Link existing
evidence instead of copying it. Longer reports are for genuinely complex incidents.
Do not write a test solely to certify a status paragraph or append a new protocol
version for every update. Update the current dispatch in place.

Existing receipts: [Dev](qa/db-a-dev-a-handoff-2026-09-26.md),
[Dev 2](qa/dev2-devc-contract-o1.md), [QA](qa/qa-a-o1-handoff.md),
[DevOps](qa/ops-environment-2026-09-26.md). Read only the latest relevant section.
Before declaring a missing handoff, check its actual availability once. Then do
unblocked work or name the exact missing decision; no polling or repeated status loop.
Disclose AI-assisted reviews; using one GitHub account is not a second human approval.

The owner can say "sync workers" instead of relaying transcripts. Independent
idle chats still need a resume; this file is not an automatic dispatcher. Do not
interrupt active work just to adopt this shorter plan.

## Historical Reference

[The previous board](ORCHESTRATION-HISTORY-2026-09-26.md) preserves old dispatches,
manifests, reservations and contract details. It is reference only, not current
permission or a work queue. No full-history rereading is required.

### O-10 Fast Path

Legacy link retained for worker receipts: current rules are above. Historical
G-2 author evidence is in the [archived fast path](ORCHESTRATION-HISTORY-2026-09-26.md#o-10-fast-path).