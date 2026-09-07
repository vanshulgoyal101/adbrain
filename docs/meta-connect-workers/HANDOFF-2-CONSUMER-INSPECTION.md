# Worker 2 Consumer Inspection

Baseline: `d8d7890` plus concurrent Worker 1/3 changes in the shared checkout.
Scope: W2-06 inspection only. No live Meta calls, migrations, commits, or
deployments were run.

## Summary

The orchestrator has consolidated the campaign binding columns,
`campaign_drafts`, `campaign_operations`, RLS, RPCs, and shared `Database` types
into `db/schema.sql` and `src/lib/types.ts`. Runtime draft, preflight, operation,
planner, and durable-create handlers now use those contracts.

`src/lib/meta/connection-access.ts` publishes `withMetaConnection`, including
stored `binding` and `expectedGeneration` checks. Binding-dependent consumers now
use that boundary; campaign sync remains explicitly disabled because it cannot
persist original binding safely until its dedicated sync contract is approved.

## Consumers That Must Use Original Campaign Binding

### `src/app/api/campaigns/[id]/route.ts`

- Active `PATCH` now calls `withMetaConnection` with the reviewed
  `connectionGeneration` and checks `canActivate` before `ACTIVE`.
- Pause remains backward-compatible but still uses the legacy resolver until the
  shared campaign binding columns are typed; this is not complete W2-06 binding
  integration.
- Remaining integration: load stored campaign binding, pass it to both active and
  pause paths, and write-block old rows without verified binding.

**Updated:** the route now reads binding fields from runtime rows, blocks old
rows with a 409 reconciliation response, and passes the original binding and
generation to `withMetaConnection` for status changes. The shared DB types still
need the columns for this to be durable at compile/schema level.
- Pause remains safe to parse without activation digest, but must still target the
  original campaign account/page.

### `src/app/api/campaigns/[id]/refresh/route.ts`

- Refresh currently fetches campaign by id, then calls
  `metaClientForBusiness(campaign.business_id)`.
- Risk: if workspace connection switches from Account A to B, insights can be read
  against the current workspace token instead of the account that owns the stored
  Meta campaign id.
- Required integration: require stored campaign binding and call
  `withMetaConnection(context, { purpose: "read_insights", binding })` before
  `getCampaignInsights`.
- **Completed:** runtime binding parsing, old-row 409 block,
  and authorized `read_insights` call with stored binding/generation.

### `src/app/api/campaigns/sync/route.ts`

- **Completed safety action:** sync now returns 503 before provider access until
  the campaign binding columns/types are available. This prevents current-workspace
  imports from rehoming existing campaigns or creating rows without original
  account/Page/generation metadata.

### `src/app/api/leads/sync/route.ts`

- Lead sync currently lists all forms for the current business connection, then
  imports leads without campaign binding context.
- Risk: after an account/page switch, lead imports can come from the newly selected
  Page while old campaign rows remain associated with the previous Page.
- Required integration: either make this a current-connection inbox sync that tags
  page/account binding, or provide campaign-scoped lead sync using stored binding.
- **Completed:** current-connection inbox sync now uses
  `requireOwnedBusiness` and `withMetaConnection({ purpose: "read_leads" })`.

### `src/app/api/cron/enforce-spend/route.ts`

- Cron currently uses service role plus `metaClientForBusiness(businessId, admin)`.
- Risk: scheduled auto-pause can pause by current business token rather than the
  campaign's stored account/page binding.
- Required integration: use Worker 1's scheduled authorization boundary, load each
  campaign with verified binding, and call `withMetaConnection` or an equivalent
  scheduled binding-safe port. Do not synthesize a fake user session.
- **Completed in this continuation:** verified scheduler context, runtime binding
  parsing, old-row skip, and `withMetaConnection` pause calls.

### `src/lib/campaign/spend-enforce.ts`

- User-triggered auto-pause currently pauses campaigns through
  `metaClientForBusiness(businessId)` after refresh/sync.
- Risk: same binding mismatch as cron and status update.
- Required integration: use campaign-level binding per paused campaign; skip or
  block old rows without trustworthy mapping.
- **Completed in this continuation:** user-owned business authorization, stored
  binding/generation checks, old-row skip, and binding-aware pause calls.

## Current-Connection Consumers

### `src/app/api/campaigns/lead-forms/route.ts`

- This endpoint lists active lead forms for the current selected connection.
- **Completed:** it now uses
  `requireOwnedBusiness` plus `withMetaConnection(context, { purpose:
  "create_paused" })`; legacy credential lookup is not used.

### `src/app/api/campaigns/report/route.ts`

- Report generation reads local performance rows only and makes no Meta calls.
- It does not need stored binding for network safety, but rows should display or
  group by binding once the migration is consolidated.

## Unsupported Mutation Runner

### `src/app/api/internal/meta-traffic/route.ts`

- **Completed in this continuation:** the legacy `createDraftCampaigns` mutation
  mode is rejected before business/credential lookup. Read-only traffic checks
  remain allowlisted; the endpoint must not be used to create campaigns.

## Remaining Gates

- Campaign sync remains intentionally disabled until its binding-preserving import
  contract is finalized; it must not rehome rows through the current workspace.
- Real local DB/RLS operation lease concurrency remains a separate gate; current
  route tests use offline Supabase mocks.