# Configuration Reference

Sources: [environment schema](../src/lib/env.ts), [example](../.env.example),
[rollout policy](../src/lib/meta/pilot-access.ts), and
[logging implementation](../src/lib/observability/logger.ts).
Defaults below are source defaults, **not production configuration**.

`getEnv()` validates lazily and caches per process. Restart after changes.
`NEXT_PUBLIC_*` values can be bundled into browser code and require a rebuild for
deployment changes. Never use that prefix for secrets. Empty strings are not
universally equivalent to missing values: omit optional numeric values instead
of leaving blank assignments.

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
| `META_APP_ID`, `META_APP_SECRET` | Empty | Server-side OAuth app credentials |
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

`npm run env:doctor` and `npm run env:doctor:strict` inspect configuration, not
end-to-end provider readiness. Keep diagnostic output private. A passing doctor
check does not authorize seeds, backfills, paid evaluations, or remote writes.