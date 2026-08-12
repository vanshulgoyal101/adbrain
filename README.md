# AdBrain

AI ad-creative + ad manager for local SMBs. Beachhead vertical: **solar**.
First tenant: **Solaride** (own account — dogfood + proof case).

Fill a "brand brain" → type a goal → AI generates on-brand ad creatives (image +
copy, multiple variants) → approve → (Phase 1) launch into Meta Advantage+.

See [docs/SPEC.md](docs/SPEC.md) for the full product spec and
[docs/how-we-got-here.md](docs/how-we-got-here.md) for the rationale.
See [docs/FEATURES.md](docs/FEATURES.md) for the living list of built and
proposed features.
See [docs/DEPLOY.md](docs/DEPLOY.md) to deploy to adbrain.vanshul.com.

## Stack

- **Next.js 16** (App Router) + **TypeScript** + **Tailwind v4**
- **Supabase** — Postgres, Auth, Storage (RLS on every table)
- **LLM layer** — provider-agnostic with multi-key rotation (Gemini, Groq,
  OpenRouter, Cerebras)
- **Image gen** — provider-agnostic; default **Pollinations** (free, no key)

## Getting started

1. **Install**

   ```bash
   npm install
   ```

2. **Configure environment** — copy the example and fill it in:

   ```bash
   cp .env.example .env.local
   ```

   Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   For server-side/admin ops: `SUPABASE_SERVICE_ROLE_KEY`.
   For AI features, add at least one LLM key pool (comma-separated keys):
   `GOOGLE_AI_API_KEYS`, `GROQ_API_KEYS`, `OPENROUTER_API_KEYS`, or
   `CEREBRAS_API_KEYS`. Image gen works with no key (Pollinations).

3. **Apply the database schema** — in the Supabase SQL Editor, run
   [db/schema.sql](db/schema.sql). It creates all tables, RLS policies, storage
   buckets, and the `profiles` trigger.

4. **Run**

   ```bash
   npm run dev      # http://localhost:3000
   ```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest unit + component tests |

## Architecture

```
src/
  app/
    (app)/                 # auth-protected shell: dashboard, brand, studio, campaigns, leads
    api/
      brand/autofill/      # scrape website → LLM → brand fields (SSRF-guarded)
      creatives/generate/  # brief → 3–6 variants (copy + image) → saved drafts
      creatives/[id]/regenerate/  # re-roll a single variant
      creatives/export/    # zip of approved images + copy.txt (ad pack)
      campaigns/plan/      # goal → AI campaign plan (asks if unsure) → paused launch
      campaigns/create/    # manual: pick creatives + budget + targeting → launch
      campaigns/[id]/refresh/  # pull Meta insights → plain-language summary
      campaigns/sync/      # import existing Meta campaigns
      campaigns/lead-forms/  # list active Meta lead forms
      leads/sync/          # pull instant-form leads into the inbox
      meta/geo-search/     # location typeahead (Meta adgeolocation search)
    auth/callback/         # OAuth + magic-link completion
    login/                 # magic link + Google sign-in
    sitemap.ts robots.ts manifest.ts opengraph-image.tsx  # SEO surfaces
  lib/
    env.ts                 # zod-validated env
    site.ts                # central site config (name, url, keywords)
    seo/jsonLd.ts          # schema.org @graph builders (pure, tested)
    supabase/              # browser/server/admin clients, proxy session, queries
    llm/                   # rotating orchestrator + provider adapters
    imageGen/              # provider-abstracted image generation
    templates/ads.ts       # universal ad angles + industry-driven prompt builders (+ instruction injection)
    creative/generate.ts   # copy + image → complete variants
    creative/persist.ts    # store generated images in Supabase Storage
    creative/summary.ts    # plain-language results summary (LLM)
    campaign/planner.ts    # goal → structured campaign plan (LLM strategist)
    campaign/targeting.ts  # normalize UI targeting → Meta geo spec (pure, tested)
    campaign/budget.ts     # daily budget → "~X leads/week" estimate (pure, tested)
    leads/parse.ts         # Meta field_data → normalized lead (pure, tested)
    leads/digest.ts        # leads → WhatsApp-style digest text (pure, tested)
    meta/client.ts         # Marketing API wrapper (campaigns, insights, geo, leads)
    meta/mappers.ts        # Meta enum ↔ app enum converters
    audit.ts               # append-only audit logging (observability)
  proxy.ts                 # session refresh + route guard (Next 16 "proxy")
db/schema.sql              # Postgres tables + RLS + storage policies
```

