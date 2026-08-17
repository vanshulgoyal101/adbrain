# AdBrain — Architecture

> The engineering reference for how AdBrain is built. Pairs with
> [SPEC.md](SPEC.md) (what & why), [FEATURES.md](FEATURES.md) (what exists /
> what's proposed), and [DEPLOY.md](DEPLOY.md) (hosting).
>
> _Last updated: 2026-08-13_

---

## 1. What AdBrain is

AdBrain turns a business's brand into launch-ready ad creatives (image +
headline + copy) and runs them as **Meta (Facebook/Instagram) lead-generation
campaigns** — for **any local business** (Solaride, a solar company, is simply
one customer; the engine is industry-agnostic and driven by each business's
`vertical`). The user fills a **Brand Brain** once, types a goal, approves the
AI's variants, and AdBrain creates a **paused** campaign that spends nothing
until they activate it.

Design principles:

- **Near-zero effort for a non-technical owner.** One brand form, one goal box,
  one-click launch, results in a single plain-language sentence.
- **Safe by default.** Campaigns are created paused; every AI output is
  reviewed before it runs; nothing spends without explicit activation.
- **Provider-agnostic AI.** LLM and image providers are swappable behind small
  interfaces with multi-key rotation, so no single vendor/key is a hard
  dependency.

---

## 2. Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript 5 |
| Styling | Tailwind CSS v4, `lucide-react` icons, small local UI primitives (`components/ui`) |
| Auth / DB / Storage | Supabase (`@supabase/ssr`): magic-link + Google OAuth, Postgres with Row-Level Security, Storage buckets |
| LLM | Provider-agnostic (`lib/llm`): Gemini + OpenAI-compatible (Groq/OpenRouter/Cerebras), JSON mode, multi-key rotation |
| Images | `lib/imageGen`: Pollinations by default (keyless, URL-based) |
| Ads | Meta Graph API v21 (`lib/meta/client.ts`) |
| Validation | Zod (env + boundaries) |
| Tests | Vitest (node + jsdom), Testing Library |

---

## 3. Directory map

```
src/
  app/
    layout.tsx              # root metadata, JSON-LD graph, analytics
    page.tsx                # marketing landing (hero, steps, features, FAQ)
    privacy/ terms/         # public legal pages (metadata + WebPage/Breadcrumb JSON-LD)
    login/                  # sign-in (magic link, Google, dev bypass)
    sitemap.ts robots.ts manifest.ts opengraph-image.tsx  # SEO surfaces
    (app)/                  # AUTH-GATED shell (redirects to /login if signed out)
      layout.tsx            # sidebar + mobile header shell
      dashboard/ brand/ studio/ campaigns/ leads/ assets/
    api/                    # route handlers (see §6)
  components/               # client components + ui/ primitives
  lib/
    supabase/               # client, server, admin, middleware, queries
    llm/                    # provider-agnostic completion + rotation + cache/usage
    imageGen/               # image provider abstraction
    meta/                   # Graph API client + mappers
    creative/               # generate, persist, summary
    campaign/               # planner, budget
    templates/ads.ts        # universal ad angles + prompt builders
    security/               # ssrf.ts, rate-limit.ts
    seo/jsonLd.ts           # schema.org builders
    site.ts types.ts utils.ts languages.ts audit.ts api.ts dev-auth.ts env.ts
  proxy.ts                  # Next 16 "proxy" (was middleware): refreshes the session
db/schema.sql               # tables + RLS + storage buckets (idempotent)
tests/                      # Vitest suites
docs/                       # SPEC, FEATURES, ARCHITECTURE, DEPLOY, how-we-got-here
```

---

## 4. Data model (`db/schema.sql`)

All tables carry a `business_id` (directly or transitively) and are protected by
RLS. The core predicate is `public.owns_business(business_id)` — true when the
current auth user owns that business. Storage buckets (`brand-assets`,
`creatives`) have matching per-owner policies.

