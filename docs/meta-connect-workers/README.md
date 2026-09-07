# Three-Worker Execution Plan

Status: historical execution package. Three workers delivered into the shared checkout;
integration and local verification followed. Do not restart the worker assignments.
Current product verdict: [verification](VERIFICATION-2026-09-07.md).
Parent: [Meta Instant Connect](../META-INSTANT-CONNECT-PLAN.md).

## 1. Assignments

| Worker | Responsibility | Detailed assignment |
| --- | --- | --- |
| 1 | Secure storage, business authorization, OAuth, discovery, connection API, guided provisioning backend | [Worker 1](WORKER-1-CONNECTION.md) |
| 2 | Campaign authorization, preflight, saved drafts, operation persistence, safe creation/activation and campaign-account binding | [Worker 2](WORKER-2-CAMPAIGNS.md) |
| 3 | Contextual dialog, connection client, setup/Settings/campaign UI, draft resumption, accessibility and browser tests | [Worker 3](WORKER-3-EXPERIENCE.md) |

All workers read [CONTRACTS.md](CONTRACTS.md). Start them using the three prompts
in [PROMPTS.md](PROMPTS.md), not the parent plan alone.

Why this split: backend connection files have one owner; campaign mutations and
the existing Meta campaign client have another; React and page wiring have another.
Splitting OAuth/discovery arbitrarily between three workers would create more
integration dependencies than it removes. Workload is not perfectly equal:
Worker 1 is the likely critical path, and security review is mandatory.

## 2. Parallelism and the small shared dependency

Development can begin simultaneously; production integration cannot be independent.
Worker 2 starts pure preflight/operation tests using dependency injection. Worker 3
starts dialog/client tests with contract fixtures. Worker 1 first publishes the
small shared contract module and authorization boundary before deeper DB work.

Checkpoints, in order:

1. **C0: Contract checkpoint.** Worker 1 transcribes the types and schemas in the
   contract doc into `src/lib/meta/connect-contracts.ts` (browser-safe) and
   `src/lib/meta/connection-access.ts` (server-only boundary). Worker 2 publishes
   campaign DTOs in `src/lib/campaign/connect-contracts.ts`. Workers 2 and 3 compare
   their fixtures against these exports. Function bodies may still be unavailable;
   do not wire fake successful implementations into runtime routes.
2. **C1: Parallel feature work.** Each worker implements its own checklist. Any
   unavailable dependency stays behind injected test adapters; record integration
   as pending. No `any`, missing-module suppression, production mock, or fallback
   token to force a green build.
3. **C2: Backend integration.** Integrate Worker 1 contracts/storage, Worker 2
   migrations/operations, then validate real combined server adapters locally.
   Worker 2's worker/executor is not a deployment prerequisite for connection-only
   bounded requests, but is a gate for durable unattended campaign execution.
4. **C3: UI integration.** Replace test transport with the real owned APIs; run
   full browser flows against controlled fixtures and local DB integration tests.
5. **C4: Release review.** A coordinator reviews the combined diff and safety
   evidence. Migration application, public Meta tests, paid services and deployment
   require separate explicit authorization. Passing mocks does not clear this gate.

The coordinator is the user or a later review session, not a fourth implementation
worker. No worker silently takes over another worker's files to finish faster.

## 3. Single-owner file map

Paths below are allocation rules; proposed paths may not exist yet. Specific
exceptions take precedence over broad directories. Anything unlisted is read-only
until the coordinator assigns it. Ownership authorizes scoped changes, not rewrites.

