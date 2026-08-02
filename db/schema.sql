-- ════════════════════════════════════════════════════════════════════════
--  AdBrain — Postgres schema (Supabase)
--  Run in: Supabase Dashboard → SQL Editor (or `supabase db push`).
--  Security model: Row Level Security on every table. A user can only touch
--  rows that belong to a business they own (businesses.owner_id = auth.uid()).
--  Child tables (assets, credentials, creatives, campaigns, results) inherit
--  ownership through their parent business. The service-role key bypasses RLS
--  for trusted server operations (e.g. seeding meta_credentials).
-- ════════════════════════════════════════════════════════════════════════

-- Needed for gen_random_uuid() on older Postgres; no-op if already present.
create extension if not exists pgcrypto;

-- ── updated_at trigger helper ───────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════
--  profiles  (1:1 with auth.users)
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: select own" on public.profiles;
create policy "profiles: select own"
  on public.profiles for select
  using (id = auth.uid());

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  using (id = auth.uid());

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ════════════════════════════════════════════════════════════════════════
--  businesses  (the "Brand Brain")
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.businesses (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users (id) on delete cascade,
  name            text not null,
  vertical        text not null default 'solar' check (vertical in ('solar')),
  website         text,
  description     text,
  brand_voice     text,
  primary_color   text,
  secondary_color text,
  font            text,
  languages       text[] not null default '{}',
  locations       text[] not null default '{}',
  target_audience text,
  usps            text[] not null default '{}',
  offers          text[] not null default '{}',
  logo_url        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists businesses_owner_id_idx on public.businesses (owner_id);

drop trigger if exists businesses_set_updated_at on public.businesses;
create trigger businesses_set_updated_at
  before update on public.businesses
  for each row execute function public.set_updated_at();

alter table public.businesses enable row level security;

drop policy if exists "businesses: all own" on public.businesses;
create policy "businesses: all own"
  on public.businesses for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Ownership helper: does the current user own this business?
create or replace function public.owns_business(b_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.businesses
    where id = b_id and owner_id = auth.uid()
  );
$$;

-- ════════════════════════════════════════════════════════════════════════
--  brand_assets
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.brand_assets (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  type        text not null check (type in ('logo', 'product_photo', 'past_ad')),
  url         text not null,
  notes       text,
  created_at  timestamptz not null default now()
);

create index if not exists brand_assets_business_id_idx
  on public.brand_assets (business_id);

alter table public.brand_assets enable row level security;

drop policy if exists "brand_assets: all own" on public.brand_assets;
create policy "brand_assets: all own"
  on public.brand_assets for all
  using (public.owns_business(business_id))
  with check (public.owns_business(business_id));

-- ════════════════════════════════════════════════════════════════════════
--  meta_credentials  (sensitive: contains access tokens)
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.meta_credentials (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  ad_account_id text not null,
  page_id       text not null,
  access_token  text not null,
  token_type    text not null default 'system_user'
                  check (token_type in ('system_user', 'oauth')),
  created_at    timestamptz not null default now()
);

create index if not exists meta_credentials_business_id_idx
  on public.meta_credentials (business_id);

alter table public.meta_credentials enable row level security;

drop policy if exists "meta_credentials: all own" on public.meta_credentials;
create policy "meta_credentials: all own"
  on public.meta_credentials for all
  using (public.owns_business(business_id))
  with check (public.owns_business(business_id));

-- ════════════════════════════════════════════════════════════════════════
--  creatives
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.creatives (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  brief         text not null,
  angle         text,
  image_url     text,
  headline      text,
  primary_text  text,
  cta           text,
  variant_group uuid,
  status        text not null default 'draft'
                  check (status in ('draft', 'approved')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists creatives_business_id_idx
  on public.creatives (business_id);
create index if not exists creatives_variant_group_idx
  on public.creatives (variant_group);

drop trigger if exists creatives_set_updated_at on public.creatives;
create trigger creatives_set_updated_at
  before update on public.creatives
  for each row execute function public.set_updated_at();

alter table public.creatives enable row level security;

drop policy if exists "creatives: all own" on public.creatives;
create policy "creatives: all own"
  on public.creatives for all
  using (public.owns_business(business_id))
  with check (public.owns_business(business_id));

-- ════════════════════════════════════════════════════════════════════════
--  campaigns
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.campaigns (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses (id) on delete cascade,
  objective        text not null default 'leads',
  daily_budget     numeric(12, 2) not null,
  status           text not null default 'draft'
                     check (status in ('draft', 'active', 'paused', 'completed')),
  meta_campaign_id text,
  creative_ids     uuid[] not null default '{}',
  launched_at      timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists campaigns_business_id_idx
  on public.campaigns (business_id);

alter table public.campaigns enable row level security;

drop policy if exists "campaigns: all own" on public.campaigns;
create policy "campaigns: all own"
  on public.campaigns for all
  using (public.owns_business(business_id))
  with check (public.owns_business(business_id));

-- ════════════════════════════════════════════════════════════════════════
--  campaign_results
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.campaign_results (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  impressions bigint not null default 0,
  clicks      bigint not null default 0,
  leads       bigint not null default 0,
  spend       numeric(12, 2) not null default 0,
  cpl         numeric(12, 2),
  fetched_at  timestamptz not null default now()
);

create index if not exists campaign_results_campaign_id_idx
  on public.campaign_results (campaign_id);

alter table public.campaign_results enable row level security;

-- Ownership travels campaign_results → campaigns → businesses.
drop policy if exists "campaign_results: all own" on public.campaign_results;
create policy "campaign_results: all own"
  on public.campaign_results for all
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_results.campaign_id
        and public.owns_business(c.business_id)
    )
  )
  with check (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_results.campaign_id
        and public.owns_business(c.business_id)
    )
  );

-- ════════════════════════════════════════════════════════════════════════
--  Storage buckets  (logos, product photos, past ads, generated creatives)
-- ════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('brand-assets', 'brand-assets', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('creatives', 'creatives', true)
on conflict (id) do nothing;

-- Authenticated users may read/write objects under a folder named after a
-- business id they own: e.g. `brand-assets/<business_id>/logo.png`.
drop policy if exists "brand-assets: read own" on storage.objects;
create policy "brand-assets: read own"
  on storage.objects for select
  using (
    bucket_id = 'brand-assets'
    and public.owns_business(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "brand-assets: write own" on storage.objects;
create policy "brand-assets: write own"
  on storage.objects for insert
  with check (
    bucket_id = 'brand-assets'
    and public.owns_business(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "brand-assets: update own" on storage.objects;
create policy "brand-assets: update own"
  on storage.objects for update
  using (
    bucket_id = 'brand-assets'
    and public.owns_business(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "brand-assets: delete own" on storage.objects;
create policy "brand-assets: delete own"
  on storage.objects for delete
  using (
    bucket_id = 'brand-assets'
    and public.owns_business(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "creatives: read own" on storage.objects;
create policy "creatives: read own"
  on storage.objects for select
  using (
    bucket_id = 'creatives'
    and public.owns_business(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "creatives: write own" on storage.objects;
create policy "creatives: write own"
  on storage.objects for insert
  with check (
    bucket_id = 'creatives'
    and public.owns_business(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "creatives: delete own" on storage.objects;
create policy "creatives: delete own"
  on storage.objects for delete
  using (
    bucket_id = 'creatives'
    and public.owns_business(((storage.foldername(name))[1])::uuid)
  );