| Table | Purpose | Notes |
| --- | --- | --- |
| `profiles` | 1:1 with `auth.users` | created by a trigger on signup |
| `businesses` | the Brand Brain | `vertical` (industry, free text), voice, colours, USPs, offers, `languages[]`, `locations[]` |
| `brand_assets` | logos / product photos / past ads | stored in the `brand-assets` bucket |
| `meta_credentials` | per-business Meta creds (one row/business): OAuth **or** single-tenant env fallback; `token_type`, `token_expires_at`, `scopes`, nullable account/page while pending |
| `spend_limits` | per-business ad-spend guardrails: `weekly_cap_rupees` (null = none), `alert_pct`, `auto_pause` |
| `creatives` | generated ads | `angle`, `headline`, `primary_text`, `cta`, `image_url`, `status` (draft/approved), `variant_group` |
| `campaigns` | launched campaigns | `meta_campaign_id`, `status`, `daily_budget`, `creative_ids[]`, `raw jsonb`; **unique (business_id, meta_campaign_id)** |
| `campaign_results` | insight snapshots | impressions/clicks/leads/spend/cpl, `fetched_at` |
| `ad_instructions` | per-business prompt steer | markdown, `is_active`; injected into generation |
| `audit_log` | append-only history | select+insert RLS only (no update/delete) = tamper-resistant |
| `leads` | instant-form leads | unique `(business_id, meta_lead_id)`; deduped on sync |

Indexes exist on every `business_id`, plus `creatives(business_id,status)`,
`campaign_results(campaign_id, fetched_at desc)`, `leads(business_id/campaign_id)`,
and the unique campaign index that makes sync idempotent.

---

## 5. Auth & session flow

- **`proxy.ts`** runs on every request and calls `updateSession` to refresh the
  Supabase auth cookie (keeps SSR and the client in sync).
- **`getUser()`** (`lib/supabase/queries.ts`) resolves the current user: it
  checks the **real Supabase session first**, then falls back to the **dev
  bypass** identity.
- **Dev bypass** (`lib/dev-auth.ts`) is only ever active when
  `NODE_ENV !== "production"` **and** `NEXT_PUBLIC_DEV_AUTH_BYPASS === "true"`.
  It lets you browse as a seeded developer identity when the backend isn't
  reachable. Never active in production.
- The `(app)/layout.tsx` server component redirects to `/login` when there is no
  user, so the entire product shell is gated in one place.

---

## 6. API routes (`src/app/api`)

Every route: (1) authenticates via `supabase.auth.getUser()`, (2) relies on RLS
so a user only ever reads/writes their own rows, (3) returns client-safe errors
(`lib/api.ts` `apiError`/`serverError` — internal details are logged, never
leaked).

| Route | Method | Purpose |
| --- | --- | --- |
| `brand/autofill` | POST | Scrape a website (SSRF-guarded) → LLM → brand fields |
| `creatives/assistant` | POST | Guided interview (one question at a time) → creative brief |
| `creatives/generate` | POST | Brief → 3–6 variants (copy + image) → saved drafts |
| `creatives/[id]/regenerate` | POST | Re-roll a single variant |
| `creatives/export` | POST | Zip of images + `copy.txt` (skips failed images, reports count) |
| `campaigns/plan` | POST | Goal → AI plan (asks structured questions if unsure) |
| `campaigns/create` | POST | Manual launch: creatives + budget + targeting |
| `campaigns/[id]` | PATCH / DELETE | Pause/resume · delete (Meta + local) |
| `campaigns/[id]/refresh` | POST | Pull Meta insights → plain-language summary |
| `campaigns/sync` | POST | Import existing Meta campaigns (idempotent) |
| `campaigns/lead-forms` | GET | List active Meta lead forms |
| `campaigns/report` | GET | Markdown performance report |
| `leads/sync` | POST | Pull instant-form leads into the inbox (deduped) |
| `meta/geo-search` | GET | Location typeahead (Meta adgeolocation) |
| `meta/oauth/start` | GET | Begin Facebook-Login connect (signed `state` → dialog) |
| `meta/oauth/callback` | GET | Exchange code → long-lived token → store connection |
| `meta/accounts` | GET | List the connected user's ad accounts + pages |
| `meta/connect` | POST | Save the chosen ad account + page |
| `meta/disconnect` | POST | Remove the stored Meta connection |
| `spend-limits` | POST | Save the weekly spend cap + alert % + auto-pause |

Cost-incurring routes (`assistant`, `generate`, `regenerate`, `plan`,
`autofill`) are **rate-limited per user** (see §9).

---

## 7. The creative engine (`lib/templates/ads.ts`, `lib/creative`)

