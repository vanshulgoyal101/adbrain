# AdBrain

AI ad-creative + ad manager for local SMBs. Beachhead vertical: **solar**.
First tenant: **Solaride** (own account — dogfood + proof case).

Fill a "brand brain" → type a goal → AI generates on-brand ad creatives (image +
copy, multiple variants) → approve → (Phase 1) launch into Meta Advantage+.

See [docs/SPEC.md](docs/SPEC.md) for the full product spec and
[docs/how-we-got-here.md](docs/how-we-got-here.md) for the rationale.

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
| `npm run test` | Vitest unit tests |

## Architecture

```
src/
  app/
    (app)/                 # auth-protected shell: dashboard, brand, studio, campaigns
    api/
      brand/autofill/      # scrape website → LLM → brand fields (SSRF-guarded)
      creatives/generate/  # brief → 3–6 variants (copy + image) → saved drafts
      creatives/export/    # zip of approved images + copy.txt (ad pack)
    auth/callback/         # OAuth + magic-link completion
    login/                 # magic link + Google sign-in
  lib/
    env.ts                 # zod-validated env
    supabase/              # browser/server/admin clients, proxy session, queries
    llm/                   # rotating orchestrator + provider adapters
    imageGen/              # provider-abstracted image generation
    templates/solar.ts     # solar angles + prompt builders (+ instruction injection)
    creative/generate.ts   # copy + image → complete variants
    creative/persist.ts    # store generated images in Supabase Storage
    creative/summary.ts    # plain-language results summary (LLM)
    meta/client.ts         # Marketing API wrapper (campaigns, insights)
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

### Observability (audit log)

Every mutation — creatives generated/approved/deleted/regenerated, brand and
instruction edits, campaign create/refresh — appends a row to the append-only
`audit_log` table (who, what, when, why, Meta object id, JSON details). Recent
events show on the dashboard. RLS scopes each business to its own log; there are
no update/delete policies, so the log is tamper-resistant. Campaigns also store
their Meta `campaign`/`adset`/`ad` ids plus a `raw` JSON snapshot.

## Status vs SPEC

- **Phase 0 (Brand Brain + Creative Studio):** done — auth, brand CRUD + assets +
  instructions, website autofill, variant generation, approve/regenerate,
  ad-pack export.
- **Phase 1 (Live Meta launch):** done — paused Advantage+ lead campaigns,
  insights → plain-language summary, audit logging. (Ad-creative creation
  requires the Meta app to be in **Live** mode.)
- **Phase 2 (multi-customer, Google, WhatsApp):** not started.


