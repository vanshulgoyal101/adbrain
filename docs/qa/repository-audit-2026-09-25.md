# Repository Audit: September 25, 2026

## Conclusion

AdBrain is a substantial, tested marketing workspace, not just a mockup. Brand
management, AI creative generation/review, Meta connection, campaign preparation,
paused creation, manual lead import and reporting have real implementations.
The managed annual advertising service is not an implemented end-to-end money
flow. The largest remaining risks sit between successful preparation and actual
delivery: activation, fresh spending evidence, complete imports and paid-work
recovery.

No application code, credentials, deployments, remote databases, Meta objects or
payment settings were changed for this audit. This report is the only intended
tracked-file addition. Existing edits to the Payments Plan and Roadmap were
preserved. Local test artifacts were generated.

## Scope and Evidence

- Baseline: `dev` at `9da5b07`. Local Git references for `main`, `origin/main`
  and `origin/dev` also pointed there; remote freshness was not checked.
- Inventoried 505 tracked files before this report: 226 files under `src`,
  including 222 TypeScript files; 30 operational scripts; 11 SQL migrations;
  53 documentation-tree files. Application sources total approximately 27,300
  lines; code, tests, scripts, SQL and documentation total approximately 63,500.
- Parsed all 222 application TypeScript files for imports, route methods and
  privileged database boundaries. Found 40 route files with 45 HTTP handlers.
- Manually traced critical flows and adjacent tests across authentication,
  ownership, OAuth, token storage, AI generation, media fetching, drafts,
  preflight, creation, workers, activation, spend, leads, billing and UI recovery.
- Reviewed release/configuration/CI controls and selected operational scripts.
  Historical documentation was distinguished from current source and the latest
  uncommitted owner decisions.

This is a broad source and local-execution audit, not a claim that every source
line, asset, historical receipt or possible runtime path was manually verified.
Dependencies were not individually source-audited. No live provider or production
certification is implied.

## Follow-Up Status

Owner direction September 25: documented for later work. Findings F1-F9 are all
open and deferred; no application fixes have been started. Resume from the
individual findings below and recheck them against current source before making
changes. The funding-first [Roadmap](../ROADMAP.md) remains the active priority.

## Findings

### F1: P1 - Activation leaves newly created children paused

Creation explicitly sets the campaign, every ad set and every ad to `PAUSED`.
Activation verifies campaign/ad-set properties but writes `ACTIVE` only to the
campaign. Paused children remain paused, so a successful activation response and
local active badge do not establish delivery for an AdBrain-created campaign.