- **`AD_ANGLES`** — six universal marketing angles (value, problem, offer,
  trust, aspiration, urgency). Each carries a mood-based `imageHint`; the actual
  subject comes from the business's `vertical` + the brief, so the same angles
  work for a solar installer, a dentist, or a gym.
- **Prompt builders** — `buildCopyMessages`, `buildImagePrompt`,
  `buildBrandExtractionMessages`. All are pure and industry-driven via
  `brandIndustry(brand)` (falls back to "local business"). Active
  `ad_instructions` and the chosen language are injected here.
- **`generateVariants`** runs the angles in parallel (copy via `completeJSON`,
  image via the image provider), then `persistCreativeImage` stores the image in
  the `creatives` bucket and rows are inserted as drafts.

### Designed-poster compositing (`lib/creative/design.ts` + `render.tsx`)

The raw image provider returns a **bare, text-free, logo-free photo** (the
prompt explicitly forbids text/logos, since diffusion models render text
poorly). A finished ad — like the human-designed Solaride creatives — is a
*poster*: brand lockup, headline, a benefit checklist and a contact/CTA bar laid
over that photo. Two modules bridge the gap:

- **`design.ts`** (pure, unit-tested) — `buildAdDesign({ brand, copy, format })`
  produces an `AdDesignSpec`: canvas size per `AdFormat` (portrait 4:5 default,
  plus square, story, landscape), brand-colour theming (`normalizeHex` +
  contrast-aware `readableTextOn`), up to four benefit chips distilled from the
  brand's USPs/offers (`pickBenefits`), a contact line from website + locality
  (`deriveContactLine`), a supporting line from the copy (`deriveSubhead`), and a
  length-clamped headline (`shortenHeadline`).
- **`render.tsx`** — `renderCompositeAd(spec)` rasterises the spec with `next/og`
  (Satori + resvg — the same engine as the OG image, so **no new dependency and
  no custom font**). The AI photo is composited under a legibility scrim; the
  lockup, headline, benefit chips (✓) and CTA button are drawn on top.

`generate` and `regenerate` persist the bare photo first, then
`renderAndPersistDesign` composites the poster over that stable URL and stores it
as the creative image. It is **best-effort**: any failure — or
`AD_DESIGN_OVERLAY=false` — falls back to the bare photo so generation never
breaks.

---

## 7a. LLM subsystem & token efficiency (`lib/llm`)

Every AI call goes through `complete()` / `completeJSON()`. The subsystem is
built to keep a **paid** key's spend low and predictable:

- **Provider rotation** — `LLM_PROVIDER_ORDER` picks providers; each has a
  comma-separated key pool. Keys that return HTTP 429 are parked for a 60s
  cooldown; a round-robin cursor spreads load. First success wins.
- **Token usage capture** — providers parse the real counts they report
  (Gemini `usageMetadata`, OpenAI `usage`) into `CompletionResult.usage`
  (`promptTokens` / `completionTokens` / `totalTokens`). `lib/llm/usage.ts`
  aggregates them process-locally (`usageSnapshot()` / `resetUsage()`), split
  overall and per provider, so spend is observable and testable without an
  external service.
- **Response cache + single-flight** (`lib/llm/cache.ts`) — opt-in per call via
  `{ cache: true }` (or `{ cache: { ttlMs } }`). Identical requests (hashed over
  messages + temperature + maxTokens + json, **not** the API key) are served
  from an in-process TTL/LRU cache at **zero token cost**, and concurrent
  identical requests share one in-flight promise. A cache hit sets
  `result.cached === true` and is counted as *saved* tokens. Enabled on the
  low-variance call-sites (insight summaries, website→brand extraction); left
  off where fresh variety is expected (copy generation, planner, interview).
- **Gemini thinking headroom** — 2.5 models spend output tokens on hidden
  "thinking", so the provider pads `maxOutputTokens` by
  `GEMINI_THINKING_HEADROOM` (default 3000) to avoid truncated JSON. For a paid
  **non-thinking** model set it to `0` to stop paying for unused output tokens.
