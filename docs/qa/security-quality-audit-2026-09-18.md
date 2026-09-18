# Campaign and API Security Audit: 2026-09-18

## Scope

Local incremental audit on `dev`, starting from release `1d3c537`.
This report covers confirmed campaign, OAuth, export, generation-error and spend
enforcement defects. It is not certification that every bug has been eliminated.
Concurrent work on planner validation, saved-work actions, lead sync and frontend
reliability was preserved; passing aggregate tests include that work.

No production database changes, deployment, credential changes, paid model calls
or live Meta mutations were performed by this audit. No migration is required by
the fixes below.

## Confirmed Fixes

| Boundary | Defect | Change and regression evidence |
| --- | --- | --- |
| Campaign selection | Empty creative lists passed preflight; duplicate selections were not explicitly rejected. | Require a nonempty, unique one-to-one selection of approved business-owned creatives. Safety-core tests exercise both cases. |
| Reviewed geography | Review bound the display label but not resolved geographic IDs; creation resolved names again. | Hash included/excluded provider geometry and create from the reviewed resolution. Tests change city/exclusion IDs without changing the label. |
| Reviewed creative | Review bound creative IDs but not image URL, headline, copy or CTA. | Bind content in the review hash and compare the execution-time content digest before the first Meta mutation. Tests cover every content field and a change after preflight. |
| Remote campaign authorization | Browser-writable local campaign references could address another object accessible to the token during pause, deletion or insights reads. | Meta client verifies the remote account and all returned ad-set Page bindings before those operations. Missing, foreign or incomplete evidence blocks the operation. Tests cover rejected references and valid reads/deletes. |
| Spend read failures | Failed settings/campaign/result reads became unlimited settings or empty spend, allowing activation to proceed. | Query helpers throw sanitized failures; activation returns 503 before Meta access. Tests distinguish failed reads from legitimately absent settings. |
| Spend scheduler | Failed reads and local persistence could be silently reported as a successful sweep. | Report incomplete enforcement as 503, retain confirmed results, and avoid claiming a locally persisted pause when that write failed. |
| OAuth transport | Discovery lacked request deadlines/cache policy and followed redirects; bearer tokens appeared in request URLs. | Shared Graph helper uses bearer headers, no-store, redirect rejection and a 15-second per-request deadline; paging tokens are stripped and foreign/credential-bearing URLs rejected. OAuth exchange and debug-token protocol parameters remain in their required query fields. |
| Generation responses | Raw upstream exception messages could expose provider response details to clients. | Generic total/partial-generation and regeneration errors, with regression tests containing secret-like provider text. Existing usage recording remains intact. |
| Creative export | Up to 50 downloads buffered concurrently; IDs were only cast and silently truncated. | Validate 1-50 UUIDs, deduplicate, apply shared per-user rate limiting, download sequentially with a shared 45-second deadline and 40 MiB retained-image budget. Copy export explains omitted images. Tests cover malformed input, limits and aggregate budget exhaustion. |

Provider binding enforcement deliberately fails closed for empty ad-set lists,
mixed Pages and responses with additional pages. Such campaigns require review
in Meta rather than bypassing the check. `deleteObject` is currently used only
for campaigns and now requires campaign binding evidence.

## Local Verification

- A disposable snapshot without `.env.local` or other environment files passed
  TypeScript, ESLint and the Next 16.3.5 production build (53 generation tasks).
- Snapshot coverage run: 1,193 tests passed, one live-provider test skipped;
  130 files passed, one skipped. Statements 75.87%, branches 68.15%, functions
  75.50%, lines 78.29%.
- Dependency audit of that snapshot: zero known vulnerabilities.
- Existing isolated PostgreSQL harness passed fresh-install and ordered-upgrade
  authorization, quota-ledger, rate-limit and operation-concurrency checks.
  It created only a temporary local database cluster.
- Editor diagnostics reported no errors in the checked audit implementation.
- Shared-worktree build/coverage initially collided with another session's
  output. Those interrupted runs are not counted as successful validation.
  An earlier full run also exposed stale server-action query mocks; they were
  updated and both action suites passed.
- At the final comparison, all implementation and test files changed by this
  audit matched the passing snapshot. Concurrent changes to brand-assets,
  brand-form and brand-ui tests occurred after the snapshot and are not covered
  by its aggregate receipt.

## Remaining Limits

- Monthly AI quota checks and activation spend-cap checks are not atomic
  reservations. Concurrent requests can pass the same preflight allowance;
  provider billing caps and operational monitoring remain necessary. Durable
  reservation/reconciliation needs a separately designed database change.
- Creative generation has no durable server-side idempotency ledger. Repeating
  an ambiguous POST can incur another paid call. The client recovery flow is
  helpful but is not a server guarantee.
- Campaign rows remain owner-writable. Provider checks constrain remote actions
  to the connected account and Page, not exclusive per-business ownership of
  campaigns when multiple businesses intentionally share those Meta assets.
  Browser-writable local status/budget values are not a trusted financial ledger.
- Spend enforcement uses stored provider snapshots, not real-time provider
  billing. The scheduler does not establish a hard weekly billing ceiling.
- A creative review digest binds URLs and text, not the bytes at a mutable
  remote image URL. Existing storage writes use new unique image paths.
- OAuth deadlines are per request, not one deadline for the full paginated
  discovery; discovery still has its existing 20-page bound.
- Partial Meta creation remains an explicit durable reconciliation state.
  Automatic rollback/retry was not added because network outcomes may be
  ambiguous and rollback can remove real provider objects.
- Live OAuth consent, provider interest behavior, AI recommendation quality,
  activation and authenticated browser journeys were not exercised in this
  audit. No production-release or browser-visual verification is implied.
- Local Node 22.12 emitted an ESLint dependency engine warning; use a maintained
  Node 22 release at least 22.13 for that dependency's supported range.

The earlier audit's lead-form, image-SSRF and destination-fallback observations
must be checked against current code: active-form preflight, guarded downloads
and explicit destination rejection already exist. They are not new findings in
this pass.