| Files or paths | Sole writer |
| --- | --- |
| `src/lib/meta/**` except `client.ts` | Worker 1 |
| `src/lib/meta/client.ts` | Worker 2; preserve existing exports used by Worker 1 |
| `src/app/api/meta/**` | Worker 1 |
| New Meta-only deauthorization/deletion callback API routes | Worker 1; public legal pages remain unmodified |
| `src/lib/env.ts`, `.env.example`, `src/lib/supabase/{admin,server}.ts` | Worker 1, minimal required changes only |
| `src/lib/types.ts`, `db/schema.sql` | Worker 1; sole consolidated DB/type editor |
| New `db/migrations/*_meta_connect.sql`, `scripts/meta-connect-*` | Worker 1 |
| New `db/migrations/*_campaign_connect.sql`, `scripts/campaign-connect-*` | Worker 2; consume Worker 1 migration first |
| `src/lib/campaign/**`, new `src/lib/campaign-connect/**`, `src/lib/spend-enforce.ts` | Worker 2 |
| `src/app/api/campaigns/**`, `src/app/api/leads/sync/**`, `src/app/api/cron/enforce-spend/**` | Worker 2 |
| `src/app/api/internal/meta-traffic/**`, `scripts/generate-*-traffic.*` | Worker 2; no live traffic generation |
| New `src/app/api/campaign-drafts/**` | Worker 2 |
| `src/components/meta-connection.tsx`, new `src/components/meta-connect/**` | Worker 3 |
| `src/components/campaigns.tsx`, `campaign-chat.tsx`, `brand-form.tsx`, `workspace-home.tsx`, `workspace-shell.tsx` | Worker 3 |
| `src/app/(app)/{brand,campaigns,settings,dashboard}/page.tsx` | Worker 3 |
| New `src/app/connect/meta/{waiting,complete}/**` | Worker 3; server pages use Worker 1 safe accessors |
| New `src/lib/meta-connect-ui/**`, component-scoped CSS | Worker 3 |
| Existing `tests/meta-{oauth,credentials,connection}.test.*` | Worker 1 owns oauth/credentials; Worker 3 owns connection |
| Existing `tests/meta-{client,geo,destination,mappers}.test.*` | Worker 2 |
| Existing `tests/{env,db-schema}.test.*` | Worker 1 |
| Existing `tests/onboarding.test.*` | Worker 3 |
| New `tests/meta-connect-w1-*`, `tests/fixtures/meta-connect-w1/**` | Worker 1 |
| New `tests/meta-connect-w2-*`, `tests/fixtures/meta-connect-w2/**` | Worker 2 |
| New `tests/meta-connect-w3-*`, `tests/fixtures/meta-connect-w3/**`, `scripts/check-meta-connect-ui.mjs` | Worker 3 |
| New `docs/meta-connect-workers/HANDOFF-{1,2,3}.md` | Matching worker only |
| Package/lock files, CI, Next/Vitest/Playwright config, global CSS, shared primitives, existing mixed API test files, shared query loaders | Coordinator only unless explicitly delegated |

Worker 2 owns additional existing campaign-only tests after recording their exact
names in HANDOFF-2 before editing. Worker 3 likewise owns campaign-component-only
tests after recording them. Mixed tests covering several workers remain coordinator
owned: add focused regression suites instead of independently rewriting shared mocks.

Worker 1's schema/type task must include Worker 2's migration after C2. Worker 2
must not manually add a conflicting `Database` definition or edit `types.ts`.
If a typed RPC is not yet published, continue pure tests and report the dependency.
Worker 1 keeps migration order explicit, inventories existing migrations, and chooses
noncolliding filenames; do not blindly rerun the consolidated schema against prod.

## 4. Workspace safety

Preferred: three separate worktrees prepared by the coordinator from the same
recorded baseline containing these docs. Workers do not create branches, commit,
cherry-pick, or push unless separately instructed. The current planning changes
may be uncommitted: ensure each worktree receives them before sending prompts.
Do not create worktrees from HEAD and assume untracked docs came along.

If using one shared directory, disjoint ownership is mandatory. No worker runs
`git add .`, stash, reset, checkout, clean, pull/rebase, autoformatter across the
repo, lockfile install, or schema generation that overwrites others' work.
Each worker records baseline status and its own modified paths. New unrelated
changes are presumed to belong to another worker and are left alone.

