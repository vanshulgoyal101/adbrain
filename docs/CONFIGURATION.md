# Configuration Reference

Sources: [environment schema](../src/lib/env.ts), [example](../.env.example),
[rollout policy](../src/lib/meta/pilot-access.ts), and
[logging implementation](../src/lib/observability/logger.ts).
Verified against dev `672eb13`. Defaults below are source defaults, **not
production configuration**; the published `6291dc2` release excludes local test
checkout and DB-A-dependent changes. Deployment evidence belongs in the
[release receipt](qa/ops-environment-2026-09-26.md#o-11-sdk-and-query-release).

## Production Payment Candidate

Repaired integration `954e44a` adds the following server-only configuration beyond
the baseline below. It is disabled and unreleased; QA accepted the repair deltas
conditional on integrated CI. Live setup and financial prerequisites remain separate;
see the [separate rollout packet](qa/ops-environment-2026-09-26.md#separate-payment-integration-and-rollout-packet).
Deciding code: [production gate](../src/lib/payments/production-config.ts).

| Configuration | Requirement |
| --- | --- |
| `PAYMENTS_LIVE_ENABLED` | Defaults false; recovery/webhooks need explicit true plus all target/identity checks |
| `PAYMENTS_LIVE_COLLECTION_ENABLED`, `PAYMENTS_LIVE_POLICY_JSON` | Separate false-default collection flag; in #48, blank JSON selects the recorded `operator-managed-v1` offer. Explicit JSON must validate as approved operator terms or the legacy policy shape |
| `PAYMENTS_LIVE_REFUNDS_ENABLED` | Separate false-default refund flag; approved operator and per-operation authority still required |
| `RAZORPAY_LIVE_KEY_ID`, `RAZORPAY_LIVE_KEY_SECRET`, `RAZORPAY_LIVE_ACCOUNT_ID` | Explicit live identities; never reuse test credentials |
| `RAZORPAY_LIVE_WEBHOOK_SECRET`, `PAYMENTS_LIVE_WEBHOOK_ID` | Distinct secret and immutable configuration UUID; neither replaces signature/merchant checks |
| `PAYMENTS_LIVE_PROJECT_ID`, `PAYMENTS_LIVE_SUPABASE_URL` | Exact matches to `VERCEL_PROJECT_ID` and `NEXT_PUBLIC_SUPABASE_URL` |
| `NODE_ENV`, `VERCEL_ENV`, `VERCEL_GIT_COMMIT_REF`, `VERCEL_TARGET_ENV` | Production Node/Vercel/main; reject any explicit non-production target |

Test-payment flags/aliases must not coexist with live configuration. Populated
generic key aliases must exactly match the explicit live keys. Policy fields and
operator prerequisites are listed in the [author contract](qa/dev2-devc-contract-o1.md#schema-and-configuration-delta).
Do not enable these values as setup verification. CSP changes need an approved
rebuild. Suspend collection independently from recovery after live operations.

### Operator-Managed Offer

Issue #48 pins the [actual September 26 approval](https://github.com/vanshulgoyal101/adbrain/issues/48#issuecomment-5848530300)
in `OPERATOR_MANAGED_POLICY`: INR 10,000 total for 12 months, one business/offer/service
area, up to two creatives and one capped Meta campaign. It retains the 2,000/8,000
allocation, absorbed fees, no automatic renewal and the approved conditional refund
policy. Blank `PAYMENTS_LIVE_POLICY_JSON` selects this exact version only when live
collection is explicitly enabled; it does not enable collection by itself.

The operator pays Meta separately. No automatic-funding approval UUID, funding
evidence row or customer Meta connection is needed for this new mode. Do not invent
those records. Existing legacy JSON/orders remain distinct and recoverable.
Apply [the additive policy migration](../db/migrations/20260926_production_payment_policy_v2.sql)
after the original payment schema; do not change an applied migration checksum.
Future commercial changes require a new reviewed policy version and customer consent,
not edits to stored terms. Invoice wording claims no GST registration; verify actual
operator tax status in live invoice setup. Real charges/refunds remain separately scoped.

## Choose a Configuration Boundary

| Task | Required configuration | Side effects and target |
| --- | --- | --- |
| Mocked unit tests | Synthetic public Supabase values when the tested path parses the environment | Do not inherit provider credentials; tests are not provider acceptance |
| Authenticated local workspace | Isolated Supabase URL/public key, site origin and real local Auth session | Reads/writes the selected database; localhost does not imply a local backend |
| Generation | Workspace configuration, a configured text pool, selected image provider and server usage/limit support | Can incur text/image charges; token quota is not a cash limit |
| Meta connect and campaign work | Explicit rollout, app credentials, stable encryption key, server role and tenant binding | Consent/discovery contact Meta; creation and activation are distinct authorized actions |
| Campaign worker | Exact target origin, worker mode, server role and queue schema | Claims jobs and can create external campaign assets; not a health probe |
| Local payment tests | All test-payment gates below and the test-order schema | Calls Razorpay test APIs and writes local evidence, never advertising credit |
| Database event sink | Explicit logging flag, server role and product-events schema | Writes sanitized events; this flag does not create its tables |

### Loading and Secrets

The shared checkout's `.env.local` targets production. Do not overwrite, source,
copy or print it as setup. Use [Quick Start](QUICK_START.md) in an isolated checkout.
Next loads environment files; a standalone shell or Node script does not inherit
that behavior unless its command or implementation explicitly loads a file.
In particular, the browser npm scripts use `--env-file-if-exists=.env.local`.
Inspect the command before invoking it; "test" in its name is not isolation.

`getEnv()` validates lazily and caches per process. Restart after changes.
`NEXT_PUBLIC_*` values can be bundled into browser code and require a rebuild for
deployment changes. Never use that prefix for secrets. Empty strings are not
universally equivalent to missing values: omit optional numeric values instead
of leaving blank assignments.

| Classification | Variables | Handling |
| --- | --- | --- |
| Public application configuration | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, public feature flags | Browser-visible; public Supabase key is safe only with correct RLS |
| Privileged backend secret | `SUPABASE_SERVICE_ROLE_KEY`, `META_TOKEN_ENCRYPTION_KEY`, `CRON_SECRET` | Server/process only; never use public prefixes or expose through diagnostics |
| Provider secret | All four `*_API_KEYS` pools, `META_APP_SECRET`, `META_SYSTEM_USER_TOKEN`, `FALAI_API_KEY`, `OPENAI_API_KEY`, Razorpay key/webhook secrets | Can grant paid/external access; least privilege and target-specific storage |
| Identifier or policy | Model names, provider order, Meta app/config/account/Page IDs, Razorpay test key/account IDs, limits and rollout values | Not authentication secrets, but still avoid copying tenant/account details into examples |
| Login/test fixture material | `DEV_LOGIN_PASSWORD`, `DEMO_USER_PASSWORD`, `ADBRAIN_REVIEWER_PASSWORD`; associated email addresses | Passwords are secrets; emails may be personal data; use synthetic examples |

Generate/store secrets outside chat and command history. Changing credentials,
targets, encryption keys or paid provider settings is an operational action, not
documentation or release approval. See [release policy](RELEASING.md).

## Core Services

| Variable | Default / validation | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Required URL | Auth/database/storage project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required nonempty string | Public session key; relies on RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional in parser; empty becomes absent | Server admin, trusted usage/limits, tokens, jobs; required for those workflows |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000`, URL | Canonical origin and OAuth callbacks |
| `NEXT_PUBLIC_DEV_AUTH_BYPASS` | Empty; exact `true` outside production | UI identity fallback, not general API authentication |
| `DEV_LOGIN_EMAIL`, `DEV_LOGIN_PASSWORD` | Empty | Development login credentials |
| `DEMO_USER_EMAIL` | `demo@adbrain.vanshul.com`, email | Demo identity; not a sandbox guarantee |

## Live Checkout (Disabled By Default)

The server-only [live configuration](../src/lib/payments/production-config.ts)
requires `PAYMENTS_LIVE_ENABLED=true` and `PAYMENTS_LIVE_COLLECTION_ENABLED=true`
for collection, a production Vercel deployment from `main`, matching
`PAYMENTS_LIVE_PROJECT_ID`/`VERCEL_PROJECT_ID` and
`PAYMENTS_LIVE_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL`, and valid
`RAZORPAY_LIVE_KEY_ID`, `RAZORPAY_LIVE_KEY_SECRET`,
`RAZORPAY_LIVE_ACCOUNT_ID`, `RAZORPAY_LIVE_WEBHOOK_SECRET` and
`PAYMENTS_LIVE_WEBHOOK_ID`. Test credentials or test checkout enabled in
production block live checkout. Do not put provider secrets in the browser or
the repository. An unset `PAYMENTS_LIVE_POLICY_JSON` uses the approved
operator-managed terms; an explicitly supplied legacy policy still requires
its historical Meta funding evidence. Confirm the effective policy and webhook
registration before enabling collection. The payment schema must be migrated
first; code publication alone is not collection authorization.
`PAYMENTS_LIVE_REFUNDS_ENABLED=true` separately permits operator-initiated
refunds; reconciliation remains available while it is false. Hosting checks
also require `VERCEL_GIT_COMMIT_REF=main` and reject a nonproduction
`VERCEL_TARGET_ENV`. Generic `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` aliases,
if present, must match the live pair exactly.

Local test checkout uses `PAYMENTS_TEST_ENABLED=true` with
`RAZORPAY_TEST_KEY_ID`, `RAZORPAY_TEST_KEY_SECRET`,
`RAZORPAY_TEST_ACCOUNT_ID` and `RAZORPAY_TEST_WEBHOOK_SECRET` (or matching
generic key aliases). It is unavailable in production or any Vercel environment;
never place those test variables in live production configuration.

### Configurable Live Amounts

Source implementation, not a production-enable receipt. Apply the new
[pricing migration](../db/migrations/20260927_configurable_payment_quotes.sql)
after the payment policy and customer allowance migrations before deploying
these callers. All settings below are server-only; never use `NEXT_PUBLIC_`.
Changing Vercel Production environment values requires a new deployment.

| Variable | Default / validation | Purpose |
| --- | --- | --- |
| `PAYMENTS_LIVE_AMOUNT_PAISE` | Unset: `1000000`; integer 100-1000000 | Normal annual total; 100 paise = INR 1. Service receives floor(total/5), advertising the remainder |
| `PAYMENTS_LIVE_VERIFICATION_ENABLED` | Unset/empty/`false`: off; exactly `true`: on | Separate one-time real payment verification, not the annual service |
| `PAYMENTS_LIVE_VERIFICATION_AMOUNT_PAISE` | Unset: `1000`; integer 100-1000000 | Default and maximum selectable verification total, INR 10 by default; zero service/ad allocation |
| `PAYMENTS_LIVE_VERIFICATION_BUSINESS_ID` | Required UUID when enabled | Exact privately verified pilot business |
| `PAYMENTS_LIVE_VERIFICATION_USER_ID` | Required UUID when enabled | Exact authenticated owner of that business |
| `PAYMENTS_LIVE_VERIFICATION_EXPIRES_AT` | Required UTC ISO timestamp, at most 24 hours ahead | Expiry stops new verification checkout; saved-order recovery remains available |

For the INR 10 pilot, leave `PAYMENTS_LIVE_AMOUNT_PAISE=1000000`, set the
verification amount to `1000`, and enable verification only with the verified
owner/business IDs and a short expiry. Other owners receive the normal offer.
Do not lower the annual amount merely to test payment: an annual payment grants
its saved annual allocations. Amounts must be decimal digits without spaces,
decimals or exponent notation; blank amounts are invalid, while unset amounts
use their defaults. Invalid enabled verification configuration blocks collection.
The approved maximum remains INR 10,000; this setting cannot raise that ceiling.

The eligible pilot owner sees **Verification amount (INR)** in Billing before an
order is saved. Enter rupees with at most two decimal places, choose **Update
amount**, review the refreshed quote/terms, accept them and then choose **Pay**.
The input accepts INR 1 through the configured verification maximum; with the
pilot configuration above it defaults to INR 10 and cannot exceed INR 10.
Updating the quote creates no provider order or charge and requires no deployment.
The server rechecks owner, expiry, ceiling and consent on creation. Once an order
exists its amount cannot change; recovery uses its saved quote. The input is not
available for the normal annual package, other users, expired or completed tests.
If the quote update fails, payment stays disabled until the amount is restored or
a valid updated quote is received and accepted.

The normal default preserves the original quote and policy. Other totals produce
a versioned quote and matching service/refund terms, requiring fresh hash-bound
consent. Nondefault pricing or enabled verification cannot be combined with an
explicit `PAYMENTS_LIVE_POLICY_JSON` override. Stored amounts, quotes, consent and
identities are immutable. A changed configuration never reprices an old order or
permits creating a replacement for an unresolved order.

Verification creates at most one recoverable order per business, including after
a refund. A verified capture or expiry restores the normal quote on the next
order-list read; a stale open page must reload. Disable
`PAYMENTS_LIVE_VERIFICATION_ENABLED` and deploy after the test. Previous verification
captures/refunds remain visible; no automatic refund, renewal or Meta activation
occurs. Check the authenticated displayed quote and server/provider order amount
before the owner submits payment. Only the owner completes the real charge.

Keep a quote-aware runtime after any nondefault order exists: the old fixed-price
runtime cannot read those orders. Suspend collection and use a compatible
forward fix rather than deleting orders or undoing the migration.

## Local Test Payments

The [Razorpay test adapter](../src/lib/payments/razorpay-test.ts) validates these
settings separately from `getEnv()`. The gate denies production Node mode, every
Vercel environment and non-loopback Supabase URLs. Verify the actual local
database; a tunnel's loopback address does not prove isolation. Merchant account
activation is a separate provider fact, not permission to enable live collection.

| Variable | Default / validation | Purpose |
| --- | --- | --- |
| `PAYMENTS_TEST_ENABLED` | Disabled unless exactly `true` | Local test APIs, Settings checkout and scoped CSP allowances |
| `RAZORPAY_TEST_KEY_ID` | Required `rzp_test_` identifier when enabled; generic alias `RAZORPAY_KEY_ID` | Public test key; never use a live key |
| `RAZORPAY_TEST_KEY_SECRET` | Required nonempty server secret; generic alias `RAZORPAY_KEY_SECRET` | SDK authentication and callback HMAC |
| `RAZORPAY_TEST_ACCOUNT_ID` | Required `acc_` identifier | Expected test merchant identity |
| `RAZORPAY_TEST_WEBHOOK_SECRET` | At least 16 characters; different from key secret | Raw webhook HMAC; server-only |

The private test-order migration and real local Supabase login are also required.
Use one complete key pair; populated alias pairs must match exactly, and partial
or conflicting pairs fail closed. The public key comes from the order endpoint;
never prefix a secret with `NEXT_PUBLIC_`. Do not overwrite or use the production
environment file for QA. Restart `npm run dev` after configuration changes so the
page and CSP agree. Checkout is absent in Settings > Managed billing when the
gate fails. Mocked component tests need no provider credentials. See
[setup and limitations](PAYMENTS-PLAN.md#9-implementation-receipt) before using
provider test mode or exposing a webhook endpoint.

## Text Models

Key pools split commas, trim whitespace, and discard empty entries. Empty pools
disable the provider. Provider/model availability and pricing can change without
an application release.

| Variable | Default | Meaning / bounds |
| --- | --- | --- |
| `GOOGLE_AI_API_KEYS` | Empty | Google AI key pool |
| `GROQ_API_KEYS` | Empty | Groq key pool |
| `OPENROUTER_API_KEYS` | Empty | OpenRouter text and image pool |
| `CEREBRAS_API_KEYS` | Empty | Cerebras key pool |
| `LLM_PROVIDER_ORDER` | `google,groq,openrouter,cerebras` | Standard routing order |
| `LLM_BUDGET_PROVIDER_ORDER` | `groq,google,cerebras` | Budget routing; not a free-service guarantee |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Google model |
| `GROQ_MODEL` | `qwen/qwen3.8-27b` | Groq model |
| `OPENROUTER_MODEL` | `qwen/qwen3.8-max-0902` | OpenRouter text model |
| `CREATIVE_MAX_TOKENS` | `6000` | Integer 1800-16000 |
| `CREATIVE_REASONING_EFFORT` | `medium` | `minimal`, `low`, `medium`, `high` |
| `GEMINI_THINKING_HEADROOM` | `3000` | Nonnegative integer extra output headroom |
| `LLM_MONTHLY_TOKEN_LIMIT` | `2000000` | Nonnegative integer; 0 disables quota checking |

The parser does not validate live account quota or model availability. The
monthly limit is a per-business preflight check, **not an atomic reservation,
dollar budget, or image-cost cap**. See [AI Pipeline](AI_PIPELINE.md).

## Images

| Variable | Default | Meaning |
| --- | --- | --- |
| `IMAGE_PROVIDER` | `pollinations` | Implemented names: `pollinations`, `openrouter` |
| `IMAGE_PROVIDER_FALLBACK` | `none` | `none`/empty disables fallback; otherwise implemented provider name |
| `POLLINATIONS_MODEL` | `flux` | Pollinations model |
| `OPENROUTER_IMAGE_MODEL` | `openai/gpt-image-2.5-flare` | OpenRouter image model; requires OpenRouter keys |
| `AD_DESIGN_OVERLAY` | `true` | Exact `false` or `0` disables; other strings enable |
| `FALAI_API_KEY`, `OPENAI_API_KEY` | Empty | Reserved fields, not implemented image-provider selectors |

The [provider switch](../src/lib/imageGen/index.ts) rejects unknown names.
`IMAGE_PROVIDER=openai` or `falai` does not activate an adapter. Fallback must be
explicit; timeout/cancellation does not trigger fallback. Pollinations rejects
product-reference requests. Do not assume a fallback has equivalent fidelity or
lower cost.

## Meta

| Variable | Default | Meaning |
| --- | --- | --- |
| `META_APP_ID` | Empty | OAuth app identifier; not a secret |
| `META_APP_SECRET` | Empty | Server-only OAuth app secret |
| `META_LOGIN_CONFIG_ID` | Empty | Optional Facebook Login for Business configuration |
| `META_TOKEN_ENCRYPTION_KEY` | Empty | Base64 32-byte encryption key for token store |
| `META_CONNECT_ROLLOUT` | Unset | `disabled`, `pilot`, `enabled`; unset allows nonproduction only |
| `META_CONNECT_PILOT_USER_ID` | Unset | Exact app user allowed in pilot mode |
| `META_SYSTEM_USER_TOKEN` | Empty | Legacy/internal credential, not tenant publishing fallback |
| `META_AD_ACCOUNT_ID`, `META_PAGE_ID` | Empty | Legacy/internal assets, not a default binding for all owners |

Rollout variables are read directly, outside `getEnv()`. Unknown values deny
access; unset production rollout denies access. Register
`<NEXT_PUBLIC_SITE_URL>/api/meta/oauth/callback` with Meta. Start via Settings or
`/connect/meta`, not the retired OAuth-start endpoint.

Keep the encryption key stable while encrypted tokens exist. A new key cannot
decrypt old tokens; rotation requires a reviewed migration. See
[Meta Connection](META_CONNECT.md) for capabilities and recovery.

## Jobs and Internal Tools

| Variable | Default / bounds | Meaning |
| --- | --- | --- |
| `CRON_SECRET` | Empty disables cron routes with 404 | Scheduled request Bearer secret |
| `CAMPAIGN_EXECUTION_MODE` | Unset/`inline` for compatibility; `worker` opts in | Web enqueue vs synchronous creation; unknown nonempty values block creation |
| `CAMPAIGN_WORKER_TARGET` | Required by standalone worker | Exact Supabase URL origin, explicitly confirms worker target |
| `TRAFFIC_GENERATOR_ALLOWED_EMAILS` | Empty list | Production: disabled; nonproduction: any signed-in user when empty |
| `TRAFFIC_GENERATOR_MAX_ROUNDS` | `20`, integer 1-100 | Internal runner round cap |

The current internal HTTP runner rejects `createDraftCampaigns=true` with 400;
it performs provider reads only. Historical standalone scripts can differ and
must be reviewed separately. It is not a general health check or a guarantee of
Meta review approval. [Vercel](../vercel.json)
schedules keepalive and spend enforcement at `0 6 * * *` (06:00 UTC daily).
Spend enforcement is not a real-time budget stop.

## Observability

| Variable | Behavior |
| --- | --- |
| `PRODUCT_LOGGING_ENABLED` | Exact `false` disables product events; otherwise enabled |
| `PRODUCT_LOGGING_DATABASE_ENABLED` | Only exact `true` enables DB sink; migration required first |
| `NEXT_PUBLIC_PRODUCT_LOGGING_ENABLED` | Exact `false` disables browser telemetry; also respects DNT/GPC |
| `VERCEL_ENV` | Hosting environment classification |
| `VERCEL_GIT_COMMIT_SHA` | Release identifier, accepted only as a bounded hexadecimal SHA |
| `NODE_ENV` | Framework environment controlling production safeguards |

See [Observability](OBSERVABILITY.md) for event contracts, privacy, retention, and
database-sink prerequisites. Do not enable the sink before the migration.

## Script Configuration

The example includes `DEMO_USER_PASSWORD`, `ADBRAIN_REVIEWER_EMAIL`,
`ADBRAIN_REVIEWER_PASSWORD`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY` for specific
seed/review scripts. They do not replace runtime variables. Operational scripts
may require additional guards; inspect the exact script before execution.

`APP_URL` / `ADBRAIN_URL` are script-origin overrides, not aliases for the app's
canonical site URL. PostgreSQL tooling uses its own `PGHOST`, `PGPORT`,
`PGDATABASE`, `PGUSER`, `PGPASSWORD` and optional `PGSSLROOTCERT`; see
[Deployment](DEPLOY.md). Browser/evaluation harness overrides and paid-evaluation
opt-ins belong to [Testing](TESTING.md), not a production environment template.

### What the Doctor Actually Checks

[env-doctor.sh](../scripts/env-doctor.sh) checks whether legacy traffic/reviewer
variables are set in the **current shell**. It does not load `.env.local`, parse
`getEnv()`, contact a provider, verify a token, test RLS or check the database.
It can fail for an otherwise valid ordinary application setup because it expects
traffic-runner credentials. Its output shows set/missing names, not values;
keep even that configuration inventory private.

```sh
npm run env:doctor
npm run env:doctor:strict
```

Strict mode also fails on absent recommended variables. These commands do not
authorize populating production credentials or executing the scripts they check.
Ignore any generic copy-environment suggestion when an environment file exists.

### Local Launcher Modes

[local-meta-qa.mjs](../scripts/local-meta-qa.mjs) obtains an existing local
Supabase project's status through the `adbrain-qa` Colima socket and rejects
non-loopback API/database URLs. It reads `.env.local` to clear inherited names;
most modes replace provider credentials with empty/synthetic values. This is
not an OS network sandbox, and a loopback tunnel is not proof of a local target.

| Mode | Additional behavior |
| --- | --- |
| `setup` | Applies the full schema and creates local Auth/business/creative fixtures; destructive-risk setup, not a check |
| `dev`, `build`, browser modes | Run their mapped command against that local project; normal dev binds using Next defaults on port 3939 |
| `oauth-dev` | Copies actual Meta app credentials from `.env.local`; this is real-provider work requiring its own authorization |
| `payments-dev` | Reads `.env` test credentials, enables test checkout/dev login, derives a local webhook secret if absent, binds 127.0.0.1:3939 and disables product logging |

Do not use a mode as an environment inspector: the launcher immediately runs it.
The supported command mapping, rather than its error-message list, is authoritative.
Own the local project, server and generated fixtures before starting any mode;
stop only processes you started. No launcher action is required to read this guide.