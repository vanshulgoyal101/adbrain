# Developer Quick Start

This is the installation guide. Historical Meta review preparation is not an
installation prerequisite or a guarantee of approval. See the
[documentation index](README.md) for product usage and deeper references.

## Prerequisites

- Node.js 22.13 or newer on the Node 22 line, and npm. Earlier Node 22 releases
  do not meet all current lint dependency engine requirements.
- An isolated Supabase project with Auth, Postgres, and Storage.
- Optional model credentials for AI; optional Meta credentials for connections.
  Neither is needed for the mocked unit suite.
- Local PostgreSQL binaries for database integration tests; see
  [Testing](TESTING.md).

## Install and Configure

From the repository root:

```sh
npm ci
cp .env.example .env.local
```

Set these to an **isolated development project**, not production:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-DEV-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-DEV-PUBLIC-KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR-DEV-SERVER-KEY
NEXT_PUBLIC_SITE_URL=http://localhost:3000
IMAGE_PROVIDER=pollinations
IMAGE_PROVIDER_FALLBACK=none
PRODUCT_LOGGING_DATABASE_ENABLED=false
```

These are placeholders. Keep `.env.local` out of Git. The public key relies on
RLS; the service-role key bypasses RLS and must never reach a browser. Review
[Configuration](CONFIGURATION.md) before adding provider credentials. Configuring
image generation does not prove it is free or available.

## Prepare the Database

For a **fresh** development project, review and apply [the schema](../db/schema.sql)
using the project's SQL tools. For an existing database, follow
[Data Model](DATA_MODEL.md); do not casually replay the fresh schema.

`npm run db:push` is a mutation command, not a prerequisite checker. Verify the
target, backup plan, and authorization first. This workspace's `.env.local` may
point at production. A localhost web server does not isolate the backend.

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