- **Robust JSON parsing** — `parseJSON` strips ```json fences and prose and
  falls back to the first `{...}`/`[...]` block before throwing.

Guidance for adding a call-site: pass an explicit `maxTokens`, add `cache: true`
only when a stale-but-identical answer is acceptable, and prefer low temperature
for extraction/summaries so cache hit-rates stay high.

---

## 8. Meta integration (`lib/meta/client.ts`)

A thin, typed wrapper over Graph v21. Highlights:

- **`createLeadCampaign`** — creates a **paused** `OUTCOME_LEADS` campaign +
  ad set (with geo targeting + destination: instant_form / call / whatsapp) +
  ad creative (`object_story_spec` with `lead_gen_form_id`) + ad. Supports A/B
  variants and graceful fallback to instant_form.
- **Geo targeting** — `searchGeoLocations` + `resolveGeoTargeting` map friendly
  area names to Meta keys; city radius clamped 5–80 km.
- **`updateCampaignStatus`**, **`deleteObject`**, **`listCampaigns`**,
  **`getCampaignInsights`**, **`listLeadForms`**.
- Single-tenant env credentials via `getMetaCredentialsFromEnv` /
  `metaClientFromEnv`.

### 8a. Connecting an ad account (Facebook Login) — `lib/meta/oauth.ts`

Business owners connect their own Meta account from **Settings** instead of
relying on server env vars. The flow is stateless (no server-side session store):

1. **`/api/meta/oauth/start`** builds an HMAC-signed `state` (payload =
   `businessId` + `userId` + timestamp, signed with `META_APP_SECRET`, 10-min
   TTL) and redirects to Facebook's login dialog with the required scopes
   (`ads_management`, `leads_retrieval`, `pages_show_list`, `pages_manage_ads`,
   `business_management`, …).
2. **`/api/meta/oauth/callback`** verifies the `state` (signature + freshness +
   that the current user started it), exchanges the `code` for a **short-lived**
   token, then upgrades it to a **long-lived (~60-day)** user token
   (`exchangeForLongLivedToken`). It upserts a `meta_credentials` row
   (`token_type='oauth'`, `token_expires_at`, `scopes`) with the account/page
   left null → **pending selection**.
3. **`/api/meta/accounts`** lists the user's ad accounts + pages
   (`fetchAdAccounts` / `fetchPages`); **`/api/meta/connect`** saves the chosen
   pair after re-validating them against the token; **`/api/meta/disconnect`**
   deletes the row.

**Credential resolution** (`lib/meta/credentials.ts`) is now **DB-first,
env-fallback**: `resolveMetaCredentials(businessId)` returns a complete,
non-expired stored OAuth connection if present, otherwise the single-tenant env
creds. `metaClientForBusiness(businessId)` is used by every campaign/lead route,
and `getMetaConnection(businessId)` powers the Settings UI (`source`:
`oauth` | `env` | `none`, plus `pending` / `ready` / `expired` — never exposes
the token).

> **Going live:** the OAuth scopes require **Meta App Review**, and the exact
> `${NEXT_PUBLIC_SITE_URL}/api/meta/oauth/callback` redirect URI must be
> whitelisted in the Meta app. Until approved it works only for the app's
> configured test users. Tokens are stored in the RLS-protected
> `meta_credentials` table and never returned to the browser.

---

## 8b. Spend guardrails (`lib/campaign/spend.ts`)

Non-technical owners are letting software spend on ads, so spend is capped and
monitored. Pure, unit-tested logic drives three enforcement points:

- **Config** — `spend_limits` (one row/business): `weekly_cap_rupees`,
  `alert_pct`, `auto_pause`, editable in **Settings** (`POST /api/spend-limits`).
- **Forward-looking guard** — `wouldExceedCap()` blocks **activating** a campaign
  (`PATCH /api/campaigns/[id]` → active) when the projected weekly commitment
  (active campaigns' daily budget × 7) would exceed the cap. Campaigns are
  created paused, so activation is the moment money is committed.
- **Signal** — `evaluateSpend()` gauges `max(projected weekly, tracked spend)`
  against the cap → `off | ok | approaching | over`, surfaced as a dashboard/
  settings banner + meter.
- **Runaway protection** — on results refresh, `enforceAutoPause()` pauses every
  active campaign (Meta + local + audit) once tracked spend reaches the cap and
  `auto_pause` is on. Best-effort: it never throws, so it can't break the refresh.

---

## 9. Security

- **SSRF** (`lib/security/ssrf.ts`) — user-supplied URLs (brand autofill) are
  validated (`parsePublicUrl` / `isBlockedHost` block loopback, private,
  link-local incl. cloud metadata, IPv6 ULA, IPv4-mapped bypasses). Fetching
  uses **`fetchPublicUrlText`**, which follows redirects **manually and
  re-validates every hop** — closing the "redirect to `169.254.169.254`" bypass
  — plus a byte cap and short timeout.
- **Rate limiting** (`lib/security/rate-limit.ts`) — a sliding-window limiter
  guards the cost-incurring routes per user (429 + `Retry-After`). The shared
  path is a Postgres `SECURITY DEFINER` function (`check_rate_limit` over
  `rate_limit_hits`) so limits hold **across serverless instances**; it falls
  back to an in-memory per-instance limiter if the RPC is unavailable, so a DB
  hiccup never blocks legitimate use.
- **RLS everywhere** — the real access-control boundary; API routes add auth
  checks and safe error messages on top.
- **Dev bypass** is gated by `NODE_ENV` (see §5).
- **Secrets** are never logged; env is validated by Zod (`lib/env.ts`).

---

## 10. SEO

- Rich metadata in `app/layout.tsx` (title template, canonical, OpenGraph,
  Twitter, robots directives, manifest, theme color) with per-page overrides
  (login, privacy, terms).
- **Structured data** (`lib/seo/jsonLd.ts`): `Organization`, `WebSite`,
  `SoftwareApplication`, `FAQPage` on the landing; `WebPage` + `BreadcrumbList`
  on legal pages — embedded via the `JsonLd` component.
- `sitemap.ts` (public routes), `robots.ts` (app/api disallowed), dynamic
  `opengraph-image.tsx` (with `alt`), `preconnect`/`dns-prefetch` for the
  analytics host, system-font stack (no render-blocking web fonts).

---

## 11. Testing

- **Vitest**, node environment by default; component tests opt into jsdom via a
  `// @vitest-environment jsdom` docblock (`tests/setup.ts` wires
  `@testing-library/jest-dom`).
