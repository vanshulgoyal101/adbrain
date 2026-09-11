# Master Orchestrator Review

Prepared: 2026-09-07. This is an integration checkpoint, not a production release
approval. Worker 1 owns secure Meta connection infrastructure; Worker 2 owns
campaign persistence/mutation integration; Worker 3 owns the browser experience.

## Current verdict

**Not yet a seamless, released connection experience.** Read the current assessment
at the top of [VERIFICATION-2026-09-07.md](VERIFICATION-2026-09-07.md).
It supersedes the older handoffs and instructions below. Local capability bootstrap,
discovery persistence, disconnect, and retry defects have been repaired. Local
Supabase/browser checks now pass, but real Meta consent/callback remains unproven
and draft-first campaign entry is still gated by connection status.

The next milestone is connection-only: existing account -> verified selection ->
return to saved draft. Do not restart the worker plans, add infrastructure, or
require campaign spending/automated provisioning to demonstrate that milestone.

The user approved free staging only, with no changes to existing projects.
The Free-plan organization's two active slots are occupied, so hosted provisioning
was stopped without creating resources or changing billing.

## Coordinator work completed

- Consolidated Worker 2's `campaign_drafts`, `campaign_operations`, campaign
  binding columns, RLS, draft-version RPC, lease/checkpoint RPCs, and shared type
  definitions into the authoritative `db/schema.sql` and `src/lib/types.ts`.
- Added `scripts/check-meta-connect-routes.mjs`; it passes all 10 advertised
   Meta/campaign client routes after Worker 2's runtime integration.
- Centralized operation capability enforcement in `withMetaConnection`.
   Pause/delete now have separate bound, management-scope-checked purposes so
   activation eligibility does not block spending reduction.
- Removed unreachable legacy campaign-sync code after that endpoint was explicitly
  gated on binding storage.
- Fixed an integrated Worker 3 fixture narrowing error so the repository typechecks.

## Worker achievements

### Worker 1

- Encrypted server-only token storage, replay-safe OAuth, app-token debug inspection,
  actual granted permissions, complete/truncated discovery, explicit business/Page
  relationship evidence, selection/retry/recheck, generation fencing, deauthorization,
  and guided-only provisioning.
- Runtime credential resolution no longer reads the plaintext token table.
   The controlled backfill script necessarily reads legacy rows; it has not run.
- Schema/migration/RPC/security tests and focused Worker 1 tests pass.

### Worker 2

- Strong pure campaign contracts, draft policy, preflight, operation/idempotency,
  external-ID checkpointing, reconciliation, binding, and activation safety cores.
- Added Meta mutation checkpoint support and disabled unsafe internal campaign creation.
- Campaign persistence migration, draft/preflight/operation routes, durable paused
   creation, and binding-aware consumers are now delivered by Worker 2.

### Worker 3

- Strong same-origin typed browser client, popup/same-tab fallback, abortable polling,
  native dialog accessibility, origin/source/attempt checks, completion pages, and
  contextual Settings/campaign entry points.
- UI correctly avoids fake successful backend fallbacks and now consumes the real
   draft/preflight/operation runtime contracts.

## Blocking findings

See the current verification report's product acceptance table. The capability
bootstrap and discovery-completeness findings below are historical and fixed.
Local staging exists and has passed authenticated browser checks. Public Meta
access, first-time draft-first entry, actionable missing-asset recovery, and the
actual consent-to-draft journey remain unproven or incomplete. Full campaign
execution readiness is a separate milestone.

## Historical Execution Order (Superseded)

1. Worker 2 completes any remaining refresh/sync/lead-sync/spend consumers to stored
   campaign binding or keeps them explicitly blocked.
2. Coordinator runs route inventory, full tests, lint, typecheck, build, coverage,
   and isolated database checks serially.
3. Only after that: controlled Meta smoke test, migration review/application, and
   release/security approval.

## Route inventory status

Run:

```sh
node scripts/check-meta-connect-routes.mjs
```

Current inventory: **10 routes**. Existence checks do not prove behavior or
release readiness; use the latest verification report for that assessment.

## Historical Worker Prompts

Run these sequentially. Worker 3 must start only after Worker 2 makes the route
inventory pass and reports its focused tests.

### Worker 2: Runtime campaign integration

