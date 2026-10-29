# Configuration Reference

Part of [Operations](README.md). Live checkout and payment amounts: [Payments configuration](configuration-payments.md).

Sources: [environment schema](../../src/lib/env.ts), [example](../../.env.example),
[rollout policy](../../src/lib/meta/pilot-access.ts), and
[logging implementation](../../src/lib/observability/logger.ts).
Defaults below are source defaults, **not production configuration**.

`getEnv()` validates lazily and caches per process. Restart after changes.
`NEXT_PUBLIC_*` values can be bundled into browser code and require a rebuild for
deployment changes. Never use that prefix for secrets. Empty strings are not
universally equivalent to missing values: omit optional numeric values instead
of leaving blank assignments.

## Loading and Secrets

The owner checkout's `.env.local` targets production. Do not overwrite, source,
copy or print it as setup. Next loads environment files; a standalone shell or
Node script does not unless its command loads one. `test:workspace-browser` and
`test:workspace-ux` use `--env-file-if-exists=.env.local`, and the campaign
worker loads none. Inspect a command before running it; "test" in its name is
not isolation.

| Classification | Variables | Handling |
| --- | --- | --- |
| Public application configuration | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, public feature flags | Browser-visible; the public Supabase key is safe only with correct RLS |
| Privileged backend secret | `SUPABASE_SERVICE_ROLE_KEY`, `META_TOKEN_ENCRYPTION_KEY`, `META_PARENT_SYSTEM_TOKEN`, `CRON_SECRET` | Server/process only; never use public prefixes or expose through diagnostics |
| Provider secret | All four `*_API_KEYS` pools, `META_APP_SECRET`, `META_SYSTEM_USER_TOKEN`, `FALAI_API_KEY`, `OPENAI_API_KEY`, Razorpay key/webhook secrets | Can grant paid/external access; least privilege and target-specific storage |
| Identifier or policy | Model names, provider order, Meta app/config/account/Page IDs, Razorpay key/account IDs, limits and rollout values | Not secrets, but keep tenant/account details out of examples |
| Login/test fixture material | `DEV_LOGIN_PASSWORD`, `DEMO_USER_PASSWORD`, `ADBRAIN_REVIEWER_PASSWORD` and their emails | Passwords are secrets; emails may be personal data; use synthetic examples |