Sources: [creation states](../../src/lib/meta/client.ts#L662),
[ad-set state](../../src/lib/meta/client.ts#L727),
[ad state](../../src/lib/meta/client.ts#L801),
[activation mutation](../../src/lib/meta/client.ts#L924),
[activation route](../../src/app/api/campaigns/[id]/route.ts#L138).

Evidence: executed the actual client against an in-memory Graph stub, including
creation, activation verification and activation. Final states were campaign
`ACTIVE`, ad set `PAUSED`, ad `PAUSED`; no network calls occurred. Existing tests
pass without covering this lifecycle mismatch.

Before paid delivery: define explicitly reviewed child activation, verify the
exact intended objects, persist/reconcile partial outcomes, and test the entire
create-to-delivery transition. Do not indiscriminately enable imported children
that an owner deliberately paused.

### F2: P1 - Scheduled spend enforcement can report success on stale evidence

The cron reads stored results, never refreshes insights, does not impose an age
limit and treats missing per-campaign spend as zero. A campaign can keep spending
while the stored snapshot remains below the cap. The scheduled job is daily,
not a continuously running spend monitor.

Sources: [stored-result query](../../src/app/api/cron/enforce-spend/route.ts#L77),
[zero fallback](../../src/app/api/cron/enforce-spend/route.ts#L96),
[schedule](../../vercel.json#L18).

Evidence: executed the actual cron with synthetic database rows and mocked
provider boundaries. An active campaign and a zero-spend snapshot dated 2020
produced HTTP 200, an empty action list and zero provider calls.

This is an existing documented limitation, independently confirmed here, not a
newly introduced regression. It is still a blocker to treating this mechanism
as protection for a customer's prepaid annual allocation. Use fresh,
period-scoped observations, explicit unavailable/stale states and separately
verified provider spending controls; none should be advertised as a guaranteed
real-time hard cap.

### F3: P1 - Activation does not reserve spending capacity atomically

The route reads active commitments, checks the cap, performs provider operations
and finally updates the local row. Two requests can read the same old commitments
and both pass. A provider success followed by a failed local write also leaves
an active campaign represented locally as paused, affecting subsequent checks.
Unlike creation, activation has no durable operation ledger in this route.

Sources: [read/check](../../src/app/api/campaigns/[id]/route.ts#L61),
[provider mutation](../../src/app/api/campaigns/[id]/route.ts#L138),
[local mirror](../../src/app/api/campaigns/[id]/route.ts#L159).

Evidence: source trace plus executable guard arithmetic. Two INR 200/day
campaigns each pass against an empty active set and INR 2,000/week cap; together
they commit INR 2,800/week. The concurrent HTTP interleaving was not reproduced.
Non-atomic activation is already acknowledged in the operations documentation.

Before managed spending: serialize/reserve capacity per business, retain
uncertain activation outcomes durably and reconcile provider state before
releasing reservations or treating the campaign as safely inactive.

### F4: P2 - The spend cron's reads are not complete at scale

The cron reads limits, campaigns and historical result rows without pagination.
Results are globally sorted by freshness, not reduced to one latest row per
campaign by the database. A busy campaign's snapshots can crowd other campaigns
out of a capped response, after which omitted spend becomes zero. Whole
businesses/campaigns can also be omitted by their respective result caps.

Sources: [cron queries](../../src/app/api/cron/enforce-spend/route.ts#L46),
[configured 1,000-row API limit](../../supabase/config.toml#L18),
[complete application read helpers](../../src/lib/supabase/queries.ts).

Evidence: source inspection; no high-volume hosted PostgREST test. Adapt the
existing complete-read patterns for the scheduler's service-role boundary or
use an explicitly scoped database aggregate. Do not assume passing small
fixtures establishes complete enforcement.

### F5: P2 - Studio can repeat paid generation after an ambiguous failure

Create retains a generation ID and checks saved results after an interrupted
request. Studio sends no generation ID, has no equivalent reconciliation and
tells the user to try again after a network failure. The server may already
have generated and saved variants, so another submission can duplicate paid
work. A generation ID alone would not provide server-side idempotency.

Sources: [Studio generation](../../src/components/studio.tsx#L91),
[Create recovery](../../src/components/ad-assistant.tsx#L218),
[generation endpoint](../../src/app/api/creatives/generate/route.ts).

Evidence: source comparison and the existing recovery tests. Reuse the established
client recovery behavior and add a Studio disconnect-after-save regression test.
Durable server claims would be a separate improvement for once-only execution.

### F6: P2 - Lead import silently stops at the first provider page

`listLeadForms` fetches a single page. `listLeadsForForm` requests up to 200
leads and ignores pagination. Repeating sync can retrieve the same newest page
without ever reaching older unsynced leads. The UI can then report that it is
up to date. Separately, initial inbox loading is limited to 200 rows without
a browse-older pagination workflow.

Sources: [form and lead reads](../../src/lib/meta/client.ts#L435),
[sync route](../../src/app/api/leads/sync/route.ts),
[inbox](../../src/components/lead-inbox.tsx),
[initial reads](../../src/lib/supabase/queries.ts).

Evidence: source inspection. Add bounded, resumable provider pagination,
durable progress or an explicit partial result, and tests where a second page
contains the only new lead. Keep import completeness separate from display
pagination.

### F7: P2 - Accepted bare-domain websites reach Meta without normalization

Brand validation intentionally accepts `example.com`. Saving preserves that
value, and campaign execution passes it directly as the creative link. The
Graph payload therefore need not contain an absolute HTTP(S) URL, exposing a
normal advertised input to a provider rejection after campaign creation starts.

Sources: [website validation](../../src/lib/brand/validation.ts),
[brand save](../../src/app/%28app%29/brand/actions.ts),
[creative link selection](../../src/lib/campaign/create-service.ts).

Evidence: an in-memory probe confirmed both acceptance of `example.com` and its
unchanged presence in `link_data.link`. Actual Meta rejection was not tested.
Normalize and validate the effective destination before review/execution; include
the destination in the reviewed contract rather than relying on mutable brand data.

### F8: P2 - Saved generation instructions disappear on database errors

`getAdInstructions` discards the Supabase error and returns an empty list.
`getActiveInstructionsText` consequently returns an empty string, and paid
generation proceeds without saved rules. Reference-image and recent-copy
loaders, by contrast, explicitly stop generation when their reads fail.

Sources: [instruction queries](../../src/lib/supabase/queries.ts),
[generation context](../../src/app/api/creatives/generate/route.ts),
[reference loaders](../../src/lib/creative/references.ts).

Evidence: source trace; no new fault-injection test. Distinguish an intentionally
empty instruction list from a failed read and fail before spending when required
brand/compliance instructions cannot be loaded.

### F9: P3 - The daily activity script can print false success

The script uses `curl -s` without failing on HTTP errors, calls a nonexistent
`/api/leads` endpoint and supplies a bearer token to routes whose session client
uses cookies. Its success messages and estimated API-call totals do not prove
that authenticated requests or provider calls occurred. Authentication failure
can also exit successfully.

Sources: [daily script](../../scripts/daily-adbrain-test.sh),
[session client](../../src/lib/supabase/server.ts),
[actual lead route](../../src/app/api/leads/sync/route.ts).

Evidence: source inspection only; the script was not run. Retire it or align it
with current auth/contracts, validate status and body, and remove unsupported
approval/timeline promises. Traffic generation is not Meta approval evidence.

## What Is Implemented

| Area | Current implementation and boundary |
| --- | --- |
| Workspace | Next.js 16.3.5, React 19, TypeScript, Tailwind 4; public pages plus authenticated dashboard, Brand Brain, Create, Studio, campaigns, enquiries, assets and settings |
| Identity | Supabase sessions, owner-scoped RLS and explicit business authorization for Meta; the UI generally selects the oldest owned business |
| AI | Bounded interview, editable brief, concept validation/repair, text-provider routing, image generation, raster validation/composition, per-variant persistence, approval and export |
| Meta connection | Signed expiring state, browser-bound attempts, replay protection, encrypted private token storage, asset discovery/selection and capability checks |
| Campaign preparation | Versioned drafts, canonical review hashes, creative-content checks, resolved targeting, explicit destination and total A/B commitment |
| Creation | Paused provider objects, durable idempotency/lease/checkpoint operations, ambiguous-mutation reconciliation state; optional persistent worker shares execution code |
| Delivery/results | Explicit activation confirmation, pause/delete with binding checks, manual campaign sync/insight refresh, reports and manual instant-form lead sync |
| Observability | Request IDs, allowlisted product telemetry, best-effort AI usage persistence and owner audit history; these are distinct stores, not a financial ledger |
| Billing | Exact integer-paise quotes, signature/payment-shape verification, funding-evidence checks and charge-observation SQL; managed-billing UI explicitly says not enabled |

The import scan found no application/script callers for the quote execution,
Razorpay verification or stored funding/charge assessment helpers. There is no
checkout/webhook money-flow endpoint in the route inventory. Funding assessment
results explicitly keep collection, transfers and provisioning disabled. These
are reusable foundations, not functioning customer payments.

The campaign worker is reached from its standalone script rather than app
imports. Security headers are reached from Next configuration. Neither should
be called dead code merely because it is outside the app import graph.

## Additional Boundaries

- The weekly spend display mixes forward weekly budget projection with latest
  insight snapshots. Snapshot dates are stored, but spend evaluation does not
  aggregate a defined current week. Reports likewise should not be mistaken
  for period-aligned financial statements. This is documented, not newly found.
- Monthly AI quotas are non-atomic preflight checks, not reserved spending
  capacity. Image costs, provider fallback/retries and failed telemetry writes
  need separate accounting. Brand autofill does not use the business quota and
  durable usage path used by creative generation.
- Creative image uploads precede row saves; deletion/regeneration does not
  implement a complete old-media cleanup lifecycle. Public Storage delivery
  remains public even though metadata and write policies are owner-scoped.
- Several ordinary reads map errors to empty data. The instruction case above
  is particularly consequential; empty dashboard/brand/inbox states also need
  to be distinguished from unavailable persistence.
- The composer is 1,499 lines, the Meta client 934, Studio 837 and Create 744.
  Recovery behavior differs across these surfaces. Extract around behavior and
  existing helpers when fixing defects; a broad rewrite is not the next milestone.
- Historical release/runbook claims are not current deployed evidence. For
  example, an operations troubleshooting row still describes a refresh insert
  error behavior that the current route/test now rejects explicitly.

## Verification Performed

| Check | Result |
| --- | --- |
| ESLint | Passed, no automatic fixes |
| TypeScript | Passed |
| Unit/component coverage | 143 files passed; 1 skipped. 1,718 tests passed; 1 paid test skipped |
| Coverage | Statements 80.82%; branches 74.17%; functions 80.26%; lines 83.14%; all configured gates passed |
| PostgreSQL | Fresh-install and ordered-upgrade harness passed, including tenant isolation, token restrictions, concurrency, operation leases and billing evidence |
| Production build | Passed with Turbopack in a temporary HEAD snapshot, cloned installed dependencies, placeholder public configuration and no environment files |
| Dependency advisories | `npm audit --audit-level=high`: zero reported vulnerabilities in the local dependency tree |
| Offline browser layout | Chromium and WebKit passed at 1440, 390 and 320px; textarea geometry, painted scrollbars, keyboard/resize behavior, conversation reader position and overflow |
| Behavioral probes | Reproduced paused children after activation and stale-spend cron success; verified concurrent-guard arithmetic and scheme-less creative-link payload |
| Editor diagnostics | Tailwind canonical-class suggestions only; no observed TypeScript/build blocker |

The first coverage attempt was interrupted by terminal-session reuse; the
reported figures are from the subsequent completed run. The database harness
initially failed to start under a scrubbed environment; `TMPDIR=/tmp npm run
test:meta-db` passed with the normal shell environment and its explicitly local
Unix-socket targets. No remote database was used. Missing Playwright browsers
were installed into a temporary directory for the offline checks.

Not verified: authenticated integrated Playwright workflows, hosted CI state,
historical Gitleaks scan (not installed locally), production deployment/migration
state, live customer OAuth, paid AI quality/cost, real ad delivery, a lead receipt
handoff, automatic Meta funding, gateway capture/refund or unit economics.
Existing environment files can point at production and were not used to force
those checks through.

## Product Priority

The latest owner decisions are in the existing
[Payments Plan](../PAYMENTS-PLAN.md) and [Roadmap](../ROADMAP.md): an annual
INR 10,000 package, INR 2,000 service allocation, INR 8,000 inclusive of Meta
taxes, automatic Meta payment and separate Solaride-owned customer ad accounts.
Current quote helpers still model a pre-tax base plus explicit additional tax;
they are not the approved annual checkout implementation.

Preserve the funding-first priority. Prove an eligible automatic billing route
with separately authorized owner consent and a bounded real reconciliation test;
do not substitute manual top-ups or an invented transfer API. Resolve tax,
gateway and refund terms before collection. The activation and spend findings
are gates before paid delivery, not a reason to build more generic billing
infrastructure ahead of funding feasibility. Validate one customer's complete
journey and actual service cost before expanding scope.