- Strategy: **exhaustively unit-test the pure core** (prompt builders, angle
  library, LLM parse/rotation, geo/destination/mappers, budget, planner
  formatting, report, SSRF incl. redirect safety, rate limiter, SEO schema,
  languages, utils) and **mock `fetch`** for external I/O (Meta client, image
  gen). Component tests cover the interactive surfaces (campaign chat, assets
  library). The LLM efficiency layer (cache/single-flight/TTL, usage
  accounting, provider token parsing) is unit-tested end-to-end.
- Run: `npm run test` · `npm run typecheck` · `npm run lint` · `npm run build`.

---

## 12. Environment variables

| Var | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client |
| `SUPABASE_SERVICE_ROLE_KEY` | server/admin ops (optional) |
| `GOOGLE_AI_API_KEYS` / `GROQ_API_KEYS` / `OPENROUTER_API_KEYS` / `CEREBRAS_API_KEYS` | LLM key pools (comma-separated) |
| `GEMINI_MODEL` | LLM model override (default `gemini-flash-latest`) |
| `GEMINI_THINKING_HEADROOM` | extra output-token budget for Gemini 2.5 thinking (default `3000`; set `0` for a paid non-thinking model) |
| `META_SYSTEM_USER_TOKEN`, `META_AD_ACCOUNT_ID`, `META_PAGE_ID` | single-tenant Meta creds |
| `NEXT_PUBLIC_SITE_URL` | canonical site origin (SEO) |
| `NEXT_PUBLIC_DEV_AUTH_BYPASS`, `DEV_LOGIN_EMAIL`, `DEV_LOGIN_PASSWORD` | local dev bypass (non-prod only) |

---

## 13. Roadmap / proposed (see FEATURES.md for the living list)

- **Spend guardrails & alerts** — notify when spend approaches/exceeds budget.
- **AI-vs-baseline benchmark** and per-angle performance analysis.
- **Weekly WhatsApp results digest** and instant new-lead alerts.
- **Multi-business switching** (schema already supports many businesses).
- **Encrypted Meta tokens** (pgcrypto/Vault) + token-expiry tracking for OAuth.

Each proposed item should ship complete — route + UI + tests + docs — following
the patterns above.
