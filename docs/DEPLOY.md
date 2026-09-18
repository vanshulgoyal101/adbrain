# Deployment Setup

AdBrain needs a dynamic Node/Next.js host, Supabase Auth/Postgres/Storage, and
explicit provider configuration. It is not a static export. The canonical
production origin is `https://adbrain.vanshul.com`; this guide describes setup,
not verification of the current remote deployment. For publishing changes, follow
[Release Workflow](RELEASING.md), which takes precedence over this checklist.

## 1. Establish the Target

Identify the exact Vercel project, Git branch, Supabase project, site origin,
provider accounts, and owner approving the change. Verify credentials without
printing them. A preview deployment is not an isolated database. The checked-in
Git deployment rules enable only `main` with a wildcard disabled rule; inspect
effective remote settings before any branch push or environment change.

Use supported Node 22 (22.13+ with the current lint dependency graph), install with
`npm ci`, and keep framework build/output defaults unless a reviewed change needs
otherwise. Configure adequate Node runtime duration and memory for generation;
declaring `maxDuration` in a route does not override hosting-plan limits.

## 2. Prepare Database and Storage

For a new isolated installation, review [schema.sql](../db/schema.sql). For an
existing installation, inventory applied migrations and follow the
[migration map](DATA_MODEL.md#migration-map). Repeated DDL is not inherently safe:
grants, policies and functions can change even when tables already exist.

`npm run db:push` writes to the configured database. It is **not** a routine
deployment prerequisite to run blindly. Obtain explicit migration approval,
verify target, backup/compatibility, and local fresh/upgrade tests first. No
production credentials are required for `npm run test:meta-db`.

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

Run required local/CI gates on the dependency-complete release. Promote through
the protected `main` PR workflow and verify hosting success for the resulting
merge SHA. Do not use a direct production CLI deploy to bypass checks.

After an authorized deployment, verify:

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

## 6. Scheduled Jobs and Rollback

Both cron endpoints run daily at 06:00 UTC in source configuration. Enforcement
uses stored spend and can pause ads; keepalive can prune old product events.
See [Operations](OPERATIONS.md#scheduled-jobs) for authentication, timing limits,
partial results, and monitoring. A cron declaration does not prove a job ran.

Choose a previously verified compatible build for rollback. Preserve schema and
key compatibility; code rollback cannot reverse remote ads, restore deleted data,
or decrypt tokens encrypted under a lost key. Record the exact deployment,
migration state, smoke evidence, rollback result and remaining external gates.
