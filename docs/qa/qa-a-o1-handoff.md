# QA-A O-2 Handoff

Worker: QA. Packet: QA-A acceptance slice. Board: **O-2**, September 26, 2026.
CONTRACT-BC: **DRAFT / not accepted**. QA case proposal: QA-BC-cases-1.
The O-1 filename is retained as directed by the coordinator. This is a new
artifact/contract receipt, not a change to historical candidate acceptance.

## O-11 Deployment Policy Draft Review

QA accepts the configuration logic of the uncommitted one-line
[vercel.json](../../vercel.json#L5) change: `"*": false` -> `"**": false`.
Reviewed file SHA-256:
`d7b9d2664c7cf6574ac2ed1e624644f477d3a00095bbba7e1da1ef5d9c650554`.
No deployment/release approval or resolution of the publication hold is implied.

[Official Vercel rules](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled)
specify minimatch syntax, default-enabled unmatched branches and any-true
precedence. One focused local check filled the missing matcher evidence: eight
cases passed, including both affected feature branches, nested slash branches,
release branches, dev and main. Main remains enabled; all seven other cases are
disabled. JSON comparison confirmed all other configuration is unchanged.
This is a local matcher/documented-rule check, not hosted enforcement evidence.

DevOps handoff still needs an exact candidate/PR, credible effective suppression
and preview-isolation evidence, and confirmation that every source intended for
publication contains the correction. No such new evidence was in the saved
DevOps receipt or allocated evidence directory at this review. Configuration
alone does not close the hold; do not initiate a deployment to prove it here.

No resolved reconciliation candidate was delivered. Its review remains pending:
retain the current operator/future Solaride distinction, INR 10,000 annual total
and 20:80 allocation, both shipped identity assertions, unpublished additions
and released fixes. The unresolved shared checkout is not an accepted batch.
No G-1/G-2 or #27/#28 code review or completed test suite was repeated. Next
owner: DevOps for the concrete policy/isolation and reconciliation handoffs.

## Issue 27 Repair Review: ff4615f

QA **accepts the repair-only delta** `da4f209` ->
`ff4615f950183538efe8ee7acc4cbb0e81c585e2`; the truncation-accounting P1 is
closed for this local candidate. No additional findings.
[Published review](https://github.com/vanshulgoyal101/adbrain/pull/29#issuecomment-5846446067)
distinguishes the unchanged published `da4f209` head from the repaired commit.

Reviewed usage retention, single-flight producer accounting, terminal/no-fallback
rejection, single planner/interview callbacks and creative failure receipts that
retain earlier attempts. Existing route consumers submit those receipts once.
Reused [Dev2's 167-test evidence](dev2-devc-contract-o1.md#issue-27-accounting-repair)
and lint/types; reviewed the new one-call/one-record and task regressions without
replaying tests or re-reviewing the migration. Durable database delivery and live
providers were not independently exercised. Required assembled-candidate checks
and the publication/isolation hold remain. Next owner: DevOps for integration
only after that hold is resolved; no additional author correction requested.

## Issue 28 Status Fix Review: bab47d0

QA **accepts the incremental scope** `853d197` ->
`bab47d0ac46527cc1a012cfd4d8cd0b53b7ab0c1` for
[PR #31](https://github.com/vanshulgoyal101/adbrain/pull/31).
[Published scoped approval](https://github.com/vanshulgoyal101/adbrain/pull/31#issuecomment-5846368751)
is explicitly AI-assisted and conditional on required exact-head checks.
Only the status setter and one neighboring regression changed (two files,
17 additions/one deletion). The earlier P3 status-during-debounce observation is
closed; prior `853d197` acceptance and its limits remain unchanged.

The setter settles the currently rendered trimmed search alongside the status
update, enabling the correct query immediately. The pending timer writes the
same settled value; later typing still cleans up that timer. Functional status
updates remain supported. The added regression asserts no fetch while typing,
then one immediate fetch with both current search and selected status, followed
by the matching results. No new blocker identified in this delta.

Reused [final author evidence](../../.qa-artifacts/dev-b-o1/issue-28-handoff-final.json):
78 passing tests, no failures/skips, touched lint/types and offline browser
fixtures at 1440/390/320. No author suite or browser replay; no broader migration
re-review. Exact-head required CI and dependency integration remain gates, and
the publication/isolation hold remains in force; this is not release approval.

Next review: Dev2's #27 accounting repair. Readiness check found its worktree
clean at `da4f209`, with no repair commit or updated delivery receipt yet.
The PR #29 P1 remains open until a reproducible repaired candidate is delivered.
No product/peer files, services, deployment settings or branches changed by QA.

## Issue 27 Review: da4f209

QA reviewed PR #29 at `da4f209b4edffe29a1277fbfe96b6677e35d305f`;
GitHub head matched immediately before publication. **Changes requested**:
P1 Gemini MAX_TOKENS responses throw before usage extraction, bypassing facade
and task accounting; the terminal LLMError carries no usage for failure receipts.
This changes the prior Gemini adapter's nonempty truncation behavior.

[Published AI-assisted review](https://github.com/vanshulgoyal101/adbrain/pull/29#issuecomment-5846340140)
contains the source reference and required repair: account known failure usage
exactly once without introducing another paid attempt. It explicitly identifies
the shared repository-owner account rather than claiming a second human review.

Independent focused check: Node 24.21.0, actual adapter, one mocked HTTP-200
MAX_TOKENS response, prompt=8/completion=2/total=17. One transport call returned a
non-retryable LLMError with usage undefined; the known-usage retention assertion
failed with exit 1. No network, real credentials, provider or database operation.
Task failure accounting was traced in source, not exercised against persistence.

Reused Dev2's 220 passing tests plus one existing paid-evaluation skip and its
71-test LLM subset, lint/typecheck/audit evidence; no suite replay. No additional
blocker identified in direct provider mappings, cancellation, SDK retry disabling,
facade fallback, or structured-output repair behavior. Required CI and live
provider schema verification remain separate. The reported unexpected preview
deployment remains a DevOps isolation concern, not resolved or authorized here.
Next owner: Dev2 for the accounting fix and focused regression; QA for re-review.
No candidate product files, branch, release settings or shared resources changed.

## Delivered

1. Seven selected QA regression cases with setup, including the six required
   historical failures and passing F8 protection. Unrelated test bodies were
   removed with the TypeScript parser; selected assertions remain byte-identical.
2. Corrected A browser overlays and the B-tested draft overlay, with explicit
   phase labels, provenance hashes, network guard and Studio/UI-01 evidence.
3. Twenty-five structured Given/When/Then decision vectors for CONTRACT-BC,
   plus concrete reconciliation requests for Dev B-1 and Dev 2 C-draft-1.

No product, shared tests, e2e working files, CI/configuration, historical report
or board was edited. No package installation, source reconstruction, application
test run, server, database or provider operation was performed in this checkpoint.

## Source and Integrity

Current source discovery: dirty dev, HEAD
`9da5b07b00e54fb552796cbcf01cc5fc7c2f02e7`, two commits behind origin/dev.
New work in other workers' documents is preserved, not included in B acceptance.

Baseline B remains the same HEAD plus source manifest
`9533d1d0e81069291536e6b97c020334eb1ddbf48858d31181a0181e0b5e4d13`.
The [original archive](../../.qa-artifacts/independent-qa-2026-09-26.tar.gz) SHA-256 is
`e6e16fead01622d0bcb440526c2a999cf253ee51e16539e4acb85cb0276b263a`.
It was unchanged before/after extraction. DevOps alone reconstructs the source;
QA extracted individual archived entries, not another complete source candidate.

Successful immutable output:
[artifact manifest](../../.qa-artifacts/qa-a-o1/handoff-YTrGx9/manifest.json).
Manifest SHA-256:
`642bc8093c74d4c0689eff9b1516a65467e894854ed44dc70c7ada517d9fcce1`.
The manifest lists 19 output files, archive-entry hashes for transformed inputs,
individual assertion hashes and historical outcome mappings. Untransformed files
match their archive entries. The separate
[decision vectors](../../.qa-artifacts/qa-a-o1/contract-cases-o2.json) are newly authored
draft specifications, not preserved B source or implementation test results.
Decision-vector SHA-256:
`2e8b26ea48e5c49b45e268262381e6096d3daa86f269a0a7f21e2041516377ce`.

Reproducible extraction tool:
[prepare-handoff.mjs](../../.qa-artifacts/qa-a-o1/prepare-handoff.mjs).
Run from the repository with `node .qa-artifacts/qa-a-o1/prepare-handoff.mjs`.
It uses installed TypeScript, creates a fresh output directory, refuses overwrite,
checks Git ignore coverage and validates archived results. No environment loading.
Only the successful manifest above is handed off; failed preparation attempts are
not acceptance artifacts. All generated files remain outside Playwright cleanup.

## Regression Handoff

These expected results belong to the historical B run. This checkpoint checked
preservation and archived result identity, not fresh product behavior.

| Consumer | Artifact | Expected on B | Adoption requirement |
| --- | --- | --- | --- |
| Dev | [Activation](../../.qa-artifacts/qa-a-o1/handoff-YTrGx9/reproducers/qa-activation-recheck.test.ts) | Two failures: concurrent capacity and successful provider call followed by failed save/retry | Preserve trusted-write mock and existing dirty baseline; use allocated isolated copy |
| Dev 2 | [Spend](../../.qa-artifacts/qa-a-o1/handoff-YTrGx9/reproducers/qa-cron-recheck.test.ts) | Two failures, generated by one stale/missing it.each block | Do not replace missing evidence with fabricated zero or remove either parameter |
| Dev, queued DEV-D | [Pagination](../../.qa-artifacts/qa-a-o1/handoff-YTrGx9/reproducers/qa-meta-recheck.test.ts) | Two failures: form/lead present only on page two | Preserve now; no active lead implementation assignment |
| Dev 2, F8 protection | [Instruction read](../../.qa-artifacts/qa-a-o1/handoff-YTrGx9/reproducers/qa-instructions-recheck.test.ts) | One pass: instruction read failure rejects | Preserve accepted behavior while changing shared spend tests |

Place selected files under tests only in the allocated isolated candidate. Run
the chosen filename with the existing Vitest setup and `-t 'QA ' --maxWorkers=1`,
using scrubbed placeholder configuration and paid evaluation disabled. The filter
also selects enclosing QA suite names. Dev and Dev 2 should adopt the assertions
in their existing owned suites before permanent integration, not add duplicate
complete suites. No skip, inverted expectation or required-CI expected-failure
wrapper is an acceptable fix. Exact B HTTP codes remain baseline checks; future
adapters may change with the accepted contract, while safety assertions persist.

Separate checks, not part of the six:

- F1/F7: [in-memory client result](../../.qa-artifacts/qa-a-o1/handoff-YTrGx9/preserved/initial/qa-meta-client.json)
  records ACTIVE parent, PAUSED ad set/ad, and raw example.com forwarded. The
  original inline probe code was not retained in the archive. Do not claim a
  newly executable F1/F7 test was recovered. BC-05/06 specify the permanent tests
  Dev must implement in its isolated owned suite; no live provider proof exists.
- UI-01: [Studio result](../../.qa-artifacts/qa-a-o1/handoff-YTrGx9/preserved/final/qa-studio-results.json)
  and [320px screenshot](../../.qa-artifacts/qa-a-o1/handoff-YTrGx9/preserved/final/qa-studio/recovered-320.png)
  preserve Generate label width 49px versus content 54px. Page-width-only checks
  miss it. The preserved Studio probe records overflow but does not fail on it;
  the future required assertion is each label.scrollWidth <= label.clientWidth.
  Do not confuse its recovery pass with layout acceptance. UI repair stays queued.

## Browser Handoff to DevOps

Use [A corrected overlays](../../.qa-artifacts/qa-a-o1/handoff-YTrGx9/browser/initial/workspace.spec.ts)
for workspace, campaign recovery, Meta recovery and draft-connect. Use the
[B draft lifecycle overlay](../../.qa-artifacts/qa-a-o1/handoff-YTrGx9/browser/final/draft-lifecycle.spec.ts)
for the post-hardening authenticated draft path. All include the retained
[qa-fixtures.ts](../../.qa-artifacts/qa-a-o1/handoff-YTrGx9/browser/initial/qa-fixtures.ts)
import. These are overlays, not automatically accepted against newly assembled code.

Preserved corrections: explicit campaign-list/lead-form GET fixtures; planner
targeting including rationale; exact guided-goal textbox selection; 320px variants;
no duplicate-generation or unexpected write allowances; versioned stale-delete
409 assertions. Clear only owned malformed synthetic probe rows before UI runs.

Integration requirements still open:

1. Current overlays hardcode localhost:3939 and localhost cookie scope. O-2's
   proposed 4039 origin requires one DevOps-supplied verified origin/auth fixture
   contract. QA will edit e2e after that bounded request; DevOps owns Playwright
   configuration and must not patch e2e concurrently.
2. Test credentials must come from the verified synthetic project, in process;
   never inherit root environment files. Container/project identity, server
   candidate identity and permitted local Auth/REST/Storage endpoints must match.
3. The [historical server guard](../../.qa-artifacts/qa-a-o1/handoff-YTrGx9/preserved/final/qa-network-guard.cjs)
   covers fetch and HTTP(S), not all possible socket transports or local services.
   The browser helper permits loopback hosts generally; individual fixtures are
   stricter. Tighten to the verified origins for CI. Browser interception alone
   does not isolate server-side SDK calls. Do not reuse deleted guard paths.
4. B Studio recovery's retained probe queries an old local project/port and derives
   synthetic credentials. It is reference input, not a launcher for the reserved
   CI project. Convert through the agreed fixture contract before execution.
5. Dedicated server only, no arbitrary reuse. Node 24/Linux clean install and real
   local Auth/REST/Storage checks belong to the allocated DevOps candidate run.
   Retain sanitized evidence outside test-results; teardown only owned resources.

## CONTRACT-BC Review

Reviewed [Dev B-1](db-a-dev-a-handoff-2026-09-26.md#o-2-dev-b-delivery-and-reservation-proposal)
and [Dev 2 C-draft-1](dev2-devc-contract-o1.md). **Changes required before QA supports
contract acceptance.** Neither proposal was modified by QA. Common ground:
business-wide serialization, safe integer paise, Monday account-local periods,
durable intents/checkpoints, no I/O while holding DB locks, unknown evidence blocks
new managed starts, and uncertain liability survives leases, pause and rollover.

| Request | Concrete gap / required agreement | Discriminating vectors |
| --- | --- | --- |
| QA-BC-R1 | B uses max(S,C)+U with C as total envelope; C uses observed + remaining proven-uncovered reservation + uncertainty + reserve. These agree only with defined coverage/provenance assumptions. State explicitly when max is permitted; missing coverage must not imply overlap. Select one implementation and specify reserve exactly once | BC-08/09/13: 30000 incurred + 140000 envelope is 140000 only with proven coverage; otherwise unknown. Exact cap passes arithmetic; one paise over rejects |
| QA-BC-R2 | B's campaign sum needs C's complete account total and unmapped/deleted residual reconciliation. Decide exclusive account attribution and treatment of known residual versus unknown uncertainty; never count account total and campaign sums twice | BC-12/22: account 70000, mapped 50000, residual 20000; shared/unverified account or inconsistent totals cannot authorize |
| QA-BC-R3 | Publish one exact envelope/type location. B requests collectionStartedAt/completedAt, complete inventory and observed budgets/status; C uses requestStartedAt/responseReceivedAt/publishedAt and campaignSpend without budgets/status. Identify inventory linkage and oldest-page age needed to verify the stated policy | BC-15/16/19: recent publication cannot freshen an old page; complete spend without complete inventory is insufficient |
| QA-BC-R4 | Pause API differs: B uses requestKey and proposed operation states; C uses idempotencyKey and pending/confirmed/unknown/failed. Agree result mapping and a read/reconcile interface. Both need a safe target for external campaigns with no local campaignId; null mapping is not permission to fabricate one | BC-02/07/22/23: original authorized target only; uncertain pause remains visible; no ACTIVE retry merely to fix a mirror |
| QA-BC-R5 | Specify how absent providerDataThrough interacts with approved reporting-lag policy. A recent fetch proves neither spend finality nor maximum provider lag. Define active-unknown action, collection-age boundary, reserve, and escalation inputs without production defaults | BC-14/15/23/24: explicit test values only; unknown evidence remains unknown even after protective pause |
| QA-BC-R6 | Align adapter outcome vocabulary with sweep success. C proposes 503/ok=false for partial and B 202 for pending delivery operations: these can coexist, but a nested accepted operation must not turn the sweep green | BC-17/23/24: no completed heartbeat or paused-success ID until required confirmation is durably recorded |

The [25 vectors](../../.qa-artifacts/qa-a-o1/contract-cases-o2.json) are structured
executable specifications: given state, ordered/interleaved actions, observable
assertions and owner. They are not a replacement model that could pass independently
of the real implementation. Bind them to the accepted API and actual DB/route
adapters after CEO acceptance. Synthetic policy values, including five minutes,
do not approve production cadence or promise provider spend limits.

Additional positive/negative gates include wrong-tenant silence, review changes,
exact intended children, canonical destinations, replay/conflict keys, concurrent
cap/binding/publication changes, paused/deleted incurred spend, downward corrections,
1105 scopes with a busy campaign, partial/restarted pages, cursor bounds, empty
responses, timezone/DST transitions and strict decimal/overflow rejection.

## Validation and Next Consumer

Preparation check: archive gzip integrity, unchanged archive SHA-256, exact
selected assertion text, TypeScript parse checks, historical result mapping and
19 artifact hashes. This is not a seven-test rerun. The extraction check exposed
parameterized-case counting and suite-name selection; both were corrected before
the successful output was created. No assertions were changed to make it pass.

Case/document checks passed under Node 22.12.0: 25 unique IDs with required
Given/When/Then fields, finite safe numeric fixtures, both account-local Monday
period examples (including a 169-hour DST week), 18 local links and formatting.
All 19 artifact hashes and the original archive hash were rechecked successfully.
Editor diagnostics found no errors in the handoff, vectors or extraction tool. Product execution,
full fixture type/lint integration, Node 24/Linux/browser/DB/provider checks are
not claimed by this receipt. No runtime package/config changes or migrations.

Resources: QA uses only its reserved .qa-artifacts/qa-a-o1 namespace and this owned
receipt. No service, port, VM, database, background process or heavy slot held.
DevOps retains the first heavy slot and sole B reconstruction. Prior dirty
contributions and the baseline archive are preserved; no new overlapping writer
was observed on QA's output paths.

Next: Dev and Dev 2 consume the hashed assertions after DevOps allocates their
same-input writable copies and execution slots. They resolve R1-R6 jointly; CEO
records the accepted contract. DevOps requests the exact origin/auth fixture API
from QA before CI integration. QA then binds the cases and independently tests
the frozen combined candidate. This handoff unblocks artifact consumption and
contract review now; it does not authorize dependent product implementation.

## O-4 Review Checkpoint

Version: QA-O4-review-1. Board: O-4. CONTRACT-BC: **DRAFT / not accepted**.
Checkpoint: **complete for pinned contract review, source identity and partial
F-1 fixture delivery**. Validation passed; full browser/contract acceptance remains
blocked as specified below. Earlier O-2 evidence is unchanged.
This section is the saved handoff for Dev, Dev 2, DevOps and CEO. No owner relay
is needed, and the central board remains coordinator-owned.

### Inputs and Scope

Read the current shared-workspace receipts, not copies inside historical B:

| Input | Reviewed version | SHA-256 |
| --- | --- | --- |
| Delivery handoff linked above | B-3 O-4 reconciliation, consumed after B-2 review | `ab12ee72a734fcf56f682eebad8fc2f354be8a25c24cf28e024fe1b270ee03a0` |
| Spend handoff linked above | C-draft-3 O-4 reconciliation, consumed after C-draft-2 review | `a28126078419f7c1493eb099e394f7f7bb526f098a01e55db9b039d22cd57b3c` |
| Operations receipt | O-2 assembly plus newly delivered O-4 F-1 request | `2f4adf3aa6733ef7fa86fa36ef0a004e90546bcb3ffff994838ff5de7d62010c` |
| Orchestration board | O-4 file-based protocol | `a5402c33b8af2c2b6868eb6556b613a4420d699b2f9e221ceccf5992aebe0a51` |

Current HEAD remains `9da5b07b00e54fb552796cbcf01cc5fc7c2f02e7`, dirty dev.
No e2e dirty paths were reported at discovery. No new overlapping QA writer was
observed. This review does not accept current application source or peer test claims.

### R1-R6 Disposition

| Request | O-4 disposition | Concrete remaining output and owner |
| --- | --- | --- |
| R1 exposure/coverage | QA supports B-3/C-draft-3's S+C-K+U, reserve once, explicit coverage provenance, individual/aggregate credit bounds, and UNKNOWN without proof. The original formula conflict is resolved | Agree the supported proof source and exact unique evidence-slice/storage constraint contract before implementing credit. Actual provider coverage and concurrency guarantees remain untested. BC-26/27/28 |
| R2 account residuals | Both now agree on account residual once, validation including unmapped rows, retained old-account liability and exclusive initial account attribution | CEO must accept that bounded scope. Preserve distinct incurred residual and uncertain-effect provenance. No remaining arithmetic disagreement. BC-12/22 |
| R3 observation envelope | Required inventory/budget/oldest-page fields are agreed; both derive publication from durable pages and read capacity coherently | Naming has crossed: B-3 adopts requestStartedAt/responseReceivedAt while C-draft-3 adopts collectionStartedAt/collectionCompletedAt. Publication uses collectionId versus runId plus scope/period; evidence wrapper kept versus removed. CEO/Dev must select one exact interface, not have each worker rename toward an older draft. BC-15/19/31 |
| R4 pause command/results | Both now allow missing observation and project cancelled_before_dispatch to failed, with read-only recovery lookup and no provider-only mutation target | observationId versus triggeringObservationId, generic DeliveryOperationView/null versus PauseResult, and tagged-result formats still differ. Preserve C's stored PAUSED discriminator: B's generic confirmed view must not certify an activation as a pause. BC-22/29/30/32 |
| R5 freshness/policy | Both now explicitly treat null/unverified watermark as UNKNOWN for automatic admission, accept inclusive oldest-page age and retain separate finality/hold-release proof | CEO/owner must decide whether available provider evidence supports this strict scope or authorize a separately evidenced alternative. Policy values and measured infrastructure feasibility remain external gates. Unknown-reason spellings need R3 alignment. BC-14/15/23/24/31 |
| R6 sweep vs operation | QA supports both drafts' rule: nested pending/unknown delivery or a 200 read of pending state cannot produce a successful sweep; stale evidence stays unknown after pause | Consolidate errors: AUTHORITY_UNAVAILABLE is 403 in B-3 versus 503 in C-draft-3. Distinguish denied authority from unavailable authority; agree LEASE_LOST/reconciliation and SQLSTATE/domain-result mappings. BC-17/23/24/30/32 |

QA supports these reconciled principles, **not full CONTRACT-BC acceptance**.
Do not continue reporting all six original objections as unchanged; the formula,
residual arithmetic and required envelope content have materially advanced.
Remaining blockers are the precise differences above, accepted coverage-proof
storage/source rules and explicit enablement policy/authority, followed by
implementation acceptance. B-3/C-draft-3 arrived during this checkpoint and were
read directly; no claim is made about edits later than their recorded hashes.

### Added Decision Vectors

[QA-BC-cases-2 supplement](../../.qa-artifacts/qa-a-o1/contract-cases-o4.json)
adds BC-26 through BC-32 without modifying the 25 O-2 vectors or their checksum:

- Per-campaign exposure 300000 versus the unsafe aggregate maximum 280000.
- Earlier interval spend cannot cover a new future authorization: 170000, not 140000.
- One 30000 observation cannot credit two 30000 reservation claims.
- Missing observation must not prevent an otherwise authorized protective pause.
- Every operation state needs a projection; cancelled-before-dispatch cannot stay
  pending indefinitely, reads cannot dispatch, and confirmation time stays null
  before durable verification.
- Explicit test-only age threshold: 300000ms passes the age check, 300001ms fails.
- A confirmed ACTIVE operation cannot populate confirmed protective-pause IDs;
   the stored operation kind/desired status must prove PAUSED.

These are unbound specifications. Checking their arithmetic does not exercise
concurrency, storage constraints, routes or providers. Dev/Dev 2 consume them
after agreeing the shared boundary; the six original failing assertions remain.

### DevOps Consumption and Request

The [operations receipt](ops-environment-2026-09-26.md#o-2-source-assembly-and-resource-handoff)
now supplies an allocated QA source path:
`/tmp/adbrain-devops-qa-a-o1-xvr7Uk/qa-candidate-b`.
QA independently verified all 529 source paths and hashes against B, without
reconstruction or source mutation. The in-progress node_modules directory was
excluded from this source-only comparison; no dependency readiness is inferred.
The initial receipt was source-only. During this checkpoint, the input hash check
caught a new DevOps F-1 origin/auth request; QA read and consumed it below instead
of retaining the now-stale fixture-contract blocker. Dependency preparation is
reported in progress, not accepted runtime readiness.

DevOps can consume the O-2 QA manifest and corrected overlays already linked
above. Its older statement that QA's artifact handoff is absent is superseded by
this file; no additional owner relay is required. For the next fixture edit,
publish in the operations receipt:

1. Verified candidate/workspace identity and exact application origin/baseURL.
2. Verified local Supabase/project origins and browser/server network allowlists;
   proposed port numbers alone are insufficient environment authority.
3. The in-process synthetic auth handoff and cookie scope tied to that origin,
   including input names or a typed fixture object, without credential values.
4. Startup/readiness/teardown ownership, no-reuse behavior, run-specific artifact
   destination and dependency/runtime execution readiness.

QA owns e2e/helper edits; DevOps owns configuration/launcher changes. F-1 now
supplies these boundaries and is consumed in the overlay below. No package
install, server/DB activation or heavy slot is requested by this review.

### F-1 Overlay Delivery

Status: **partial fixture implementation; not browser acceptance**.
Inputs: DevOps F-1 request, unchanged O-2 artifact manifest and the preserved
Studio probe. Output is a separate QA-owned overlay, not edits to the baseline
archive, shared e2e files or allocated application source.

[F-1 overlay manifest](../../.qa-artifacts/qa-a-o1/f1-overlay/manifest.json), five files,
SHA-256 `8d2191a7c6b88627dd7c595a651cadeac58af5d3b49166bfde00bca0cdfc7247`.
Apply only the listed e2e paths to an allocated candidate after DevOps confirms
readiness; do not treat the missing two draft specs as an approved passing subset.

- [qa-fixtures.ts](../../.qa-artifacts/qa-a-o1/f1-overlay/e2e/qa-fixtures.ts)
   exports the requested qaAppOrigin, qaApiOrigin, qaBusinessId,
   verifyQaServerIdentity and createQaAuthCookies. Additional createQaAuthSession
   returns userId with cookies for recovery-key scoping; guardQaRoute protects
   per-test handlers so a later route.continue cannot bypass the origin gate.
- [Workspace](../../.qa-artifacts/qa-a-o1/f1-overlay/e2e/workspace.spec.ts),
   [campaign recovery](../../.qa-artifacts/qa-a-o1/f1-overlay/e2e/campaign-recovery.spec.ts)
   and [Meta recovery](../../.qa-artifacts/qa-a-o1/f1-overlay/e2e/meta-recovery.spec.ts)
   now consume F-1 origins/auth/business identity. All 70 non-auth workflow assertion
   statements are byte-identical to their preserved inputs. Auth rejection moved
   into the tested shared helper. No provider-response assertion was relaxed.
- [Studio recovery](../../.qa-artifacts/qa-a-o1/f1-overlay/e2e/studio-recovery.spec.ts)
   supplies three reload/recovery tests with one POST/two GETs/same identity and
   three separate individual-label bounds tests at 1440/390/320. The UI-01 test is
   expected to expose B's 320px overflow, not turn recovery success into layout PASS.
- [Conversion provenance](../../.qa-artifacts/qa-a-o1/f1-overlay/provenance.json)
   records the three preserved source hashes, output hashes and 44/10/16 unchanged
   workflow assertions. The [conversion script](../../.qa-artifacts/qa-a-o1/prepare-f1-overlay.mjs)
   refuses overwrites; it is not a command to rerun over the already delivered files.

The helper rejects missing/remote/path/credential-bearing origins, different app
and site origins, invalid run identity, or mismatched identity JSON before login.
Auth uses only the exact local API /auth/v1 boundary and refuses redirects.
Browser API paths are limited to Auth/REST/Storage; arbitrary loopback ports and
foreign WebSockets are rejected. App-origin ws is allowed for local HMR. Service
workers are blocked; no data/blob exemption is currently needed by these tests.
Cookie names/chunks, path, expiry, HttpOnly, Secure and SameSite are retained with
the app-derived domain. No auth state or credential values are written to artifacts.

Focused fixture check:
`node --import tsx --test .qa-artifacts/qa-a-o1/f1-helper.test.ts`.
Six tests passed using injected synthetic transport, not real Auth: invalid input
rejection; every identity-field mismatch before login; foreign origins/WS;
Auth path/redirect rejection; successful chunked cookie creation; later route
handler bypass prevention. Scoped TypeScript and ESLint checks also passed using
installed dependencies. The archived recovery import was resolved read-only to
the workspace for this typecheck; no application source acceptance is implied.

### F-1 Remaining Fixture Request

Request QA-F1-SETUP-1 to DevOps, limited to draft-connect and draft-lifecycle:
their preserved setup uses SUPABASE_SERVICE_ROLE_KEY to upsert fixed creative IDs,
insert a guided draft and delete fixture rows. F-1 provides no service-role input
and says DevOps provisions synthetic rows. QA will not silently add that credential
or retain those privileged mutations in the new overlay.

Supply a run-scoped seed manifest with creative IDs for the connection journey and
saved-draft cases, exact brand/creative preconditions, and the guided draft's
id/version/owner or an agreed owner-authenticated setup path. The named UI fixtures
are "Connection journey fixture" and "Saved draft fixture". Assign per-case reset
and cleanup to a verified DevOps setup/teardown hook, or request an explicit bounded
QA fixture API. These values must belong to QA_BUSINESS_ID and have no provider
bindings. Missing-observation/draft testing must not require invented identities.

Until that response, both historical specs and the stale-delete 409 assertion
remain preserved and **not converted/executed under F-1**. Do not silently skip
them or claim the full browser gate passes. DevOps may inspect the delivered
subset now, but complete fixture integration awaits this specific setup contract
and provisioned dependency/server/database readiness. All runtime browser, real
Auth/REST/Storage, Node 24/Linux and server-side egress checks remain unrun by QA.

### O-4 Validation Receipt

[Read-only checkpoint evidence](../../.qa-artifacts/qa-a-o1/review-o4-PQJD74/validation.json)
records Node 22.12.0, all 529 source hashes, 32 unique decision vectors, their
structure/arithmetic checks and 27 document links before the completion links
were added. All four peer input hashes matched at the start and end of the
successful check; changedReviewInputs is empty. Earlier input-drift failures
triggered consumption of F-1 and B-3/C-draft-3, not acceptance of stale versions.

O-4 supplement SHA-256:
`74ac3093e22c9063804dcbc14c7e2954b00ca5cc14bc1ce6094698d8ddaf1ca3`.
The original 25-case O-2 file and source archive are not changed. The F-1 helper's
six synthetic tests passed again after integration. Focused overlay type/lint
checks passed; no UI screenshot, stale-delete runtime result or live login was
generated in this checkpoint. All seven new decision vectors still require
binding to the accepted product contract and execution on a frozen candidate.

### Resources and Next Consumer

QA retains its allocated source copy for verification and its existing artifact
namespace; no source overlay is applied in this checkpoint. No server, database,
VM, port, background execution or heavy-run slot is held. Do not delete the copy
until QA explicitly releases it. Short validation commands terminate normally.

Dev/Dev 2: return consolidated R1-R6 mappings in your existing receipts; preserve
both old and added decision cases. DevOps: consume the delivered fixture package
and return QA-F1-SETUP-1 plus execution readiness. CEO: read this receipt
at sync, record remaining decisions and the accepted version only after review.
QA will consume saved updates at its next checkpoint without polling or requiring
the owner to copy responses between chats.

## O-6 D-1 Review and Release Intake

Worker: QA / QA-A independent acceptance. Board: O-6.
Checkpoint: **complete for D-1 canonical interface review**.
CONTRACT-BC remains **DRAFT / not accepted by the coordinator**. No product,
browser, release-candidate or production acceptance is added by this checkpoint.

### D-1 Decision

**QA accepts D-1's five canonical choices for contract consolidation.** No
blocking inconsistency was found in this delta against the earlier R1-R6 and
BC-26..32 requirements. This supersedes the O-4 receipt's five naming/result/error
conflicts; do not continue listing them as unresolved.

Reviewed the completed [D-1 delta](db-a-dev-a-handoff-2026-09-26.md#o-5-canonical-integration-delta-d-1)
at source-document SHA-256
`e17bd091a1708b3e7088e23e34d136a14d599aa268287bf8783fe5576536f8be`.
Shared source discovery remained dirty dev at
`9da5b07b00e54fb552796cbcf01cc5fc7c2f02e7`; this is not a release candidate.
The exact [reviewed delta](../../.qa-artifacts/qa-a-o1/review-o6-d1-eZkZoF/reviewed-d1.md)
was retained with SHA-256
`cdd0be04e8437cee820b24f8f0443eb581038ee712a8e9ef7a3e99001269dbf1`.

| Choice | Independent QA result |
| --- | --- |
| Timestamp names | Accept collectionStartedAt/collectionCompletedAt, earliest/final semantics, oldestResponseReceivedAt and non-renewing publication/retry. No alternate wire names |
| Publication arguments | Accept actor plus scope/period/runId/leaseToken/expectedCapacityRevision, with supplied fields checked against the authorized stored run. Exact replay can return unchanged but cannot advance the pointer or freshness; new publication requires current lease/revision |
| Capacity read | Accept one CapacityReadResult snapshot and value.evidence only after ok=true. Removing the wrapper avoids two independently assembled decision inputs |
| Pause/read result | Accept PAUSED-only PauseResult for the protective request and discriminated DeliveryOperationResult for general reads/reconciliation. Nullable triggeringObservationId supports missing-evidence pause. Stored desiredStatus and both state fields plus durable confirmedAt are required before counting a pause |
| Errors and HTTP | Accept explicit AUTHORITY_DENIED versus AUTHORITY_UNAVAILABLE, hidden-target 404, storage versus missing distinction, tagged lease/revision/domain results and contextual SQLSTATE handling. Nested 200/202 never supplies sweep success by itself |

The later [Dev 2 O-6 agreement](dev2-devc-contract-o1.md#o-6-d-1-agreement-and-regression-preparation)
was read directly during this checkpoint. It explicitly agrees with D-1 without
correction, but still labels its checkpoint in progress. CEO should consume its
completed receipt before recording final joint acceptance; earlier O-5 claims
that D-1/runtime inputs are missing are superseded by delivered files.

### Independent Checks

[Validation receipt](../../.qa-artifacts/qa-a-o1/review-o6-d1-eZkZoF/validation.json),
[reviewed type block](../../.qa-artifacts/qa-a-o1/review-o6-d1-eZkZoF/reviewed-types.ts)
and [reproduction check](../../.qa-artifacts/qa-a-o1/review-d1.mjs) are retained in
QA's namespace. All checks passed on **Node 24.21.0 / local macOS**:

- Five canonical mapping rows and their required safety statements.
- Eight compiler probes: valid PAUSED result, rejection of ACTIVE as PauseResult,
  general ACTIVE result, required desiredStatus, typed authority failure, no
  failure carrying a fake success value, no null operation success, and nullable
  triggering observation on a protective command.
- Five published pause examples, including confirmed ACTIVE, missing durable time,
  pending pause and contradictory raw/coarse states rejected as confirmation.
- Nine retained exposure examples with valid coverage bounds, unknown coverage,
  reserve-once arithmetic and admission outcomes.
- The reviewed source document hash matched before and after validation.

These are **contract/type consistency checks**, not executed product regressions.
The compiler probe uses opaque context for scope, unknown-reason and capacity DTO
references; it does not validate those schemas. TypeScript DTO assignability alone
does not reject every inconsistent raw/coarse/timestamp combination. The shared
runtime validator and consumers must enforce the full pause predicate and typed
error semantics against real route/SQL results. No library/domain implementation
was substituted for the future production decision function.

### Remaining Contract Gates

1. CEO records the accepted CONTRACT-BC version and permitted implementation scope
   after the completed Dev 2 agreement. QA's scoped D-1 approval is not that record.
2. Dev supplies the exact coverage-credit storage/uniqueness/provenance contract
   and supported proof adapter; Dev 2 consumes the same boundary. Duplicate credit,
   interval coverage, lease/revision races and restart behavior remain product/SQL
   acceptance cases, not passed merely because their examples are coherent.
3. Strict null/unproven watermark and coverage handling may still block every
   managed start with current provider evidence. CEO/owner must settle supported
   evidence and policy feasibility; no fabricated watermark, implicit reserve,
   live provider action or default five-minute promise is authorized.

### G-1 and G-2 Intake

O-6's standing software publication/promotion authority is recognized. QA will
not repeat an owner-approval blocker for G-1/G-2 or take over DevOps' execution
lane. Production data/schema, credentials, infrastructure purchases, live payments
and Meta spending remain separately gated. No such operation was performed here.

The saved [Ops receipt](ops-environment-2026-09-26.md#o-4-completed-local-readiness)
delivers Node 24/macOS source/dependency readiness and the frozen unit guard.
Readiness is no longer missing; QA did not install or modify those trees. Dev then
Dev 2 own their serialized regression slots; QA did not occupy either slot or
run the six baseline assertions redundantly on the shared checkout.

**QA-G1-REVIEW-1 to DevOps:** supply the frozen G-1 candidate/worktree identity,
base SHA from current origin/dev, exact candidate tree/manifest or commit, and
the candidate diff for the three approved paths. Include isolated check receipts
and execution-slot release when available. A staged diff from a moving shared
checkout without an identified candidate is not sufficient for independent
acceptance. Do not include unrelated trusted-write/DB/payment hunks simply because
they currently occupy the same query/test files.

G-1 scope is instruction-read failure plus its five regressions in queries,
spend-queries tests and creative-generation-route tests. QA will check intended
error propagation, legitimate empty-instruction behavior, no paid calls after
read failure, exact scope and dependency completeness. DevOps retains required
lint/types/affected suites, secret review and exact-SHA hosted gates.

G-2 follows green exact-head G-1 CI, with only Studio and its tests unless the
coordinator approves a discovered dependency. QA will review that separate frozen
diff and recovery evidence; UI-01 and durable server-intent/quota limitations remain
explicit. Prior B-local F5 acceptance is not automatic acceptance of the release
subset on a different base.

At the latest saved Ops checkpoint read here, no frozen G-1/G-2 candidate diff
or QA-F1-SETUP-1 seed/reset response was present. These are the precise remaining
inputs for those tasks, not missing publication permission or missing runtime
delivery. The partial F-1 overlay and two protected draft specs remain as recorded
above. No speculative service-role credential or unapproved fixture bypass added.

### Resources and Next Consumer

Only this owned receipt and QA's D-1 check/review artifacts changed. Application,
shared tests/e2e, CI/configuration, peer receipts and central board are untouched.
QA retains its allocated copy/artifacts; no overlay applied to the candidate,
dependency writes, server, database, port, VM, background process or heavy slot.
The short Node 24 compiler/document check terminated normally.

CEO consumes the scoped D-1 decision and completed peer agreements. DevOps supplies
QA-G1-REVIEW-1 and QA-F1-SETUP-1 in its existing receipt. Dev/Dev 2 proceed with
their allocated baseline regressions and report actual failures without weakening
assertions. QA resumes exact-candidate review or remaining fixture conversion
when the corresponding file-based input arrives; no polling or owner relay needed.

## O-6 G-1 Independent Code Review

Worker: QA / independent G-1 review, board O-6 release dispatch.
Checkpoint: **complete; ACCEPT FOR SCOPE. No blocking findings.**
DevOps may proceed with candidate-required checks and the authorized protected
release path. This is the requested independent code-review decision, **not yet
runtime, hosted-CI or production acceptance**. No additional owner permission,
CONTRACT-BC decision, baseline spend/activation fix or fixture conversion is a
dependency of this approval.

The prior missing-G-1-candidate request is satisfied by
[DevOps' frozen handoff](ops-environment-2026-09-26.md#o-6-g-1-frozen-review-candidate).
S-1 fixture setup is also delivered but queued outside this release review.
The newer coordinator dispatch grants G-1 the next unoccupied heavy slot; the
earlier serialized-slot wording in this receipt is historical, not a QA hold.

### Approved Identity

| Item | Reviewed value |
| --- | --- |
| Base | `2d94788ec2499b6ec7b9652d8b5fb2f0b898dea5` |
| Worktree | `/tmp/adbrain-devops-g1-o6-ywKKhr/candidate` |
| Source manifest | `910fc4b0e57d6c7de44d686fb2b72095b298c996d119ecc9bce93efde57ff334` |
| Exact diff SHA-256 | `de031df87ca155b3fc72fe804eb52fdf703c0f1d0f4f79a3129dc7bd1ac4782d` |
| Input candidate.json SHA-256 | `068d5da96040686953548bf152cce639f051d34beadecf9e4bb059aae138b23f` |
| Changed scope | Exactly queries.ts, spend-queries.test.ts and creative-generation-route.test.ts; 37 insertions, one deletion, five new cases |

Only those frozen bytes are approved. A source/base change requires identity
comparison and renewed affected review/checks. A later commit containing the
same tree can be mapped to this review; a matching branch name alone cannot.
No schema, package, environment, deployment configuration, Studio or unrelated
trusted-write/payment change is bundled into this candidate.

### Review Findings

No correctness, confidentiality, tenant-scope or dependency-completeness blocker
was found in the three-file diff and the directly affected callers reviewed.

- [getAdInstructions](../../src/lib/supabase/queries.ts#L246) checks the returned
   database error before returning data. The fixed message excludes private DB
   details; null or partial data plus an error cannot masquerade as an empty or
   usable result. The existing request-scoped client, business_id filter and order
   are unchanged. This review does not certify deployed RLS independently.
- getActiveInstructionsText propagates failure without a fallback. Successful
   empty instructions, active-only filtering, formatting and the existing length
   bound remain unchanged. No new API, schema or deployment dependency is introduced.
- [Generation](../../src/app/api/creatives/generate/route.ts#L173) and
   [regeneration](../../src/app/api/creatives/[id]/regenerate/route.ts#L95) await
   instructions inside existing try/catch boundaries before their paid generator
   calls. Their failure responses are generic 502s. Parallel context reads can
   still finish after rejection; approval means no paid generation from this path,
   not zero requests or zero bookkeeping of any kind.
- [Assistant](../../src/app/api/creatives/assistant/route.ts#L53) and
   [planner](../../src/app/api/campaigns/plan/route.ts#L115) likewise read instructions
   before their LLM calls inside existing error handling. The planner may already
   have performed a lead-form read; G-1 is not a claim of zero Meta reads.
- [Brand](../../src/app/(app)/brand/page.tsx#L17) propagates an instruction-read
   failure rather than rendering false empty guidance. That error-state behavior
   is an intentional availability tradeoff, not a successful empty-state promise.
- The five added cases cover both helper rejections with tenant-filter assertions,
   successful empty results, and both generation-route early exits with private
   message suppression. Existing test setup resets the affected mock state.

File links above are navigation aids in the shared checkout; reviewed evidence is
the frozen candidate, not any concurrent edits at those links.

### Independent Evidence

[QA validation receipt](../../.qa-artifacts/qa-a-o1/review-o6-g1-uoyu8T/validation.json),
[retained exact diff](../../.qa-artifacts/qa-a-o1/review-o6-g1-uoyu8T/review.diff) and
[reproduction check](../../.qa-artifacts/qa-a-o1/review-g1.mjs) are retained.
Node **24.21.0 / macOS** checks passed:

- All 504 manifest file hashes and the exact tracked path set, excluding only the
   declared .env.example entry; manifest and review-diff hashes; exact live diff
   against the reviewed base and whitespace. Rechecked before/after the probes.
- Eight synthetic checks of the exact AST-extracted query helpers: both helpers
   reject null/partial data with an error and retain the business filter; both
   retain successful empty results; active formatting/filtering stays intact; the
   exact base reproduces error-as-empty while the candidate rejects it.

No application modules, environment files, real client, DB, provider or server were
loaded. Extracted-helper probes are independent focused evidence, **not execution
of the full query/route suites**. DevOps owns those candidate runs and the heavy
slot. QA has not claimed their future results or historical B results as G-1 tests.

Residual coverage limits, not code-review blockers: the new route cases use a
mocked instruction helper; runtime query-to-route integration and the Brand error
UI were not independently exercised here. Assistant/planner failure handling was
source-reviewed; their affected suites remain part of candidate validation.

### Release Acceptance Handoff

DevOps is the next consumer. The independent code-review gate is satisfied for
the identity above. Continue the already-authorized G-1 flow; do not wait for D-2,
spend/activation baselines, G-2 or S-1 fixture conversion.

As candidate results arrive, QA will bind acceptance to the exact source manifest
and resulting commit, checking commands, selected suites, runtime/environment,
counts, exit codes and logs. Required evidence includes touched lint/types,
query/generation/assistant/planner suites, the isolated candidate's applicable
release checks and secret scan, then exact-head hosted required checks. Setup
failures, skipped assertions and a different source tree do not establish a pass.
Any required regression failure returns a concrete finding to DevOps; no waiver
is implied by this code-review approval.

Protected production promotion still needs the dependency-complete main-based
candidate, current required PR checks, compatible code rollback, exact Vercel SHA
and affected-workflow verification. A code-only rollback has no G-1 migration,
but reverting it restores the old instruction-error fallback. Production checks
must not induce a DB outage, run paid generation, mutate Meta or use unrelated
customer data merely to reproduce a synthetic failure case.

Only QA's receipt and ignored review artifacts changed. No candidate/shared
application edits, peer receipt changes, dependency installation, Git publication,
server, port, database, VM or heavy slot acquired. Short probes completed normally;
DevOps' candidate/resources remain untouched and retained for its release work.

## O-8 Release Evidence and Review Intake

QA / independent backlog and issue-PR review, board O-8.
**G-1 completed evidence accepted for its reviewed scope; no new findings.**
The earlier pending-runtime/hosted language is superseded by the
[completed release handoff](ops-environment-2026-09-26.md#o-6-g-1-production-release).
G-1 is shipped, not a task to repeat. No application tests, manifest-wide source
rechecks, build, deployment or production requests were rerun by this checkpoint.

### G-1 Evidence Consumed

The [final release receipt](../../.qa-artifacts/devops-qa-a-o1/g1-o6-CMzc2X/release-receipt.json),
SHA-256 `69dfdd25f51f2156d886e7abf205f50123e30fc58fc9f967e938e17b2b297267`,
binds the already-reviewed manifest/diff to candidate commit
`a36eeec0d9c2b4f32799b1107f7ee8665eb9e176`, protected PR #26 and production merge
`a7445f565586a2c4b484036b3bc12b01af28c7ea`. Its tested/merged tree is
`053458331b9716bbb5bcf7782006051133ed223b`.

- Retained local Node 24/macOS evidence: 108 affected tests passed; final CI-parity
   coverage run passed 1723 tests with one skipped, plus lint/types, audit, build,
   secret scan and fresh/upgrade PostgreSQL checks. The earlier guard-incompatible
   full-suite attempt is not the passing evidence; no failed assertions were waived.
- Hosted evidence: build/secrets passed on dev run 36239442256 and PR run
   36239700899 at the candidate commit, then main run 36239886796 and dev-sync run
   36240317228 at the merge. Hosted Linux/Node 22 and local Node 24/macOS results
   remain distinct; neither is silently relabeled as the other environment.
- DevOps' production receipt: exact-merge deployment
   `dpl_HWNBcCLv2udbE6j3S4ojhkm9L4kD` READY on the canonical alias; authenticated
   Brand guidance visible, invalid authenticated lookup 400, anonymous generation
   401, request IDs present. Temporary browser focus emulation was restored.

QA accepts this evidence package against its prior independent source review.
Production observations are attributed to DevOps, not independently replayed by
QA. Paid generation, production DB-failure injection, live Meta behavior and
unrelated financial/delivery work remain outside this acceptance. No G-1-specific
review hold remains, and its completed evidence is reusable for unchanged inputs.

### Current Review Queue

At this checkpoint, the saved Ops handoff ends with S-1, with no frozen G-2 or
later backlog candidate. GitHub's repository-wide open-PR query returned zero
results, including no implementation PR for #27 or #28. There is no new diff to
approve or actionable code finding to manufacture. This is a delivered-input
boundary, not a request for more owner permission or a block on implementation.

Next review priority is G-2, then the dependency-complete backlog batches and
issue-linked implementation PRs as delivered. Reviews bind to the exact base/head
and changed hunks; reuse existing evidence for identical inputs and run only
affected discriminating checks when a new risk or actual failure requires one.
GitHub remains the scope/acceptance source for #27/#28, not a duplicated local
checklist. Same-account PR feedback will disclose AI-assisted review rather than
claiming a second human approval. CI and deployed-workflow evidence stay separate.

No D-2/CONTRACT-BC or S-1 fixture work was opened as a prerequisite. DevOps retains
shared Git reconciliation, package/lock integration and release execution. Only
QA's receipt changed; no shared source, index, branch, worktree allocation,
dependency, service or heavy slot was modified or acquired. QA's receipt write
ends at this checkpoint; no ongoing writer is held during DevOps reconciliation.

## O-9 G-2 Independent Review

QA / G2-QA-REVIEW-O8-1, following O-9 G-2 QA Dispatch.
**CHANGES REQUESTED: one P1 request-identity finding.** Review complete for the
frozen two-file candidate; scoped approval is withheld until this defect is fixed.
No dependency on G-1 reruns, unrelated reconciliation, #27/#28 or contract work.

Reviewed `/tmp/adbrain-o8-ePtVWk/g2`, branch `release/o8-g2-eptvwk`, against base
`a7445f565586a2c4b484036b3bc12b01af28c7ea`. Exact patch SHA-256:
`edd3bbbd593bcb51e6a58f87120fb402656a7d3c283ffd177b5bda841ad05410`.
Only [Studio](../../src/components/studio.tsx) and
[its tests](../../tests/studio.test.tsx) are in scope. Source links navigate the
shared checkout; this decision refers to the frozen patch, not later edits there.

### P1: Late Completion Deletes a Newer Pending Identity

In [clearIntent](../../src/components/studio.tsx#L134), cleanup unconditionally
removes the business-wide generation key. It does not check whether storage still
contains the operation being completed. Both POST completion and successful GET
recovery can invoke this cleanup after another mounted tab advances the key.

Reproduced sequence, without simultaneous new-request claims:

1. Tab A persists identity A and sends its POST; the response is delayed.
2. Tab B restores A and confirms its saved result through GET. B clears A normally.
3. B starts a new generation, persists identity B and sends its POST.
4. A's original successful response arrives. Its clearIntent deletes B's storage
   entry even though B's request is still in flight.

Observed storage after step 4: **null**, expected generation B. On a subsequent
reload there is no identity with which to recover B; the new component can submit
another generation. This defeats the central recovery/duplicate-spend protection.
It is distinct from the already-deferred simultaneous cross-tab admission problem:
the new operation starts only after A was confirmed, then stale cleanup loses it.

Required repair: make cleanup conditional on the persisted generation identity
still matching the captured intent being completed, and preserve newer pending
state. Apply this rule to every rejection/completion/recovery cleanup path. Retain
fail-closed handling when storage cannot be read or updated. Add the late-A/new-B
regression to the existing Studio suite; a simple double-submit test is not enough.
This repair must not claim atomic cross-tab admission or server-side once-only
generation, which remain outside this packet.

[Runnable QA reproducer](../../.qa-artifacts/qa-a-o1/g2-late-result.test.mjs) and
[recorded observation](../../.qa-artifacts/qa-a-o1/g2-late-result-3CrsOF/observation.json)
are retained. Node 24.21.0/macOS: **one focused check FAIL, exit 1**, asserting B
must survive A's completion. B was still in flight when its identity became null.
The probe executes the exact AST-extracted generate handler and schema with two
synthetic component contexts and shared synthetic storage. It verifies the frozen
patch digest before execution. This is a narrow handler reproduction, not a real
browser, full React lifecycle or provider execution. No candidate file was edited.

### Requested Behavior Review

| Area | Result |
| --- | --- |
| Request identity | Generated UUID/count are persisted before POST and sent together; schema validates restored values. P1 blocks ownership-safe cleanup |
| Lost response / reload | Restored intent takes the GET-only path with the same generationId/count. Unknown status retains the intent. P1 can erase another request's recoverable identity |
| Duplicate submissions | Synchronous ref prevents repeated submits in the same mounted instance; pre-existing stored intent causes recovery instead of POST. P1 bypasses this protection after identity loss; simultaneous cross-tab claiming remains deferred |
| Partial results | GET partial results remain visible with pending identity retained; deduplication by creative ID prevents repeated cards. A completed POST with saved creatives/failures exposes the partial outcome and clears its intent, subject to P1 |
| Blocked storage | Read/parse/write failures before submission return without POST, and the finally block releases the local submit guard. Removal failure retains uncertainty rather than intentionally starting a second POST; identity-aware cleanup must preserve this behavior |

Existing server GET reports completion from saved-count versus expected-count,
not a durable terminal job record. Lost responses with permanently partial or
zero saved results can therefore remain pending indefinitely. Retain that known
server-intent limitation and UI-01; neither is claimed fixed or used to postpone
the concrete client identity repair above.

### Evidence and Handoff

Consumed [DevOps' focused results](../../.qa-artifacts/devops-o8/reconcile-2gWa2A/g2-checks.json):
Studio suite, touched lint and typecheck all exit 0 on Node 24.21.0. Those results
are retained, not rerun. They do not cover the new failing cleanup sequence.
Historical B recovery evidence and G-1's completed release remain unchanged.

No open PR was returned by the repository-wide GitHub query at this checkpoint;
there is no actual G-2 PR on which to duplicate the finding yet. DevOps consumes
this receipt, routes the bounded Studio repair to its writer and returns a new
frozen diff with the regression result. QA rechecks the changed cleanup and
affected behavior only, then records review on the actual PR when available.

Only QA's reproducer/evidence and this receipt changed. No candidate/shared
application mutation, install, full-suite replay, browser/server/DB, paid/provider
request, Git publication or heavy slot. The short isolated probe finished; no
resource is held and unrelated reconciliation/implementation remains unblocked.

## O-10 G-2 Cleanup Re-review

**ACCEPT FOR SCOPE; P1 closed for the repaired candidate. No new blocking
findings.** Approval is conditional on the exact-head required checks and updated
patch secret scan. DevOps can proceed without another QA session merely to copy
green CI results; changed source or an actual required failure reopens review.

Reviewed only the cleanup repair and five added regressions in
`/tmp/adbrain-o8-ePtVWk/g2`, base
`a7445f565586a2c4b484036b3bc12b01af28c7ea`, full diff SHA-256
`f87cee447f67de82c9a6c6517841eb0c56b3513dbfd2303c477189809a118652`.
The original failing diff/probe/observation above remain historical evidence;
they are not overwritten or relabeled as passing on this revision.

- [clearIntent](../../src/components/studio.tsx#L134) compares persisted ID/count
   with the captured intent before removal. A newer identity causes an early
   return; local pending state is cleared with an identity-conditional functional
   update. All existing cleanup callers share this rule. Read/parse/remove errors
   still propagate to recovery without silently authorizing another POST.
- The new [Studio regressions](../../tests/studio.test.tsx) exercise two mounted
   React instances: B confirms A, starts B, then A settles. POST completion,
   POST rejection and GET recovery each assert B survives and can later clear
   normally. The two storage-failure cases assert identity retention and one POST.
   No skipped/inverted expectation or weakened original assertion was found.

Reuse the coordinator's reported 35 passing Studio tests, touched lint and
non-incremental typecheck from [O-10 Fast Path](../ORCHESTRATION.md#o-10-fast-path).
Those are author checks, not a QA rerun. Independent evidence here is changed-code
and regression review, with exact candidate identity verification. No application
suite, G-1 check, browser, provider or production operation was repeated.

Atomic cross-tab admission, durable server intent/quota, permanently unknown
partial results and UI-01 remain unchanged limitations, not claims made by this
repair. Only QA's receipt changed; candidate/source/test ownership is back with
DevOps and no QA runtime or heavy slot is held.

## Issue 28 Review: 853d197

QA / ISSUE-28-REVIEW-1. **ACCEPT FOR SCOPE, conditional on exact-head required
checks and dependency/lockfile integration. No blocking findings in tenant
isolation, query cancellation, pagination, cache invalidation or SSR initialization.**
One non-blocking responsiveness finding is recorded below; it does not hold this
bounded read-workflow integration under the O-10 verification policy.

Reviewed commit `853d197f2b4ab6ca0460e628f8c9c6319c9d8d21` against
`a7445f565586a2c4b484036b3bc12b01af28c7ea` in `/tmp/adbrain-issue-28-o9`.
Exactly five committed paths: dependency manifests, campaign-list hook, its
Campaigns caller and campaign-audience tests. Read committed blobs/diffs because
the worktree also contains uncommitted hook/test changes. Those changes, including
the status-setter adjustment, are **not** included in this approval or the reused
77-test evidence. Do not publish a different tree under this commit's acceptance.

### P3: Status Change Can Wait for Search Debounce

In the committed [campaign-list hook](../../src/lib/meta-connect-ui/use-campaign-list.ts),
setStatusFilter updates only status, while enabled also requires search to equal
settledSearch. Enter new search text and change status before the 250ms timer
fires: the status-specific query remains disabled until that timer settles. This
is a small regression from the previous immediate status-change path, not a
tenant leak or mutation retry. The source handoff's unconditional immediate-status
claim is therefore too broad for this commit.

Follow-up: flush the pending normalized search when explicitly selecting status,
and cover the combined search-then-status sequence. The uncommitted setter and
test in this worktree appear intended to address this exact case; their existence
does not make the fix part of 853d197. This finding is based on committed control
flow; no new runtime failure or author-test rerun is claimed.

### Focused Review

| Area | Decision and evidence |
| --- | --- |
| Tenant isolation | Component-local QueryClient, owner/business/filter keys and no previous-key placeholder prevent cached rows from being reused across scopes. Prior key removal and unmount clearing cancel/remove old reads. Existing tests cover both owner and business changes with delayed old responses. Server authorization remains authoritative and unchanged |
| Cancellation | Fetch consumes Query's signal and checks it again after JSON resolution. Key changes remove old queries, including during replacement-search debounce. Explicit refresh cancels before restarting; unmount clears the client. Tests assert old-signal abort and no stale-response/error publication |
| Pagination | Cursor is an infinite-query page parameter within the exact tenant/filter key. Flattening keeps first-seen order with last-seen duplicate values; result maps merge across pages. Next-page fetch is guarded against concurrent fetches. Explicit refresh truncates to the first page before refetch, replacing stale cursors |
| Invalidation | Existing status/delete callbacks use per-row map/filter, so applying them to each cached page preserves their intent. Result refresh merges by ID. Mutations remain the existing explicit fetches, not Query mutations or automatic retries. Invalidations use only the local owner/business prefix; incoming unfiltered data does not overwrite active filtered pages |
| SSR initialization | Per-instance client is synchronously seeded only for its original unfiltered tenant key, with no module singleton or persisted cache. Incoming server props update the unfiltered key and revalidate a filtered view separately. Initial-seed and Strict Mode tests are client fixture evidence, not a full Next SSR/hydration certification |

The 30-second stale time is a read-cache policy, not provider/spend freshness
authority. Retry, mount/focus/reconnect/interval refetch are explicitly disabled;
networkMode always preserves explicit failure behavior for offline reads. No
delivery/payment authority or provider mutation semantics were changed.

### Reused Evidence and Release Boundary

Consumed [source/test handoff](../../.qa-artifacts/dev-b-o1/issue-28-handoff.json),
[77-test results](../../.qa-artifacts/dev-b-o1/issue-28-tests.json) and
[three-width browser receipt](../../.qa-artifacts/dev-b-o1/issue-28-browser-umIcJ2/receipt.json).
They bind the committed five-file source to 77 passed, zero failed/skipped and
offline real-component/browser passes at 1440/390/320px. Reused the reported
lint/typecheck and zero-vulnerability audit for pinned MIT React Query/query-core
5.104.0. No application tests, install, browser or full-suite run was repeated.

Browser evidence uses intercepted synthetic API transport; it is not authenticated
Next routes, real-provider, hosted CI or production evidence. Full Next build and
required hosted checks remain release gates. QA's independent contribution is
this exact-commit code review, not attribution of author runs as QA executions.

The approval applies to 853d197, not a later dirty-tree commit or the combined
#27/#28 lockfile. Recheck affected integration conflicts/changed source only;
unchanged green required CI does not require another review just to transcribe it.
Only this QA receipt changed; peer worktrees, shared code/dependencies, publication,
services and runtime slots are untouched.