```text
You are Worker 2 continuing AdBrain Meta Instant Connect after the master
orchestrator's integration checkpoint.

Read:
1. docs/meta-connect-workers/ORCHESTRATOR-REVIEW.md
2. docs/meta-connect-workers/CONTRACTS.md
3. docs/meta-connect-workers/HANDOFF-2-CONTINUATION.md
4. src/lib/campaign/connect-contracts.ts, draft-store.ts, operation-store.ts,
   preflight-service.ts, operations.ts, and db/migrations/20260907_campaign_connect.sql

The orchestrator has already consolidated your campaign drafts, campaign
operations, campaign binding columns, RLS, and campaign RPC/type contracts into
db/schema.sql and src/lib/types.ts. Do not edit Worker 1 Meta security files or
duplicate Database types. Work only on campaign runtime routes and campaign
consumers that are assigned to you.

Implement these exact missing handlers:
- POST /api/campaign-drafts
- PUT /api/campaign-drafts/[id]
- POST /api/campaigns/preflight
- GET /api/campaigns/operations/[id]

Use the existing pure stores and the consolidated Database contract. Every route
must authenticate, explicitly verify business ownership, enforce draft ownership,
expiry and version, return the frozen ApiResult/DTO shapes, and never expose raw
provider errors or secrets. Add no fake success response and no in-memory-only
persistence.

Then rewire POST /api/campaigns/create so manual and guided creation both use:
draft -> preflight -> connection generation/binding check -> durable operation
claim -> Meta paused mutation -> external-ID checkpoints -> local campaign save
-> operation finish. Same idempotency key must replay; changed request hash,
stale draft, stale plan hash, generation mismatch, lease loss, or unknown external
outcome must not create a second campaign. Preserve all known external IDs and
enter needs_reconciliation when local persistence is uncertain.

Persist campaign meta_ad_account_id, meta_page_id, and
meta_connection_generation on successful local creation. Old campaign rows with
no trustworthy binding remain blocked for provider mutations.

Wire the planner route to persist a DraftDTO through the new draft repository
instead of returning the current 503. Planning must never call a Meta mutation.

Audit and repair these remaining consumers for binding safety:
- campaigns/[id]/refresh
- campaigns/sync
- leads/sync
- cron/enforce-spend
- lib/campaign/spend-enforce.ts
- campaign DELETE/status paths

Use Worker 1's requireOwnedBusiness/withMetaConnection boundary. Do not call
metaClientForBusiness for campaign mutations, cron, refresh, lead sync, or spend
enforcement. Pass the original campaign binding and expected connection generation.
If an old row lacks binding, return a clear reconciliation blocker rather than
using the current workspace account.

Do not create accounts, campaigns, or spend money against live Meta. All tests
must mock Meta and paid providers. Do not apply migrations, commit, push, deploy,
change package/config files, or spawn workers. Do not edit React components; Worker
3 will consume your routes after this task.

Required validation:
1. node scripts/check-meta-connect-routes.mjs must pass.
2. Focused Worker 2 tests for draft routes, preflight, operations, idempotency,
   binding, planner separation, and activation must pass.
3. npm run typecheck and npm run lint must pass.
4. Add route-level tests proving foreign business, stale draft, stale generation,
   duplicate idempotency, unknown outcome, and missing binding fail before Meta.

Finish with HANDOFF-2-CONTINUATION.md containing exact paths, route contracts,
tests/results, remaining blockers, and explicit statement that no live migration,
Meta mutation, commit, push, or deployment occurred.
```

### Worker 3: UI integration after Worker 2

```text
You are Worker 3 continuing AdBrain Meta Instant Connect after Worker 2 makes
the route inventory pass.

Read:
1. docs/meta-connect-workers/ORCHESTRATOR-REVIEW.md
2. docs/meta-connect-workers/CONTRACTS.md
3. docs/meta-connect-workers/HANDOFF-3.md
4. src/lib/meta-connect-ui/client.ts and src/components/campaigns.tsx

Use the real Worker 2 routes. Do not add fixtures, fake success, client-side
readiness decisions, direct Meta calls, or a fallback to the legacy create API.

Fix the manual campaign composer so it:
1. Saves a DraftDTO before OAuth/navigation.
2. Calls preflight and renders ReviewDTO blockers/account/Page/currency/geography/
   per-set budget/effective total.
3. Calls durable createCampaign with draftId, draftVersion, planHash,
   connectionGeneration, and a stable idempotency key.
4. Polls the real operation endpoint after 202/processing responses.
5. Never retries create with a new key after timeout or needs_reconciliation.

Fix activation confirmation so the final request includes:
- status: "active"
- the exact 64-character confirmationDigest derived from the reviewed payload
- the current reviewed connectionGeneration

Do not let OAuth completion activate or submit anything automatically. Reconnect
must return to review. Pause remains available without the activation digest, but
must use the stored campaign binding once Worker 2 exposes it.

Fix draft conflict/reload handling: a stale draft version must preserve local
edits and ask the user to reload/resolve, never overwrite newer server state.
Render needs_reconciliation as a support/recovery state, never as a retry-create
button. Keep popup blocked, no-opener, wrong-origin/source/attempt, mobile
redirect, expired attempt, and reload behavior intact.

Use the existing MetaConnectDialog and same-origin client. Do not edit Worker 1
OAuth/token/schema files, campaign API routes, package/config/global CSS, or
shared primitives. Browser tests must mock all Meta/AI/paid mutations and fail
unexpected network requests.

Required validation:
1. scripts/check-meta-connect-routes.mjs passes.
2. Focused W3 dialog/client/completion tests pass.
3. Add a manual-composer test proving no direct legacy create call remains.
4. Add an activation test proving digest and generation are sent.
5. Add a timeout/reconciliation test proving no blind duplicate create.
6. Test 1440/1024/768/390, keyboard focus/Escape, long labels, popup-blocked,
   no-opener, stale response and reload states.
7. npm run typecheck and npm run lint pass.

Finish with HANDOFF-3.md listing exact paths, route evidence, screenshots/tests,
mocked versus real evidence, and remaining external OAuth/database gates. Do not
commit, push, deploy, apply migrations, create live campaigns, or spend money.
```

## Release boundary

The current checkout has no direct private-token reads, passes integrated typecheck,
and has passed the existing offline suite. Those facts do not prove real database
privileges, Meta App Review, OAuth redirect behavior, mobile popup behavior, billing,
or campaign delivery. Provisioning and activation remain explicitly gated.