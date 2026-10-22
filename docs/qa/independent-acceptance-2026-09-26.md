# Independent QA Acceptance: September 26, 2026

## Decision

**Do not release managed paid delivery.** Accept DB-A's tested local integrity
implementation and the narrow F5/F8 fixes. Activation, spend enforcement, lead
completeness and the operational/commercial gates remain open.

This report supersedes the earlier blanket statement that DB-01..05 and F5/F8
remain unfixed. Development changed those paths during this QA session, so they
were independently retested. No application fixes were made by this QA worker.

Scope and packet definitions: [remediation plan](remediation-plan-2026-09-26.md).
Historical context: [baseline](qa-baseline-2026-09-26.md) and
[original findings](repository-audit-2026-09-25.md).

## Exact Candidates

Both candidates have Git HEAD `9da5b07b00e54fb552796cbcf01cc5fc7c2f02e7` on dirty
`dev`. HEAD alone does not identify their uncommitted source. Environment files,
coverage and test output were excluded from the source manifests.

| Candidate | Source manifest SHA-256 | Scope |
| --- | --- | --- |
| A: initial | `ffdc6867fa81230000a4e7d98ba5cf3610d61e0cc38367b416f7613d54eacf11` | 516 files; intermediate integrity constraints but not trusted-write/draft authority fixes |
| B: final acceptance | `9533d1d0e81069291536e6b97c020334eb1ddbf48858d31181a0181e0b5e4d13` | 529 files; DB-A authority changes, instruction failure handling and Studio recovery |

The manifest hash covers the serialized ordered file/hash array. Snapshot-only
test additions, browser fixtures, local ports and egress guards are verification
overlays, not application changes. Later workspace edits are not certified by B.
At close-out, all 529 frozen paths still matched the working tree. This comparison
does not certify additional files created after the snapshot.

Retained local artifacts, under the ignored test-results directory:

- [A source manifest](../../test-results/independent-qa-2026-09-26/initial/source-manifest.json)
  and [source patch](../../test-results/independent-qa-2026-09-26/initial/source.patch).
- [B source manifest](../../test-results/independent-qa-2026-09-26/final/source-manifest.json)
  and [source patch](../../test-results/independent-qa-2026-09-26/final/source.patch).
- [A full unit results](../../test-results/independent-qa-2026-09-26/initial/qa-vitest-results.json),
  [B focused results](../../test-results/independent-qa-2026-09-26/final/qa-final-focused.json),
  [B independent regressions](../../test-results/independent-qa-2026-09-26/final/qa-final-regressions.json).
- [B real PostgREST results](../../test-results/independent-qa-2026-09-26/final/qa-rest-results.json)
  and [B Studio recovery results](../../test-results/independent-qa-2026-09-26/final/qa-studio-results.json).

These artifacts are local, not published release evidence. The source patches
reconstruct the manifest inputs from the stated HEAD; they are not instructions
to apply changes over the current dirty checkout.
A [retained archive](../../.qa-artifacts/independent-qa-2026-09-26.tar.gz) sits outside
Playwright's output directory. Future browser runs may erase the loose links
above; extract this archive into test-results to restore them. The archive is
ignored by Git and contains no environment files, cookies or database dumps.

## Packet Matrix

PASS means the stated local scope passed, not production deployment approval.
FAIL means an exercised assertion or directly inspected required behavior fails.
BLOCKED means required scope or external evidence is incomplete; it is not a claim
that every underlying component is broken.

