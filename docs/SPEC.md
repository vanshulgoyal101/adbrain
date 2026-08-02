# AdBrain — Implementation Spec

> AI ad-creative + ad manager for local SMBs. Beachhead vertical: **solar**.
> First tenant: **Solaride** (own account — dogfood + proof case).

## Product

A solar business fills a "brand brain," types a goal → AI generates on-brand ad
creatives (image + copy, multiple variants) → approved creatives launch into
Meta **Advantage+** (Meta's ML owns targeting; we own creative + simplicity) →
results return in plain language.

**Moat:** brand brain + genuinely good creative + dead-simple UX + solar
vertical + plain-language (WhatsApp) results. *Not* "we run ads" — that part is
commodity, and Meta Advantage+ is the free competitor, so we ride it as our
optimization engine rather than fighting it.

## Non-goals (v1)

- No custom targeting optimization — delegate to Advantage+.
- No video/audio (images only; add later as models improve).
- No Google Ads yet, no multi-customer onboarding yet.
- Solar vertical only. Not a generic "run any business" tool.

## Tech stack

- **Frontend:** Next.js (App Router) + TypeScript + Tailwind.
- **Backend:** Next.js server actions / route handlers.
- **DB + Auth + Storage:** Supabase (Postgres, Auth, Storage).
- **AI copy + brand analysis:** LLM provider (OpenAI/Anthropic) behind a
  `lib/llm` wrapper.
- **AI images:** image model behind a swappable `lib/imageGen` interface
  (OpenAI `gpt-image` / Imagen / Flux via fal.ai).
- **Ads:** Meta Marketing API via `facebook-nodejs-business-sdk` — usable now on
  Solaride's own account.
- **Google Ads / WhatsApp:** later phases.

## Data model (Postgres / Supabase, RLS on `owner_id = auth.uid()`)

```
profiles         (id=auth uid, email, created_at)
businesses       (id, owner_id, name, vertical='solar', website, description,
                  brand_voice, primary_color, secondary_color, font,
                  languages[], locations[], target_audience, usps[], offers[],
                  logo_url, created_at)
brand_assets     (id, business_id, type['logo'|'product_photo'|'past_ad'],
                  url, notes, created_at)
meta_credentials (id, business_id, ad_account_id, page_id, access_token,
                  token_type['system_user'|'oauth'], created_at)
creatives        (id, business_id, brief, angle, image_url, headline,
                  primary_text, cta, variant_group, status['draft'|'approved'],
                  created_at)
campaigns        (id, business_id, objective, daily_budget, status,
                  meta_campaign_id, creative_ids[], launched_at)
campaign_results (id, campaign_id, impressions, clicks, leads, spend, cpl,
                  fetched_at)
```

## Meta API access setup (parallel with the build)

For Solaride's own account — **no App Review needed**:

1. Create a **Business-type app** at developers.facebook.com; add the
   **Marketing API** product.
2. **Business Settings → System Users** → create a System User → assign
   Solaride's **ad account** and **Page** → generate a **long-lived token** with
   `ads_management`, `ads_read`, `business_management`.
3. Store token + `ad_account_id` + `page_id` in `meta_credentials`
   (token_type `system_user`).
4. Start **Meta Business Verification** now (background; needed only for the
   multi-customer phase).

### Env vars (never hardcode)

```
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
LLM_API_KEY
IMAGE_API_KEY
META_APP_ID, META_APP_SECRET
META_SYSTEM_USER_TOKEN        # Solaride, single-tenant, seeded into meta_credentials
META_AD_ACCOUNT_ID, META_PAGE_ID
```

## Phases

### Phase 0 — Brand Brain + Creative Studio (the heart)

1. Auth & onboarding (Supabase Auth).
2. **Brand Brain:** business profile CRUD; asset upload (logo/product photos/
   past ads) → Storage; **"autofill from website"** (scrape URL → LLM extracts
   voice/USPs/colors/description).
3. **Creative Studio:** brief → generate **3–5 complete ad variants** (image +
   headline + primary text + CTA + angle) using brand brain + **solar template
   library**; regenerate/edit; approve.
4. **Fallback export:** download an "ad pack" (images + copy) for manual launch
   — kept as a safety net.

**Acceptance:** from a filled brand brain + one brief, ≥3 on-brand solar ad
variants in <60s; approve/regenerate works.

### Phase 1 — Live Meta launch on Solaride

5. Read Solaride's `meta_credentials`; create an **Advantage+** campaign
   (objective: Leads) with approved creatives + daily budget via Marketing API;
   store `meta_campaign_id`.
6. **Results:** pull insights (impressions, clicks, leads, spend, CPL) →
   `campaign_results` → **plain-language summary**
   ("14 leads at ₹19 each; 'festive offer' won").
7. **Validation gate:** run real campaigns on Solaride and compare CPL/leads
   against the current ₹20K/mo baseline. *If AI creatives don't beat the current
   ads, stop and rethink before going further.*

### Phase 2 — Multi-customer (needs the reviews)

8. **Meta App Review** for Advanced Access + **Facebook Login for Business**
   OAuth so external customers connect their own ad accounts (token_type
   `oauth`); multi-tenant token handling.
9. **Google Ads:** create MCC, apply for **Basic Access**, add Google
   integration.
10. **WhatsApp result digests**, **lead inbox**, and the **learning loop** (seed
    new creatives from the winning one).

## Build order for the agent

1. Scaffold Next.js + Tailwind + Supabase + auth.
2. `db/schema.sql` (tables + RLS) and apply; seed Solaride's `meta_credentials`.
3. Brand Brain (CRUD + assets + website autofill).
4. **Creative Studio** (LLM copy + image gen + variants + approve). ← most
   effort; creative quality is do-or-die.
5. Meta launch (Advantage+) + results + plain-language summary, tested live on
   Solaride.
6. Dashboard polish.
7. *(Phase 2)* App Review + OAuth multi-tenant, Google, WhatsApp, learning loop.

## Suggested repo structure

```
/app            # Next.js routes (dashboard, brand, studio, campaigns)
/lib/supabase   # client + RLS-aware queries
/lib/llm        # copy generation + website→brand extraction
/lib/imageGen   # provider-abstracted image generation
/lib/meta       # Marketing API wrapper
/lib/templates  # solar creative templates/prompts
/components
/db/schema.sql  # tables + RLS policies
```

## Access-review timeline (background tasks, do not block the build)

- **Meta own-account (Solaride):** available now — system-user token, Standard
  Access, no review.
- **Meta Business Verification:** start now; days–weeks; needed for Phase 2.
- **Meta App Review (Advanced Access):** needed for Phase 2 (external accounts).
- **Google Basic Access:** apply via MCC/API Center; days–weeks; needed for
  Google integration only.
