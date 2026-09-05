# Deploying AdBrain to adbrain.vanshul.com

> **Status:** live in production at <https://adbrain.vanshul.com> (Vercel +
> custom domain). This is the runbook for reproducing or updating that setup.

AdBrain is a **dynamic** Next.js app (auth, API routes, server rendering), so it
needs a Node/serverless host — it can't be a static export. This guide uses
**Vercel** (native Next.js support, free tier is enough to start).

For the customer-facing demo sequence, provider choice, cost planning, payment
timing, and launch gates, see [DEMO-RUNBOOK.md](./DEMO-RUNBOOK.md).

---

## 0. Prerequisites
- The GitHub repo (`vanshulgoyal101/adbrain`).
- A Supabase project (URL, anon/publishable key, service-role key, DB password).
- A Meta system-user token + ad account id + page id.
- At least one LLM key pool (Gemini / Groq / OpenRouter / Cerebras).

## 1. Apply the database schema
`db/schema.sql` is idempotent — safe to run repeatedly.

```bash
# Option A: from your machine (needs the DB password)
PGHOST=db.<ref>.supabase.co PGPORT=5432 PGUSER=postgres \
  PGPASSWORD=<db-password> PGDATABASE=postgres \
  npm run db:push
```

Or paste `db/schema.sql` into the Supabase **SQL editor** and run it.

The paid-LLM controls add the `llm_usage_events` table. Apply the schema before
relying on monthly quotas; until that table exists, generation remains available
and usage persistence is best-effort for migration compatibility.

Set these Vercel environment variables for production:

```env
LLM_MONTHLY_TOKEN_LIMIT=2000000
SUPABASE_SERVICE_ROLE_KEY=<server-only-service-role-key>
```

`SUPABASE_SERVICE_ROLE_KEY` is required by the spend cron and must never be
exposed as a `NEXT_PUBLIC_*` variable.

## 2. Import the project into Vercel
1. vercel.com → **Add New → Project** → import `vanshulgoyal101/adbrain`.
2. Framework preset: **Next.js** (auto-detected). Leave build/output defaults.
3. Don't deploy yet — set env vars first (next step).

## 3. Environment variables (Vercel → Project → Settings → Environment Variables)
Set these for **Production** (and Preview if you want previews to work):

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key |
| `NEXT_PUBLIC_SITE_URL` | `https://adbrain.vanshul.com` |
| `GOOGLE_AI_API_KEYS` | comma-separated keys (or another provider's) |
| `GEMINI_MODEL` | e.g. `gemini-3.6-flash` (current default) |
| `GEMINI_THINKING_HEADROOM` | output-token headroom for Gemini thinking (default `3000`; `0` for a paid non-thinking model) |
| `IMAGE_PROVIDER` | `pollinations` |
| `AD_DESIGN_OVERLAY` | composite the designed poster over the AI photo (default `true`; `false` = bare photo) |
| `META_APP_ID` / `META_APP_SECRET` | Meta app creds (also required for the Facebook-Login connect flow) |
| `META_SYSTEM_USER_TOKEN` | long-lived system-user token (single-tenant fallback) |
| `META_AD_ACCOUNT_ID` | `act_...` (single-tenant fallback) |
| `META_PAGE_ID` | page id (single-tenant fallback) |

> **Connecting ad accounts from the UI (Facebook Login):** whitelist
> `https://<your-domain>/api/meta/oauth/callback` as a Valid OAuth Redirect URI
> in the Meta app, and submit the ad scopes for **App Review** before non-test
> users can connect. Owners then connect at `/settings`; stored OAuth creds take
> priority over the single-tenant `META_*` env vars per business.

> **Do NOT set `NEXT_PUBLIC_DEV_AUTH_BYPASS` in production.** Leaving it unset
> keeps the dev-login routes inert.

## 4. Custom domain
1. Vercel → Project → **Settings → Domains** → add `adbrain.vanshul.com`.
2. In your DNS provider for `vanshul.com`, add the record Vercel shows —
   typically `CNAME adbrain → cname.vercel-dns.com` (Vercel confirms the exact
   target). Wait for it to verify.

## 5. Supabase auth redirect URLs
Supabase → **Authentication → URL Configuration**:
- **Site URL:** `https://adbrain.vanshul.com`
- **Redirect URLs:** add `https://adbrain.vanshul.com/auth/callback`

(Otherwise magic-link + Google sign-in will reject the redirect.)

## 6. Deploy & verify
Trigger a deploy (push to `main` or click Deploy). Then check:
- `https://adbrain.vanshul.com/` — landing renders.
- `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, `/opengraph-image` — 200.
- Sign in works (magic link / Google).
- Campaigns page loads and can sync from Meta.

Verify the response security contract after deployment:

```bash
curl -sI https://adbrain.vanshul.com/ | grep -Ei \
  'content-security-policy|x-content-type-options|x-frame-options|referrer-policy'
```

The CSP is generated from `NEXT_PUBLIC_SUPABASE_URL`. If the Supabase project
uses a custom origin, confirm that origin appears in `connect-src`; do not
replace the policy with `*` to work around a missing allowlist entry.

For a prospect demo, also complete the [demo acceptance checklist](./DEMO-RUNBOOK.md#demo-acceptance-checklist)
and keep a pre-generated creative fallback available. A live provider or Meta
request must not be the only path through a customer call.

## 7. Scheduled jobs (Vercel Cron)

`vercel.json` registers two cron jobs, both authorised by `CRON_SECRET`:

- **`/api/cron/keepalive`** (daily) — keeps the Supabase project awake.
- **`/api/cron/enforce-spend`** (daily, scheduled for 06:00 UTC) — spend backstop: pauses
  active campaigns whose tracked spend has reached the weekly cap for any
  business with `auto_pause` on, even when nobody opens the app (Meta spends
  24/7). Runs under the service-role client. On Hobby, invocation can occur
  anywhere between 06:00 and 06:59 UTC. More frequent cron expressions are
  rejected at deployment, not automatically reduced to daily execution.

Both schedules intentionally support Vercel Hobby. Daily enforcement is weaker
than the previous six-hour schedule: spend can exceed the configured cap between
checks, and failed invocations can delay enforcement further. Refresh-time
enforcement remains enabled, but neither layer guarantees a hard spending limit.

> **This is not optional in production.** Free-tier Supabase projects auto-pause
> after ~7 days of inactivity, and a paused project **stops resolving in DNS** —
> so auth and every query fail, and browsers show a security warning instead of
> your login page rather than anything that looks like an app bug. The daily
> read counts as activity and prevents that. (Upgrading to Pro also removes
> auto-pausing, and unlocks the custom domain that would keep `*.supabase.co`
> out of the sign-in flow entirely.)

Set `CRON_SECRET` in Vercel → Project → Settings → Environment Variables.
Generate one with:

```bash
openssl rand -hex 32
```

Vercel sends it as `Authorization: Bearer <secret>`; the endpoint 404s when the
secret is unset and 401s on a bad one. Verify after deploying:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://adbrain.vanshul.com/api/cron/keepalive   # expect 200

curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://adbrain.vanshul.com/api/cron/enforce-spend   # expect 200
```

**If the project ever does pause**, restore it from the Supabase dashboard (or
`POST /v1/projects/<ref>/restore` via the Management API); it takes a few
minutes to come back and DNS returns first.

Campaign auto-sync on a schedule can reuse the same pattern — it additionally
needs the service-role key to run without a user session (see `docs/ROADMAP.md`).

## Rollback
Vercel keeps every deployment — use **Instant Rollback** to revert to a previous
build if a release misbehaves.