| Packet | Decision | Evidence and precise next handoff |
| --- | --- | --- |
| DB-A | **PASS, local implementation** | B fresh/upgrade/legacy SQL, all 13 real REST controls, and four authenticated draft workflows pass. DevOps must inventory and reconcile legacy production evidence, review locks/rollout, and verify deployed grants before any production acceptance. Managed capacity authority remains DEV-B |
| DEV-A | **BLOCKED, partial accepted** | F5 recovery passes at 1440/390/320px; F8 independent error-read assertion and affected generation tests pass. Dev must still deliver durable server generation intents, same-ID/input conflicts and atomic quota/liability reservations; two simultaneous tabs are not proven once-only |
| DEV-B | **FAIL** | B concurrent activation and provider-success/local-save-failure regressions fail. F1 paused children and F7 raw website remain. Campaign Dev owns reviewed child operations, destination identity and durable capacity/uncertain-outcome recovery |
| DEV-C | **FAIL** | B stale and missing observations still produce successful sweeps. Unpaginated scheduler reads remain source-confirmed. Campaign Dev plus DevOps must define complete, fresh, period-scoped observations and measured stop behavior |
| DEV-D | **FAIL** | B form and lead tests return only page one. DB tenant-safe association is accepted, not import completeness, attribution or handoff. Leads Dev must add durable cursors, inbox paging and exact-ID attribution |
| DEV-E | **BLOCKED** | No complete media/deletion/retention implementation delivered. Database relationship deletion checks are not a Storage/account-deletion or restore test. Backend/DevOps need reference inventory, cleanup intents and approved retention |
| PAY-A | **BLOCKED** | Local claim/event concurrency and payment tests pass. Another engineer's test-capture receipts were reviewed, not independently replayed. Complete missed-webhook/unknown-order recovery and approved refund/provider evidence; never recreate an uncertain order blindly |
| PAY-B | **BLOCKED** | Annual financial lifecycle and funding/commercial prerequisites are not accepted. No test capture constitutes spendable money |
| OPS-A | **BLOCKED** | Local container/API identity and Auth/REST were exercised. DevOps has a separate production inventory receipt; effective exposed schemas/Git-rule evidence and exact-candidate deployed compatibility remain incomplete |
| OPS-B | **BLOCKED** | No independent restore/alert-delivery drill, proven reaction bound or approved unattended-operation infrastructure. DevOps/owner must resolve the documented backup, commercial hosting and scheduler constraints |
| QA-A | **FAIL, gate not complete** | Six B independent safety assertions and a 320px UI check fail. No integrated browser CI job in B; clean Node 24/Linux install/coverage/hosted checks remain unverified. Adopt the corrected fixtures and regressions without relaxing assertions |
| DOC-A | **FAIL** | F9 script retains false-success handling and unsupported approval claims. Tooling Dev must retire/disable or rewrite it against real auth/HTTP contracts; this QA did not run it |
| BIZ-A | **BLOCKED** | Actual automatic Meta funding, customer consent, commercial/tax/refund terms and bounded pilot authority remain external gates |

## Database Before and After

Candidate A's disposable SQL harness had eight failures: campaign UPDATE, result
INSERT, draft metadata UPDATE and audit INSERT were accepted in both fresh and
ordered-upgrade databases. Its new numeric/date/cap and same-business lead checks
already passed. Real local PostgREST reproduced the same four unsafe write paths.
Foreign-tenant reads/updates did not disclose or modify another tenant's rows.

Candidate B independently passed the fresh and ordered-upgrade harness, including
invalid legacy data preservation/validation gates, draft races, server-assigned
clocks, delete semantics, audit identity and operation/token/payment restrictions.

Direct local Auth/PostgREST on B:

- Owner campaign UPDATE, result INSERT, draft version/expiry UPDATE and forged
  audit INSERT now reject with HTTP 403 / PostgreSQL `42501`.
- Negative spend, reversed periods and zero cap reject with `23514`.
- Cross-business lead/campaign association rejects with `23503`.
- Owner campaign reads, valid same-business lead creation and trusted result
  creation succeed. Foreign campaign reads are empty; foreign UPDATE is denied
  and an admin read confirms the original paused status is unchanged.
- All nine inspected fresh-schema integrity constraints are validated. This does
  not assert that production legacy rows or NOT VALID migrations are validated.

After tightening, actual browser-driven draft creation, cross-tab reopening,
versioned editing, stale deletion (409), authorized deletion and reload passed.
No real-provider create/sync/refresh/status mutation was performed; their changed
repositories/routes received SQL and mocked unit coverage, not live certification.

## Remaining Reproductions

### F1 and F7: Actual Meta Client, In-Memory Provider

The real [Meta client](../../src/lib/meta/client.ts) performed create, verify activation and activate against an
in-memory Graph implementation with global fetch prohibited. Result: campaign
ACTIVE, ad set PAUSED, ad PAUSED. Brand validation accepted `example.com`, which
remained unchanged in the creative link. No provider rejection or delivery was
observed because no provider call occurred. The Meta client is unchanged between
A and B; B's [creation service](../../src/lib/campaign/create-service.ts) still reads the mutable effective website.