In a shared directory serialize `next build`, typecheck, coverage and browser
server runs through the coordinator: `.next`, TypeScript incremental files,
coverage and screenshot outputs are shared. Focused Vitest tests may run separately
without coverage. With separate worktrees use separate dependencies/build outputs
and browser ports; never share `.next` or mutable `node_modules` through a symlink.
Reuse healthy dev servers only when they serve the worker's own checkout.

## 5. Contract changes and blocked work

A mismatch is not permission to invent an interface. Write in the worker's handoff:
contract version, symbol/route, expected shape, observed shape, smallest proposed
change, impacted consumer, and one test demonstrating the mismatch. Continue an
independent task. Coordinator approves changes; the owning worker updates the
contract and publishes the revision before consumers change.

No approval information from a Meta dashboard means **unverified**, not granted.
No local DB means DB authorization tests are **not run**, not passed. Missing
worker dependency means **integration pending**, not feature complete. A denied
provider capability means guided setup, not an invented API workaround.

## 6. Shared commands and handoff template

From the worker's own AdBrain root, first inspect `package.json` and local
instructions. This plan's baseline supports:

```sh
export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH"
npm run test -- --pool=threads --maxWorkers=2 tests/meta-connect-w1-contracts.test.ts
npm run typecheck
npm run lint
```

Replace the explicit test path with that worker's actual test files. Do not pass a
nonexistent file and report zero tests as success. Run a focused regression test
immediately after the first substantive code change, then iterate. Never use
`db:push`, seed scripts, traffic scripts or provider evals as routine validation.

Every handoff uses these headings:

1. Baseline commit, contract version, completed task IDs.
2. Exact changed paths, including new files.
3. Exports/routes delivered and their consumers.
4. Test commands, exact outcomes, failing baseline versus introduced failures.
5. Not run, external blockers, mocked versus real evidence.
6. Migration order/config variable names only; no secret values.
7. Remaining integration work with owner and reproducible case.
8. Explicit statement: no live migration, paid calls, commit/push or deployment.

Do not claim the overall project is complete from one worker's green tests.

## 7. Combined acceptance and release checklist

- C0 DTO fixture agreement; no divergent schemas or unowned edits.
- Real DB denies secret reads/writes for anon and authenticated owners; same-owner
  cross-business attacks fail; old plaintext and fallback routes are not left open.
- OAuth state is bound, expiring and single-use; staged reconnect does not destroy
  a valid connection; two tabs/disconnect cannot overwrite newer selection.
- Discovery complete/partial/ambiguous cases behave as specified; unknown billing
  or grants never produce a false delivery-ready state.
- Full create/plan/activate/refresh/lead-sync/cron call paths use the correct account;
  no external call happens before authorization or with another business's creative.
- Both campaign composers persist drafts before navigation, return to review after
  connection, show effective A/B budget, and require explicit activation consent.
- Duplicate requests and external timeouts do not blindly retry creation. Migration
  and operation tables support restart/reconciliation; runtime mocks cannot ship.
- Desktop/mobile/focus/popup-block/no-opener flows pass; connection has no tokens,
  developer jargon, lost drafts or success-before-persistence behavior.
- Full lint, typecheck, coverage, build, Home-to-Review and workspace UX gates run
  serially on the integrated checkout. Browser mutation/paid generation is mocked.
- Qualified human/security review of credential/RLS/OAuth/spend diffs precedes
  rollout. Cheap workers reduce coding cost, not the need for this review.
- Provisioning remains off until actual eligibility, endpoint fields, owner,
  billing responsibility, executor and controlled test permission are established.

First ship existing-account linking plus guided setup. Keep optional Meta app
sign-in, broad currency support, agency-owned accounts and unapproved job services
out of all three assignments. These are deliberate deferrals, not forgotten scope.