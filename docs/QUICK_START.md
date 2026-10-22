# Developer Quick Start

Install a development checkout without touching production or starting paid work.
This guide describes dev source at `672eb13`; the production release at `6291dc2`
excludes the DB-A changes and local test checkout. See the
[release receipt](qa/ops-environment-2026-09-26.md#o-11-sdk-and-query-release).

**Do not follow environment-copy instructions in the shared working checkout.**
Its existing `.env.local` targets production. Use a separate checkout and isolated
credentials; a localhost URL does not isolate the backend. Historical Meta review
preparation is not an installation prerequisite or proof of approval.

## Prerequisites

- Node.js 24 and npm, matching the [CI runtime](../.github/workflows/ci.yml).
   Next.js alone permits older Node versions; that is not the tested requirement
   for this dependency set. Use the committed lockfile, not fresh package versions.
- An isolated Supabase project with Auth, Postgres, and Storage.
- Optional model credentials for AI; optional Meta credentials for connections.
  Neither is needed for the mocked unit suite.
- Local PostgreSQL binaries for database integration tests; see
  [Testing](TESTING.md).

## Install and Configure

In a new, isolated checkout, inspect the branch and install locked dependencies:

```sh
git status --short --branch
node --version
npm ci
test ! -e .env.local && cp -n .env.example .env.local
```

`npm ci` downloads packages, runs their installation scripts and replaces that
checkout's `node_modules`. Do not run it in another worker's checkout. The copy
command intentionally does nothing when `.env.local` already exists; inspect its
ownership and target privately rather than overwriting it. Never copy environment
files from the shared checkout or put credentials in a command transcript.

Set these to an **isolated development project**, not production:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-DEV-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-DEV-PUBLIC-KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR-DEV-SERVER-KEY
NEXT_PUBLIC_SITE_URL=http://localhost:3000
IMAGE_PROVIDER=openrouter
IMAGE_PROVIDER_FALLBACK=none
PRODUCT_LOGGING_DATABASE_ENABLED=false
PAYMENTS_TEST_ENABLED=false
```

These are placeholders, not a runnable backend or provider entitlement. Leave
model, Meta and payment keys absent until their workflow is authorized. The image
setting selects an adapter; it does not make generation free. Keep `.env.local`
out of Git. The public key relies on
RLS; the service-role key bypasses RLS and must never reach a browser. Review
[Configuration](CONFIGURATION.md) before adding provider credentials. Configuring
image generation does not prove it is free or available.

## Prepare the Database

For a **fresh, disposable** development project, review
[the schema](../db/schema.sql) and the [database procedure](DEPLOY.md).
For an existing database, review incremental migrations and its actual migration
ledger. Do not replay the fresh schema or infer missing migrations from filenames.
The [data model](DATA_MODEL.md) explains the objects; [release policy](RELEASING.md)
governs permission to change them. Preparing a schema is a separate mutation step,
not an install command or approval to update production.

`npm run db:push` is a mutation command, not a prerequisite checker. Verify the
target, backup plan, and authorization first. This workspace's `.env.local` points
at production. A localhost web server does not isolate the backend.

## Configure Authentication

In the isolated Supabase project, set the site URL and allowed redirects,
including `http://localhost:3000/auth/callback`. Google requires provider setup;
email delivery depends on Supabase mail configuration. Password login needs an
existing account/password; the app does not supply signup or password-reset UI.

Magic links and OAuth complete through `/auth/callback`. Password sign-in uses a
validated local destination. External, protocol-relative, backslash, and
control-character redirects fall back to `/dashboard`.

The development bypass requires `NODE_ENV !== "production"` and
`NEXT_PUBLIC_DEV_AUTH_BYPASS=true`. It is a UI convenience, not real API
authentication. Most API routes still require a Supabase user. Never enable it
in a deployment.

## Run and Verify

```sh
npm run dev
# Open http://localhost:3000/login
```

Use `npm run dev -- --port 3941` for another port. Do not run multiple Next dev
servers in the same checkout. Stop temporary validation servers when finished.
First verify login and a saved Brand Brain. Do not generate ads or connect a real
ad account merely to prove the page renders.

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Local tests do not prove email delivery, real consent, provider quality, or
production deployment. Browser scripts can sign in to the configured backend;
read [Testing](TESTING.md) before invoking them.

## Enable Workflows Deliberately

1. Add a text key pool and explicitly select an image provider. Set provider-side
   billing limits before authorizing generation.
2. Save the business profile, assets, and instructions.
3. Review a brief in Create, authorize a small generation batch, then approve
   creatives separately.
4. Configure Meta credentials, rollout, and the environment's encryption key.
   Connect in Settings and verify account/Page identity.
5. Save a campaign draft, inspect preflight, and create paused only when intended.
   Activation is a separate spending decision.

## Troubleshooting Setup

| Symptom | Check |
| --- | --- |
| Environment validation fails | Required URL/key and numeric bounds; restart after edits |
| Login loops | Supabase callback allowlist, cookies, account, provider setup |
| UI works but API returns 401 | Development bypass is not real authentication |
| AI returns 503 before starting | Usage RPC, service role, schema availability |
| Image provider fails | Image and text configuration differ; unsupported provider names fail |
| Meta disabled in production | Explicit rollout and app configuration; unset rollout fails closed |
| Connected but cannot read leads | Lead capability, Page token, form access, `leads_retrieval` |

See [Operations](OPERATIONS.md) for incidents and [Release Workflow](RELEASING.md)
for publication. Do not use a direct production CLI deploy as a setup shortcut.