### F3: Concurrent Capacity and Uncertain Activation

The actual B [PATCH handler](../../src/app/api/campaigns/[id]/route.ts) received two matching reviewed requests. A barrier
made both read the same empty active commitment set. With INR 200/day each and a
shared INR 2,000/week cap, both returned success: INR 2,800/week combined commitment.

In the second case, provider activation succeeded and the local save failed.
Retrying the original request invoked activation again. This establishes missing
durable recovery/fencing, not proof that setting ACTIVE twice necessarily creates
two campaigns or incurs two charges.

Reproducer: [activation assertions](../../test-results/independent-qa-2026-09-26/final/reproducers/qa-activation-recheck.test.ts).
Adopt these in the existing activation suite, with its current trusted-write mock.

### F2 and F4: Spend Evidence

The B [cron](../../src/app/api/cron/enforce-spend/route.ts) returned `ok: true` for an active campaign with either a zero-spend
snapshot dated 2020 or no snapshot. The required incomplete/stale evidence
assertions fail. Source still reads limits, campaigns and results without cursor
pagination and maps omitted results to zero.

Reproducer: [cron assertions](../../test-results/independent-qa-2026-09-26/final/reproducers/qa-cron-recheck.test.ts).
The full >1,000-row scheduler workload, timezone boundaries and detection-to-pause
latency were not exercised. Do not treat this run as complete scale validation.

### F6: Lead Pagination

The B client received a first response with a next-page cursor and a second
response containing the only additional form/lead. Both tests returned only
`first`, not `first, second`. No provider request occurred.

Reproducer: [pagination assertions](../../test-results/independent-qa-2026-09-26/final/reproducers/qa-meta-recheck.test.ts).
Inbox >200-row navigation, durable sync restart and an authorized enquiry handoff
remain unaccepted.

### F5 and F8: Fixed Narrow Slices

On A, an interrupted Studio request followed by retry produced two POSTs without
generation IDs at all three widths. On B, the same scenario plus reload produced
one POST and two GET lookups with one retained UUID; recovered results appeared
without a second POST. These are synthetic response fixtures, not paid generation.

The independent instruction-query failure assertion resolved to empty text on A
and correctly rejected on B. Affected generation-route tests verify failure before
paid generation. [Instruction assertion](../../test-results/independent-qa-2026-09-26/final/reproducers/qa-instructions-recheck.test.ts).

### UI-01: Studio Workflow Label Overflow

At 320px, "Generate" requires 54px but receives 49px in its workflow step.
The document itself does not horizontally overflow, so a page-width assertion
alone misses this. Reproduced on A and B; 390px/1440px labels fit.

[B screenshot](../../test-results/independent-qa-2026-09-26/final/qa-studio/recovered-320.png).
Frontend Dev: adjust the workflow track/text layout, then rerun the individual
label-width assertion and keyboard/preview tests at 320px. Do not remove the check.

## Test Receipt

| Check | Independent result |
| --- | --- |
| A full Vitest run | 1,790 passed; seven added regressions failed; one paid test skipped; 145 files total |
| A focused SQL | Eight expected integrity failures across fresh/upgrade; other harness checks passed |
| A integrated browser journeys | 18 distinct cases passed across focused runs after fixture corrections; one 320px Studio label check failed |
| B DB harness | Fresh, ordered upgrade, invalid legacy and final validation paths passed |
| B real local REST | 13/13 passed |
| B focused unit/component suites | 12 files, 188 tests passed |
| B independent regression comparison | One passed (F8), six failed (F2/F3/F6); 123 neighboring cases excluded by the QA-name filter, not claimed as passed |
| B post-hardening browsers | Four draft workflows and three Studio reload/recovery cases passed; UI-01 persists |
| Static checks | A and B scoped `eslint src tests e2e` and TypeScript passed after correcting QA fixture lint |
| B production build | Passed, 58 static-generation tasks; placeholder config, no environment files, provider-blocked HTTP/fetch |
| Runtime | Local Node 22.12.0; installed dependency tree cloned, not npm ci. B CI config targets Node 24 |

The initial coverage attempt was interrupted by terminal reuse and is discarded.
The completed A run was non-coverage. No current full B coverage, fresh dependency
install, dependency audit, Gitleaks run, Node 24/Linux run or hosted check is claimed.

