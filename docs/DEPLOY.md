# Deployment Setup

Use this runbook to prepare a target and verify a deployment. Authorization and
promotion rules live in [Release Workflow](RELEASING.md); configuration defaults
live in [Configuration](CONFIGURATION.md). AdBrain requires a dynamic Node/Next.js
host and Supabase Auth/Postgres/Storage, not a static export.

Source reference: dev `672eb13`. Last verified production: `6291dc2`, canonical
`https://adbrain.vanshul.com`, Node 24.x, hnd1, from
[PR #36's receipt](qa/ops-environment-2026-09-26.md#o-11-sdk-and-query-release).
This is evidence for that release, not a live status monitor. DB-A-dependent
callers, their migrations and local test checkout were excluded from production.

| Target | Safe starting point | Do not assume |
| --- | --- | --- |
| Disposable local | Isolated checkout, explicitly identified local database and synthetic Auth/data | Loopback cannot be a tunnel to production; a demo label is not isolation |
| Hosted nonproduction | Independently configured credentials, data and provider accounts, only if separately authorized | A Vercel preview automatically has a preview database or safe keys |
| Production | Exact approved release subset, schema compatibility and rollback, protected main PR | A passing dev build authorizes every dev feature or a migration |

## 1. Establish the Target

Identify the exact Vercel project, Git branch, Supabase project, site origin,
provider accounts, and owner approving the change. Verify credentials without
printing them. A preview deployment is not an isolated database. The checked-in
Git rules use `**: false` with `main: true`, `dev: false` and the pilot branch
disabled. Single-star `*` does not cover slash-containing branches. Inspect the
candidate rules and hosted environment scope before publication; verify observed
suppression afterward. Preview SSO and absent preview credentials are separate
controls, not consequences of JSON.

Use Node 24, matching CI and verified production, install with `npm ci` in the
target's own checkout, and keep framework build/output defaults unless a reviewed
change requires otherwise. Configure adequate Node runtime duration and memory for generation;
declaring `maxDuration` in a route does not override hosting-plan limits.

The build/start contract is `npm run build`, then `npm start` on a Node host.
Next loads its environment during build/runtime; standalone worker/migration
scripts require explicitly supplied environment. Never copy the shared checkout's
production `.env.local` into a new target. For temporary local validation, use
`npm run dev` so the configured 1536 MiB heap limit applies; reuse an owned healthy
server and stop only the server you start. Do not contend for another worker's
checkout, `.next`, port or database.

### Runtime Placement and Workspace Loading

**Historical performance/design receipt, September 18.** The measurements and
pre-deployment statements in this subsection and Action Latency Controls below
describe that work, not current rollout status. The verified September 26 release
already runs in hnd1. Preserve these observations without extrapolating a speedup.

The checked-in Vercel region is `hnd1` (Tokyo), colocated geographically with
AdBrain's Supabase project in `ap-northeast-1`. On 2026-09-18, before this change
was deployed, the live project still used `iad1` (Northern Virginia). Each
sequential database round trip therefore crossed regions. The region change
requires the normal protected release; editing this file or `vercel.json` does
not change the running deployment.

The server Supabase client, verified-user lookup, business list, and campaign
list use React request-scoped memoization. Layout and page reads share work
within one server render, not across users or requests. Route handlers and
actions must not depend on React render memoization for correctness. RLS,
server authentication, and the dynamic router freshness policy remain intact.
Studio loads independent reads concurrently. Campaigns renders saved data
without waiting for Meta; connected campaign setup loads lead forms on demand,
supports retry, and cancels its request when closed. A returned form is not
automatically selected. Creation still requires the existing server preflight.

Before releasing a region change, verify the current database region and the
host's allowed regions. After release, confirm the effective function region in
deployment metadata and repeat authenticated page timings with the same account,
device, and network, distinguishing cold from warm requests. Measure complete
responses as well as time to first byte; a streamed loading shell is not a
completed page. Do not invoke generation, campaign sync, results refresh, or
spend enforcement as a latency probe.

The pre-change single-request sample for Create, Brand Brain, Studio, and
Settings was respectively 2.24s, 1.63s, 1.39s, and 1.99s for complete production
HTML responses. This is a diagnostic baseline, not a percentile benchmark or a
measured improvement. Local validation covered all eight workspace sections at
1440px and 390px, with mutations blocked; connected form loading and retry were
component-tested. Production improvement must be measured after deployment.

### Action Latency Controls

**Historical local evidence, September 18; not a setup checklist.**
The second local performance pass removes additional work from interactive paths:

- Home and Assets read only the five creative preview fields they render. Studio
  retains full creative details. An authenticated, read-only comparison of 29
  creatives returned 16,570 rather than 43,205 JSON bytes (62% smaller), with
  identical preview fields. This measures database response size, not page speed.
- Campaign results use an embedded, newest-first child query limited to one row
  per matching campaign, rather than downloading history to discard older rows.
  A read-only comparison matched existing latest results. Query errors still
  fail closed; this does not remove PostgREST's parent-row limits.
- Lead sync reads forms in batches of three, retaining ordered processing and
  partial-failure reporting. Each credentials-bound Meta client shares one Page
  token lookup; a failed lookup is cleared for retry. Tokens are not cached
  globally or shared across clients.
- Location search cancels superseded requests through the server's Meta call.
  Successful results have a component-local 60-second cache capped at 20 queries.
  Campaign reconnect leaves form fetching to the composer effect, avoiding a
  duplicate request. Navigation icons show pending transitions without resizing.
- Audit logging reuses an already verified actor only inside the current event
  context, not for authorization. Best-effort audit and usage inserts have
  three-second request deadlines; failures remain logged, not guaranteed durable.
  Quota reads remain required and fail closed.
- Results refresh verifies persistence before starting independent summary,
  spend enforcement, and audit work together. Optional AI summaries receive a
  five-second cancellation signal and retain their factual metrics fallback.
  Enforcement remains awaited and is never bypassed for a faster response.
- Generation and regeneration load instructions and references concurrently.
  Inline generated images are reused for composition instead of downloading the
  new Storage upload. Raster validation remains in place; URL-based generators
  still compose from the stored photo to avoid a second generation request.

Local evidence on 2026-09-18: 1,250 tests passed and one opt-in live test was
skipped; coverage thresholds, lint, TypeScript, and the 54-page production build
passed. The final URL-provider compatibility adjustment passed all 33 focused
generation/raster tests. Browser checks covered eight sections at 1440px and
390px, repeated-query cache reuse, location selection, and soft navigation with
no page errors or horizontal overflow. Browser writes were blocked; images and
location responses were fixtures. Connected form behavior was component-tested
because the local test account was disconnected. Temporary servers were stopped.
No paid generation, Meta mutation, migration, or deployment was performed. These
checks do not certify every live-provider action or production latency.

## 2. Prepare Database and Storage

Choose one path before running SQL. Neither path loads `.env.local` automatically.

| Path | Command | Effect |
| --- | --- | --- |
| Fresh disposable database | `npm run db:push` | Applies the entire schema in a transaction; rejects non-loopback hosts |
| Review one incremental migration | `npm run db:migrate -- --migration 20260919_campaign_reporting_identity.sql` | Prints filename and SHA-256; no database connection without `--apply` |
| Approved incremental application | Same named command with `--apply` and, for remote targets, exact `--target` | Connects, serializes changes and records the immutable checksum |
| Disposable SQL verification | `npm run test:meta-db` | Starts its own PostgreSQL harness for fresh and ordered-upgrade checks, not the configured production database |

For fresh local setup, review [schema.sql](../db/schema.sql), confirm the target
is genuinely disposable and supply `PGHOST`, `PGDATABASE`, `PGUSER`, the actual
`PGPORT` and private authentication. `PGPORT` defaults to 5432 when omitted;
set it explicitly to avoid ambiguity. The full-schema tool rejects remote hosts,
but cannot detect a loopback tunnel to production. Repeated DDL can change grants,
policies and functions even when tables already exist; do not use it for upgrades.

For an existing target, compare actual schema and `private.schema_migrations`
with the [migration map](DATA_MODEL.md#migration-map). Historical objects may
predate the ledger. Missing ledger entries do not authorize replaying the folder.
Preview the one reviewed file first. Application is a separate approved action:

```sh
# Example identity only; supply approved PG* values privately before application.
npm run db:migrate -- --migration 20260919_campaign_reporting_identity.sql --target 'db.example.invalid:5432/app@migration_operator' --apply
```

The remote confirmation must equal `PGHOST:PGPORT/PGDATABASE@PGUSER`. Remote TLS
certificate verification is mandatory; `PGSSLROOTCERT` can supply a CA file.
Insecure `PGSSLMODE` values are rejected, not workarounds. Passwords must not go
into shell history, repository files or tickets. The runner uses a transaction,
an advisory lock, a 5-second lock timeout and a 60-second statement timeout.
Matching applied checksums skip work; changed checksums fail. Add a new migration
instead of editing history. A failure rolls back the transaction; inspect the
state before retrying, especially after an ambiguous connection failure.

Before approved rollout: backup/restore readiness, production data preflight,
dependency ordering, compatible web/worker revision and a rollback floor must be
known. DB-A grant revocations and trusted-write callers require coordinated
deployment/quiescence; do not apply one side while incompatible callers run.
The [DB-A handoff](qa/db-a-dev-a-handoff-2026-09-26.md) carries this deferred
rollout, and documentation work does not approve it.

Sources: [full-schema tool](../scripts/apply-schema.mjs),
[migration CLI](../scripts/migrate-db.mjs),
[target/transaction guards](../scripts/database-migrations.mjs).

Verify quota aggregation and trusted rate-limit RPCs, encrypted connection
storage, campaign operations, generation receipts, and public media buckets.
Enable the optional product-event database sink only after its migration. A
missing quota read is not treated as permission for unlimited generation.

## 3. Configure Secrets and Public Values

[Configuration](CONFIGURATION.md) is the complete variable/default reference.
Minimum deployment groups:

| Group | Required decision |
| --- | --- |
| Supabase | Correct public URL/key; server-only service-role key for trusted operations |
| Site | Canonical `NEXT_PUBLIC_SITE_URL`; public values are baked into builds |
| Auth | Supabase site URL, exact `/auth/callback`, enabled login providers and email delivery |
| Text models | Available key pools, explicit order/models, provider-side spending controls |
| Images | Explicit primary provider/model and `IMAGE_PROVIDER_FALLBACK=none` unless an evaluated fallback is deliberately approved |
| Meta | App ID/secret, Login for Business config ID, stable 32-byte base64 encryption key, explicit rollout mode |
| Jobs | Strong server-only `CRON_SECRET`; scheduled-job monitoring owner |
| Telemetry | Console/client flags; database sink off until migrated and retention understood |

Never set development bypass or demo password credentials in production. Do not
copy production secrets into Preview automatically. Never expose service-role,
provider, cron, or encryption secrets via `NEXT_PUBLIC_*` variables.

The paid OpenRouter adapter already exists. Model names are configuration, not a
guarantee of account availability or current pricing. Test with bounded explicit
authorization; do not use a production deployment as an unbudgeted benchmark.
Pollinations is not an equivalent fallback for reference-guided product imagery.

## 4. Configure Identity and Domain

Add the custom domain to the host and use the DNS records it currently specifies.
Confirm HTTPS, canonical redirects, and the configured Supabase origin in CSP.
Do not replace allowlists with `*` to work around configuration mistakes.

In Supabase, set the site URL and allow the exact application `/auth/callback` for
magic links/Google sign-in. In the Google provider console, use the callback
required by Supabase's provider setup, not an invented direct application route.

In Meta, configure the exact `/api/meta/oauth/callback`, appropriate application
domains, privacy/deletion URLs, Login for Business settings and permissions. Follow
[Meta Connect](META_CONNECT.md) and [Approval Readiness](META_APPROVAL_ACTION_PLAN.md).
An AdBrain login smoke test does not verify this second authorization flow.

## 5. Validate and Promote

Assemble the dependency-complete subset against current main. Reuse matching
author/QA evidence; let required CI validate changed assembled inputs. Do not
repeat completed full suites just to rewrite a receipt. Promote through the
protected main PR and verify the resulting merge SHA, not merely the branch name.
Never use a direct production CLI deploy to bypass checks.

For a new target, verify all relevant items below. For an ordinary release,
scope the smoke to the changed workflow and its meaningful dependencies:

- Public homepage, legal routes, guide pages, sitemap/robots/manifest/social image.
- Expected production security headers and CSP behavior with real origins.
- Real authentication and owner-scoped reads; no development bypass.
- Correct schema/RPC access, public asset rendering and existing saved content.
- Exact affected workflow with approved fixtures and side-effect limits.
- Job configuration and logs, without manually invoking mutating enforcement
  merely to get HTTP 200.
- Telemetry correlation and redaction; no credential/personal-data leakage.

Paid generation, real consent, campaign creation and activation each need their
own evidence and authorization. A homepage HTTP 200 proves none of them.
Use a real authenticated session without exposing cookies or credentials. Read
the page's mount behavior first: Campaigns can auto-sync on load. If the smoke
must be read-only, block mutations before navigation and disclose the fixture
boundary. A streamed loading shell is not successful hydration or working filters.

## 6. Scheduled Jobs and Rollback

Both cron endpoints run daily at 06:00 UTC in source configuration. Enforcement
uses stored spend and can pause ads; keepalive can prune old product events.
See [Operations](OPERATIONS.md#scheduled-jobs) for authentication, timing limits,
partial results, and monitoring. A cron declaration does not prove a job ran.

Choose a previously verified compatible build for rollback. Preserve schema and
key compatibility; code rollback cannot reverse remote ads, restore deleted data,
or decrypt tokens encrypted under a lost key. Record the exact deployment,
migration state, smoke evidence, rollback result and remaining external gates.
