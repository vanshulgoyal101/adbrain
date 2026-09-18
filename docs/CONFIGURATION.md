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