### LLM key rotation

The LLM layer round-robins across each provider's comma-separated key pool and
falls through providers in `LLM_PROVIDER_ORDER`. A key that returns HTTP 429 is
parked on a short cooldown. Add keys any time — no code changes needed.

### Swapping the image provider

Default is Pollinations (free). To use a paid provider later, add a provider
under `src/lib/imageGen/providers/`, wire it into `getProvider()` in
`src/lib/imageGen/index.ts`, and set `IMAGE_PROVIDER` in `.env.local`.

### Per-customer instructions

Each business can have multiple markdown **instruction files** (`ad_instructions`
table, managed on the Brand page). Active files are concatenated and injected
into every copy + image prompt, so a customer's rules ("always mention the
25-year warranty", "no discount claims") steer generation.

### Audience targeting

Campaigns are built for people who don't know Meta Ads Manager. In the Campaigns
form you can:

- **Include** and **exclude** locations with a live typeahead (backed by Meta's
  `adgeolocation` search) — cities get an adjustable radius; states/countries are
  exact.
- Set an **age range**, or leave any field on **“Let AdBrain decide”** so the AI
  picks it from the brand's service areas and goal.
- Read a one-line **plain-language explanation** under each control and a live
  **audience summary** sentence describing who will see the ads.

Under the hood, `src/lib/campaign/targeting.ts` normalizes the form into a Meta
targeting spec, and `MetaClient.resolveGeoTargeting()` turns place names into
geo keys (trusting Meta's relevance order, e.g. the canonical *Jaipur* over
same-named towns). If nothing resolves, it falls back to nationwide. The AI
planner (`src/lib/campaign/planner.ts`) can also choose locations itself and
never invents IDs — it asks a clarifying question instead of guessing.

A **budget helper** (`src/lib/campaign/budget.ts`) turns the daily rupee budget
into a plain "~X leads/week" estimate with one-tap presets, and a short "what
happens next" panel explains the paused → review → activate flow.

### Lead inbox + digest

The **Leads** page pulls instant-form submissions from Meta into a `leads` table
(deduped by Meta lead id) so the owner sees every enquiry in one place, sortable
and searchable. One click produces a copy-ready, WhatsApp-style **digest** of
recent leads. Pure modules: `src/lib/leads/parse.ts` (Meta `field_data` → a
normalized lead) and `src/lib/leads/digest.ts` (leads → plain text); the sync
route is `POST /api/leads/sync`. Reading leads needs the Meta token to have
`leads_retrieval`; forms it can't read are skipped.

### Observability (audit log)

Every mutation — creatives generated/approved/deleted/regenerated, brand and
instruction edits, campaign create/refresh — appends a row to the append-only
`audit_log` table (who, what, when, why, Meta object id, JSON details). Recent
events show on the dashboard. RLS scopes each business to its own log; there are
no update/delete policies, so the log is tamper-resistant. Campaigns also store
their Meta `campaign`/`adset`/`ad` ids plus a `raw` JSON snapshot.

## SEO

The public marketing surface (`/` and `/login`) ships full technical SEO:

- `metadataBase` + templated titles, description, keywords, and canonical URLs
  (`src/app/layout.tsx`, driven by `src/lib/site.ts`).
- OpenGraph + Twitter cards with a build-time generated share image
  (`src/app/opengraph-image.tsx`).
- schema.org **@graph** (Organization + WebSite + SoftwareApplication) as JSON-LD
  from pure, unit-tested builders (`src/lib/seo/jsonLd.ts`).
- `sitemap.xml` (public routes only), `robots.txt` (app + API disallowed),
  and a web app `manifest.webmanifest`.

Set `NEXT_PUBLIC_SITE_URL` to the production origin so absolute URLs and the
sitemap resolve correctly.

## Status vs SPEC

- **Phase 0 (Brand Brain + Creative Studio):** done — auth, brand CRUD + assets +
  instructions, website autofill, variant generation, approve/regenerate,
  ad-pack export.
- **Phase 1 (Live Meta launch):** done — paused Advantage+ lead campaigns,
  insights → plain-language summary, audit logging. (Ad-creative creation
  requires the Meta app to be in **Live** mode.)
- **Phase 2 (multi-customer, Google, WhatsApp):** not started.