Full local commands used the scrubbed environment with placeholder Supabase
configuration and paid evaluation disabled. SQL used the existing temporary
Unix-socket harness, with read access to Git objects for its historical baseline.
Tests under live-provider SDK boundaries used mocks/fixtures.

## Browser Fixture Handoffs

Keep product failures separate from harness failures encountered during this run:

1. Reset synthetic DB-probe rows before UI tests. An interrupted probe initially
   left a campaign and invalid empty draft, changing the composer and draft-list
   preconditions. They were removed only from the disposable project.
2. Explicitly fixture GET campaign-list and lead-form reads. Existing recovery
   tests labelled them unexpected mutations. Write assertions were preserved.
3. Draft-first setup now requests an audience recommendation before connecting.
   Fixture the current targeting contract, including required rationale.
4. Select the guided goal textbox by its actual placeholder, not all textareas.
5. Add 320px to draft/connection and Studio journeys. Keep external browser
   requests blocked and server-side provider access independently blocked.

The corrected [browser fixtures](../../test-results/independent-qa-2026-09-26/initial/e2e-fixtures/workspace.spec.ts)
are retained as handoff artifacts, not silently substituted into the shared tree.
CI should provision its own project, verify server identity, avoid arbitrary
existing-server reuse and retain sanitized screenshots/results.

## Reproduction and Source Pointers

In a disposable checkout of the stated HEAD, apply B's retained source patch,
then verify its manifest before adding the four retained QA test files under
tests. They duplicate neighboring setup deliberately for handoff; merge the
assertions into existing suites before committing permanent regression coverage.
Use no repository environment files or live credentials:

```sh
env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp CI=1 \
  RUN_PAID_CREATIVE_EVAL=0 \
  NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key \
  npm test -- tests/qa-activation-recheck.test.ts \
  tests/qa-cron-recheck.test.ts tests/qa-instructions-recheck.test.ts \
  tests/qa-meta-recheck.test.ts -t 'QA ' --maxWorkers=1
```

Expected on B: six failures and one pass. SQL uses `TMPDIR=/tmp npm run test:meta-db`;
a source-only snapshot additionally needs `GIT_DIR` pointing to the repository's
Git objects. Real REST/browser probes require a newly verified disposable stack,
not the production-pointing default local environment. Retained probes have
explicit temporary-project/path assumptions; inspect and adapt them, do not run
them blindly against another stack. Browser fixture overlays and Playwright
configs are retained with each phase.

Other controlling paths: [schema](../../db/schema.sql),
[trusted campaign writes](../../src/lib/campaign/trusted-write.ts),
[draft endpoint](../../src/app/api/campaign-drafts/[id]/route.ts),
[instruction queries](../../src/lib/supabase/queries.ts),
[Studio](../../src/components/studio.tsx),
[unsafe daily script](../../scripts/daily-adbrain-test.sh),
[CI](../../.github/workflows/ci.yml). Their exact tested contents are recoverable
from B's verified manifest and patch; live checkout links may change later.

## External Evidence and Cleanup

Reviewed the [Development handoff](db-a-dev-a-handoff-2026-09-26.md),
[DevOps receipt](ops-environment-2026-09-26.md) and the current
[payment receipts](../PAYMENTS-PLAN.md). Their production inventory and test
captures are attributed evidence, not operations independently repeated here.
Production catalog/grants, deployed workflows, actual customer consent, refund,
settlement, funding, ad delivery and restore/alert drills remain distinct gates.

Local services: dedicated `adbrain-qa` Colima profile; uniquely named disposable
Supabase project on API 55321/DB 55322; synthetic Auth/business/creative fixtures;
temporary Next server on 3939. Only local generated credentials were used, and
server HTTP/fetch plus browser routing blocked provider traffic. This was not an
OS-level network sandbox. Supabase/Next listeners were network-accessible on the
host; loopback-only binding or isolated runners is a DevOps follow-up.

Both temporary app servers and disposable Supabase projects were stopped/removed;
the previously stopped QA VM was returned to stopped state. No production data,
credentials, payment, ad, deployment, branch or commit was changed by this QA.
Concurrent engineer changes were preserved. Raw environment/status output,
cookies and database contents are excluded from retained QA artifacts.