Generate and store secrets outside chat and command history. Production
settings, credentials and encryption keys are DevOps-owned changes; see the
[release policy](../RELEASING.md#startup-fast-path).

## Core Services

| Variable | Default / validation | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Required URL | Auth/database/storage project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required nonempty string | Public session key; relies on RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional in parser; empty becomes absent | Server admin, trusted usage/limits, tokens, jobs; required for those workflows |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000`, URL | Canonical origin and OAuth callbacks |
| `SUPPORT_WHATSAPP` | empty, phone number | The owner's business WhatsApp for the in-app **Help on WhatsApp** link (#796), pre-typed with the business name. Public number, not a secret; empty hides the link |
| `NEXT_PUBLIC_SUPPORT_WHATSAPP` | Empty; phone number with country code | Homepage "Questions? WhatsApp us" link (`wa.me`); hidden while empty. Needs a rebuild |
| `ALERTS_WHATSAPP` | empty, phone number | AdBrain's own WhatsApp Business number for owner alerts (#701). Owners confirm their number by sending it "START <code>"; empty hides Settings → WhatsApp alerts. Public number, not a secret |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | empty, random string | The `hub.verify_token` for subscribing `/api/whatsapp/webhook` to that number's WABA in Meta (#701). Subscribe the `messages` and `template_category_update` fields; without the second, a template Meta makes MARKETING keeps sending (#1139). POSTs are checked with `META_APP_SECRET` |
| `FONTCONFIG_FILE` | Set at runtime by the ad renderer; don't configure | Points fontconfig at `src/lib/creative/fonts` only, so Hindi/Punjabi shaping is identical on every server (#300) |
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
| `CREATIVE_PROVIDER_ORDER` | Unset (uses `LLM_PROVIDER_ORDER`) | Create concept routing; each attempt gets `CREATIVE_ATTEMPT_TIMEOUT_MS` before the next provider |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Google model |
| `GROQ_MODEL` | `qwen/qwen3.8-27b` | Groq model |
| `OPENROUTER_MODEL` | `anthropic/claude-haiku-5.5` | OpenRouter text model; a comma list is tried in order. Oct 21 Create bake-off: Haiku 5.5 saved 6/6 at 13-15 s per concept; qwen3.8-max took 65-90 s |
| `CREATIVE_MAX_TOKENS` | `6000` | Integer 1800-16000 |
| `CREATIVE_REASONING_EFFORT` | `medium` | `minimal`, `low`, `medium`, `high`. Haiku at `low` (#713, Oct 26): concept call 8.9–13.4 s vs 13.2–17.7 s at `medium`, judge copy 4.33 vs 4.39, first-try 8/9 |
| `CREATIVE_ATTEMPT_TIMEOUT_MS` | `90000` | Integer 15000-120000; per Create concept attempt. The 90 s default fits qwen3.8-max (65-90 s). With a faster model set 60000: three concepts that each answer just before the limit, plus the last image, then fit the 270 s Create deadline (`test:core`) |
| `CREATIVE_CONCEPT_SCHEDULE` | `serial` | `serial` or `parallel`. `parallel` starts all Create concept calls at once; each still validates against earlier concepts (repeated headline/opening → normal repair). #142 measure on Haiku, 3 briefs × 2: p50 60.1 s → 28.2 s, first-attempt pass 12/18 → 16/18, judge 3.88 → 4.39 |
| `GEMINI_THINKING_HEADROOM` | `3000` | Nonnegative integer extra output headroom |
| `LLM_MONTHLY_TOKEN_LIMIT` | `2000000` | Nonnegative integer; 0 disables quota checking. Internal accounts in [internal-accounts.json](../../src/lib/internal-accounts.json) (confirmed team-domain emails, listed owner ids) have no limit (#398) |

The parser does not validate live account quota or model availability. The
monthly limit is a per-business preflight check, **not an atomic reservation,
dollar budget, or image-cost cap**. See [AI Pipeline](../architecture/ai-pipeline.md).

## Images

| Variable | Default | Meaning |
| --- | --- | --- |
| `IMAGE_PROVIDER` | `pollinations` | Implemented names: `pollinations`, `cloudflare`, `openrouter` |
| `IMAGE_PROVIDER_FALLBACK` | `none` | `none`/empty disables fallback; otherwise implemented provider name |
| `POLLINATIONS_MODEL` | `flux` | Pollinations model |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN` | Empty | #1476: Workers AI (FLUX-1-schnell) for free pictures, tried before Pollinations for internal accounts and the credit-exhausted fallback; skipped unless both are set. The token needs Workers AI only (Sensitive in Vercel) |
| `OPENROUTER_IMAGE_MODEL` | `openai/gpt-image-2.5-flare` | OpenRouter image model; requires OpenRouter keys |
| `AD_DESIGN_OVERLAY` | `true` | Exact `false` or `0` disables; other strings enable |
| `FALAI_API_KEY`, `OPENAI_API_KEY` | Empty | Reserved fields, not implemented image-provider selectors |

The [provider switch](../../src/lib/imageGen/index.ts) rejects unknown names.
`IMAGE_PROVIDER=openai` or `falai` does not activate an adapter. Fallback must be
explicit; timeout/cancellation does not trigger fallback. Pollinations and Cloudflare reject
product-reference requests. Do not assume a fallback has equivalent fidelity or
lower cost.

## Meta

| Variable | Default | Meaning |
| --- | --- | --- |
| `META_APP_ID`, `META_APP_SECRET` | Empty | Server-side OAuth app credentials |
| `META_LOGIN_CONFIG_ID` | Empty | Optional Facebook Login for Business configuration |
| `META_TOKEN_ENCRYPTION_KEY` | Empty | Base64 32-byte encryption key for token store |
| `MANAGED_ACCOUNTS_ENABLED` | `false` | 2-Tier managed accounts (#518): `true`/`1` turns on provisioning child businesses under the parent. Off until provisioning ships. While off, internal accounts (`internal-accounts.json`, #379) still get the managed screens and routes (`/onboarding`, `/api/managed/*`, `/api/meta/managed/*`) for QA walks and concierge pilots (#523); background work (credential routing, spend caps, crons) follows the flag only |
| `AD_RESULTS_ENABLED` | off | Results per ad (#783): exactly `true` makes each campaign refresh (manual and cron) also read Meta's per-ad results into `ad_results` (best effort; a failure keeps the last rows) and turns on `GET /api/campaigns/[id]/ads`. Turn on only after the `20261026_campaign_ads_ad_results.sql` migration is in production |
| `OWNER_ALERTS_ENABLED` | off | Owner WhatsApp alerts (#701 slice 2): exactly `true`, with `ALERTS_WHATSAPP_PHONE_ID` and `ALERTS_WHATSAPP_TOKEN` set, lets the sender send approved utility templates from AdBrain's alerts number. Turn on only after the `20261027_owner_whatsapp_alerts_sends.sql` migration and template approval |
| `ALERTS_WHATSAPP_PHONE_ID` | empty | The Cloud API phone number id (digits) of AdBrain's alerts number (#701). Not a secret |
| `ALERTS_WHATSAPP_TOKEN` | empty, **secret** | System-user token with `whatsapp_business_messaging` on AdBrain's alerts WABA (#701). Vercel production only (Sensitive) |
| `ALERTS_LEAD_TEMPLATE`, `ALERTS_DAILY_TEMPLATE` | `adbrain_lead_alert`, `adbrain_daily_results` | Approved utility template names for the lead alert and the daily line (#701), each in `en` and `hi` |
| `META_SETUP_CHECKLIST` | off | Meta setup checklist (#1016): exactly `true` shows "Ready to launch on Meta" in Settings for an owner's own Meta connection (portfolio, rupee ad account, Page, WhatsApp, payment method; GET reads only). No secret |
| `META_PARENT_BUSINESS_ID` | `1158100643072508` | The 2-Tier parent business (Solaride) |
| `META_PARENT_SYSTEM_TOKEN` | Empty | Privileged secret (Vercel Sensitive): the parent's 'AdBrain provisioning' system-user token. Checked read-only after each deploy (`/api/cron/meta-parent-health`); rotation in OPERATIONS |
| `META_CONNECT_ROLLOUT` | Unset | `disabled`, `pilot`, `enabled`; unset allows nonproduction only |
| `META_CONNECT_PILOT_USER_ID` | Unset | Exact app user allowed in pilot mode |
| `META_APP_REVIEW_PENDING` | on | #1989: while Meta App Review (#156) is pending, WS1 step 3 asks a not-yet-Tester owner to accept the app invite before Connect, and offers Try again after a return with nothing connected. Exactly `false` hides it; DevOps sets that once #156 is approved. No secret |
| `META_SYSTEM_USER_TOKEN`, `META_AD_ACCOUNT_ID`, `META_PAGE_ID` | Empty | **Local fixture recording only** (`.env.local`, read by `scripts/lib/meta-env.ts`). The app doesn't read them (#520), and they aren't set in Vercel |

Rollout variables are read directly, outside `getEnv()`. Unknown values deny
access; unset production rollout denies access. Register
`<NEXT_PUBLIC_SITE_URL>/api/meta/oauth/callback` with Meta. Start via Settings or
`/connect/meta`, not the retired OAuth-start endpoint.

Keep the encryption key stable while encrypted tokens exist. A new key cannot
decrypt old tokens; rotation requires a reviewed migration. See
[Meta Connection](../META_CONNECT.md) for capabilities and recovery.

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
Meta review approval. [Vercel](../../vercel.json)
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

See [Observability](observability.md) for event contracts, privacy, retention, and
database-sink prerequisites. Do not enable the sink before the migration.

## Script Configuration

The example includes `DEMO_USER_PASSWORD`, `ADBRAIN_REVIEWER_EMAIL`,
`ADBRAIN_REVIEWER_PASSWORD`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY` for specific
seed/review scripts. They do not replace runtime variables. Operational scripts
may require additional guards; inspect the exact script before execution.

`APP_URL` / `ADBRAIN_URL` are script-origin overrides, not aliases for
`NEXT_PUBLIC_SITE_URL`. The migration runner uses `PGHOST`, `PGPORT` (default
5432), `PGDATABASE`, `PGUSER`, `PGPASSWORD` and optional `PGSSLROOTCERT`; see
[Release Workflow](../RELEASING.md#database-and-credential-safety).

`npm run env:doctor` and `npm run env:doctor:strict` run
[env-doctor.sh](../../scripts/env-doctor.sh), which only reports whether the
traffic-runner, legacy Meta and reviewer variables are set in the **current
shell**. It does not load `.env.local`, parse `getEnv()`, contact a provider or
check the database, so it can fail for a valid application setup. Strict mode
also fails on missing recommended variables. Keep its output private. A passing
check does not authorize seeds, backfills, paid evaluations, or remote writes.

### Local Launcher Modes

`node scripts/local-meta-qa.mjs <mode>` ([source](../../scripts/local-meta-qa.mjs))
reads `supabase status` through the `adbrain-qa` Colima socket and rejects
non-loopback API/database URLs. It blanks every name found in `.env.local`, then
points the app at the local project with synthetic Meta app values, empty AI key
pools, no image provider, no cron secret and test payments off. Other variables
exported in your shell are still inherited; this is not a network sandbox.

| Mode | Behavior |
| --- | --- |
| `setup` | Applies the full schema (`db/schema.sql` plus newer migrations, via `scripts/build-schema.mjs`) to the local database and creates a local Auth user, QA business and two draft creatives; writes, not a check |
| `dev` | `npm run dev` on port 3939 |
| `build`, `oauth-check`, `workspace`, `connect`, `e2e`, `recovery`, `draft-connect`, `draft-lifecycle`, `connection-recovery` | Runs the mapped build, check script or Playwright spec against the local project |
| `oauth-dev` | Copies the real `META_APP_ID`/`META_APP_SECRET`/`META_LOGIN_CONFIG_ID` from `.env.local` and redacts them from output; real Meta consent work |
| `payments-dev` | Reads Razorpay test credentials from `.env.local` (the `RAZORPAY_TEST_*` pair, or a standard pair only if it is `rzp_test_`; live keys are refused), enables test checkout and the dev auth bypass, derives a webhook secret if absent, disables product logging and binds 127.0.0.1:3939 |

Each mode runs immediately; none is an environment inspector. Stop only the
servers and fixtures you started.
