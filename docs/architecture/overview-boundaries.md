# Architecture: Boundaries and Where to Make Changes

Part of [Architecture](README.md). [Overview and data flows](overview.md) · [Boundaries and where to change](overview-boundaries.md).

## Consistency Boundaries

### Campaign Execution and Read Models

Campaign creation orchestration lives in
[create-service](../../src/lib/campaign/create-service.ts), independent of HTTP.
The create route authenticates and verifies the reviewed request; the operation
repository owns claims/checkpoints; the Meta adapter owns provider payloads.
In opt-in worker mode, the route enqueues and returns 202. The standalone worker
rechecks current ownership, draft version, review hash and connection generation
before calling the same service. No Meta creation step is moved to a browser task
or an unawaited Vercel promise. All creation remains PAUSED.

The existing `campaign_operations` ledger is also the queue. Service-only RPCs
claim pending rows with `FOR UPDATE SKIP LOCKED`; expired running jobs require
reconciliation rather than automatic mutation replay. See
[Operations](../operations/runbooks/campaigns.md#campaign-worker-rollout) for leases and deployment.
Inline execution remains the default compatibility mode until that rollout.

Campaign display reads use stable `(created_at,id)` cursors, owner-scoped filters,
and at most 50 rows. Reports/spend checks use complete keyset reads and fail on
any page error; they do not reuse the display page. Complete reads still scale
linearly and are not a transactionally consistent financial ledger. The dashboard
is a server component and still computes its queue from complete campaign data.

Destination is explicit on campaigns and result snapshots: `instant_form`,
`whatsapp`, `call`, `mixed`, or `unknown`. Unavailable conversation metrics are
not zero leads; mixed/unknown/call outcomes are excluded from lead comparisons.
Legacy fallbacks use saved creation evidence, conversation metrics, or the old
app-specific `leads` objective, not arbitrary Meta engagement objectives.

### Campaign List Cache

[useCampaignList](../../src/lib/meta-connect-ui/use-campaign-list.ts) owns display
reads through TanStack Query, not campaign mutations. Each mounted view creates
its own `QueryClient`, seeded from server-provided rows; there is no global
cross-owner SSR cache. Keys contain owner, business, trimmed search and status.
Those keys isolate presentation state; the list route still authorizes every read.

- The query function passes its `AbortSignal` to fetch and checks it after JSON
  parsing. Old exact keys are removed on scope/filter changes; unmount clears the
  client. Pages deduplicate by campaign ID and merge stored result snapshots.
- Browser back/forward replays a page's earlier server render (#1003). The page
  stamps each render with a `renderId`; a view that mounts with an id this tab
  already showed refetches its list once, so a pause or edit made since shows.
- Nonempty search settles after 250 ms; changing status settles the current search
  immediately. Freshness is 30 seconds and cache GC is 60 seconds. Retries,
  mount/focus/reconnect refetch and polling are disabled explicitly.
- Append reads require another cursor and no current fetch. Explicit reload
  cancels the active key, reduces cached pages to the first page, then refetches.
- Mutation-result setters cancel stale reads, patch cached display data, and
  invalidate the owner/business scope. The existing mutation handlers retain their
  confirmation, ownership, provider and persistence responsibilities.

Do not reuse this bounded display cache for complete spend/report calculations.
[Preparation](../../src/lib/meta-connect-ui/use-campaign-preparation.ts) and
[targeting conversion](../../src/lib/campaign/editor-targeting.ts) remain separate
owners. This is not an application-wide query or editor state-machine rewrite.

| Boundary | Failure mode | Recovery principle |
| --- | --- | --- |
| Browser -> generation | HTTP ends after some paid work | GET by generation ID before new POST |
| Browser -> draft | Stale version | Reload/merge intentionally; do not overwrite |
| App -> Meta creation | Response lost after provider mutation | Query operation; reconcile external IDs |
| Meta -> local campaign mirror | Provider succeeded, DB failed | Verify remote state, preserve evidence |
| Storage -> database | File uploaded but row save failed | Best-effort cleanup; no distributed transaction |
| Usage/event sink | Persistence unavailable | Preserve business result; report health; never rerun paid work merely to log it |
| Candidate #34 lead import | Later provider page or checkpoint fails | Keep committed pages; resume recorded cursor with owner/binding and version checks |

Not every endpoint uses one response envelope or one status mapping. New connection,
draft, preflight, and operation APIs use typed envelopes; older routes retain
plain JSON or download responses. Clients must use the actual contract.

## Security and Resource Bounds

Outbound URL handling rejects unsafe addresses and revalidates redirects, with
DNS-bound connection handling to reduce rebinding risk. Remote media has byte,
pixel, format, frame, and time limits before use. The compositor receives validated
inline rasters rather than arbitrary remote URLs. RLS is still necessary even
when UI controls hide actions.

Paid routes use an atomic shared database rate limiter. Production fails closed
if enforcement is unavailable; nonproduction can fall back to process memory.
Monthly usage is a separate non-atomic quota preflight. Neither mechanism is a
provider billing limit. See [Operations](../operations/README.md).

Meta tokens live encrypted in a private schema and are accessed through server-only
RPCs. Browser DTOs contain selected assets/capabilities, never tokens. OAuth uses
signed state, browser binding, expiry, replay protection, and selection revisions.
These controls protect the app boundary; they do not prove Meta has approved the
app or granted usable access to a particular customer's assets.

## Background and Observability

Vercel invokes authenticated daily keepalive and spend-enforcement routes. These
are bounded HTTP jobs, not a persistent worker fleet. UI polling and post-response
`after` tasks do not constitute durable queues.

The opt-in [campaign worker](../../scripts/campaign-worker.ts) is a separate persistent
process, not a Vercel cron route. Its source is present; durable hosting, health
checks and alert ownership must be established before enabling it. Do not start
it merely to validate these docs: it can execute real campaign operations.

Owner audit history, trusted AI usage, and structured product events are separate
stores. Product telemetry uses request-local async context and safe metadata;
database logging is opt-in after migration and best effort. See
[Observability](../operations/observability.md) for exact limits and privacy. Logs are evidence
for diagnosis, not proof that every side effect was durably recorded.

## Where to Make Changes

- A new campaign input generally touches the draft schema, planner conversion,
  UI persistence, preflight hash, execution adapter, and regression tests.
- A new provider belongs behind the existing text/image interfaces; document
  credentials, reference support, deadlines, cost reporting, and fallback behavior.
- A new table needs explicit privileges/RLS, fresh-schema and upgrade parity,
  typed rows, and disposable database tests.
- A new route needs ownership, runtime input validation, resource limits,
  response-contract documentation, telemetry privacy review, and failure tests.
- A changed user workflow needs loading, empty, partial, failure, retry, and
  ambiguous-result behavior, not only the successful path.

Keep deployment policy in [Release Workflow](../operations/releasing.md). Do not infer that all
uncommitted work in a shared checkout is ready to publish together.

For verification, start with [connection access tests](../../tests/meta-connection-access.test.ts),
[Studio recovery tests](../../tests/studio.test.tsx), and the owning module's existing
suite; [Testing](../team/testing.md) owns execution commands and environment isolation.

The multi-channel design (adapters per ad platform) is [ADR-001](adr-001-multi-channel.md).
