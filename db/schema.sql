-- ════════════════════════════════════════════════════════════════════════
--  AdBrain — Postgres schema (Supabase)
--  Run in: Supabase Dashboard → SQL Editor (or `supabase db push`).
--  Security model: Row Level Security on every table. A user can only touch
--  rows that belong to a business they own (businesses.owner_id = auth.uid()).
--  Child tables (assets, creatives, campaigns, results) inherit
--  ownership through their parent business. The service-role key bypasses RLS
--  for trusted server operations (e.g. Meta token migration).
-- ════════════════════════════════════════════════════════════════════════

-- Needed for gen_random_uuid() on older Postgres; no-op if already present.
create extension if not exists pgcrypto;

-- Server-only Meta credential storage. Authenticated/anonymous roles receive
-- no schema or table privileges; server code uses the service-role boundary.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

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
  vertical        text not null default 'local business',
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

-- Industry-agnostic: vertical is free text (was solar-only). Idempotent upgrades
-- for databases created before the pivot.
alter table public.businesses drop constraint if exists businesses_vertical_check;
alter table public.businesses alter column vertical set default 'local business';

-- Contact details shown on generated ads (and offered to the copywriter).
alter table public.businesses add column if not exists phone   text;
alter table public.businesses add column if not exists email   text;
alter table public.businesses add column if not exists address text;

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
--  Meta Instant Connect: private encrypted credentials + safe metadata
-- ════════════════════════════════════════════════════════════════════════
create table if not exists private.meta_tokens (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid not null references public.businesses (id) on delete cascade,
  authorized_by          uuid not null references auth.users (id),
  subject_id             text not null,
  token_kind             text not null
                           check (token_kind in ('user', 'business_system_user', 'page')),
  ciphertext             bytea not null,
  nonce                  bytea not null check (octet_length(nonce) = 12),
  auth_tag               bytea not null check (octet_length(auth_tag) = 16),
  key_id                 text not null,
  format_version         text not null default 'v1',
  granted_scopes         text[] not null default '{}',
  granted_assets         jsonb not null default '[]',
  expires_at             timestamptz,
  data_access_expires_at timestamptz,
  validated_at           timestamptz,
  revoked_at             timestamptz,
  created_at             timestamptz not null default now(),
  unique (business_id, id)
);

create index if not exists meta_tokens_business_idx
  on private.meta_tokens (business_id, revoked_at, expires_at);

create table if not exists public.meta_connections (
  business_id          uuid primary key references public.businesses (id) on delete cascade,
  token_id             uuid,
  meta_business_id     text,
  ad_account_id        text,
  page_id              text,
  account_name         text,
  page_name            text,
  currency             text check (currency is null or currency ~ '^[A-Z]{3}$'),
  timezone_name        text,
  authorization_status text not null default 'disconnected'
                         check (authorization_status in ('disconnected', 'connected', 'reauth_required', 'revoked')),
  capabilities         jsonb not null default '{}',
  selection_reason     text,
  generation           bigint not null default 0 check (generation >= 0),
  last_checked_at      timestamptz,
  updated_at           timestamptz not null default now(),
  foreign key (business_id, token_id)
    references private.meta_tokens (business_id, id)
);

create table if not exists private.meta_connection_attempts (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses (id) on delete cascade,
  user_id              uuid not null references auth.users (id) on delete cascade,
  token_id             uuid,
  state_hash           text not null unique,
  browser_binding_hash text not null,
  status               text not null check (status in (
                          'authorizing', 'discovering', 'selection_required', 'action_required',
                          'connected', 'cancelled', 'expired', 'failed'
                        )),
  intent               jsonb not null,
  expected_generation  bigint not null default 0 check (expected_generation >= 0),
  revision             bigint not null default 0 check (revision >= 0),
  discovered_assets    jsonb,
  discovery_complete   boolean not null default false,
  error_code           text,
  claimed_at           timestamptz,
  expires_at           timestamptz not null,
  created_at           timestamptz not null default now(),
  foreign key (business_id, token_id)
    references private.meta_tokens (business_id, id)
);

create index if not exists meta_attempts_owner_idx
  on private.meta_connection_attempts (user_id, business_id, expires_at);

alter table private.meta_tokens enable row level security;
alter table private.meta_connection_attempts enable row level security;
alter table public.meta_connections enable row level security;

revoke all on private.meta_tokens from public, anon, authenticated, service_role;
revoke all on private.meta_connection_attempts from public, anon, authenticated, service_role;
revoke all on public.meta_connections from public, anon, authenticated;
grant select, insert, update, delete on public.meta_connections to service_role;

-- Private-table access is mediated by narrowly granted server RPCs below.
drop function if exists public.meta_token_insert(uuid, uuid, uuid, text, text, text, text, text, text, text, text[], jsonb, timestamptz, timestamptz);
create or replace function public.meta_token_insert(
  p_id uuid, p_business_id uuid, p_authorized_by uuid, p_subject_id text,
  p_token_kind text, p_ciphertext text, p_nonce text, p_auth_tag text,
  p_key_id text, p_format_version text, p_granted_scopes text[],
  p_granted_assets jsonb, p_expires_at timestamptz, p_validated_at timestamptz,
  p_data_access_expires_at timestamptz default null
)
returns uuid language plpgsql security definer set search_path = private, public
as $$
begin
  insert into private.meta_tokens
    (id, business_id, authorized_by, subject_id, token_kind, ciphertext, nonce,
     auth_tag, key_id, format_version, granted_scopes, granted_assets, expires_at,
    validated_at, data_access_expires_at)
  values
    (p_id, p_business_id, p_authorized_by, p_subject_id, p_token_kind,
     p_ciphertext::bytea, p_nonce::bytea, p_auth_tag::bytea, p_key_id,
     p_format_version, p_granted_scopes, p_granted_assets, p_expires_at,
    p_validated_at, p_data_access_expires_at);
  return p_id;
end;
$$;

drop function if exists public.meta_token_get(uuid, uuid);
create or replace function public.meta_token_get(p_token_id uuid, p_business_id uuid)
returns table (
  id uuid, business_id uuid, ciphertext bytea, nonce bytea, auth_tag bytea,
  key_id text, format_version text, expires_at timestamptz, revoked_at timestamptz,
  granted_scopes text[], data_access_expires_at timestamptz
)
language sql security definer set search_path = private, public
as $$
  select id, business_id, ciphertext, nonce, auth_tag, key_id, format_version,
         expires_at, revoked_at, granted_scopes, data_access_expires_at
  from private.meta_tokens
  where id = p_token_id and business_id = p_business_id;
$$;

create or replace function public.meta_token_delete(p_token_id uuid, p_business_id uuid)
returns boolean language sql security definer set search_path = private, public
as $$
  with deleted as (
    delete from private.meta_tokens where id = p_token_id and business_id = p_business_id
    returning 1
  ) select exists(select 1 from deleted);
$$;

create or replace function public.meta_attempt_create(
  p_id uuid, p_business_id uuid, p_user_id uuid, p_state_hash text,
  p_browser_binding_hash text, p_status text, p_intent jsonb,
  p_expected_generation bigint, p_expires_at timestamptz
)
returns uuid language plpgsql security definer set search_path = private, public
as $$
begin
  insert into private.meta_connection_attempts
    (id, business_id, user_id, state_hash, browser_binding_hash, status, intent,
     expected_generation, expires_at)
  values
    (p_id, p_business_id, p_user_id, p_state_hash, p_browser_binding_hash,
     p_status, p_intent, p_expected_generation, p_expires_at);
  return p_id;
end;
$$;

create or replace function public.meta_attempt_claim(
  p_state_hash text, p_user_id uuid, p_browser_binding_hash text
)
returns table(attempt_id uuid, business_id uuid, user_id uuid, status text)
language sql security definer set search_path = private, public
as $$
  with claimed as (
    update private.meta_connection_attempts
    set claimed_at = now()
    where state_hash = p_state_hash and user_id = p_user_id
      and browser_binding_hash = p_browser_binding_hash and expires_at > now()
      and claimed_at is null
    returning id, business_id, user_id, status
  ) select id, business_id, user_id, status from claimed;
$$;

create or replace function public.meta_attempt_get(p_attempt_id uuid, p_user_id uuid)
returns table(
  id uuid, business_id uuid, user_id uuid, token_id uuid, intent jsonb, status text,
  revision bigint, discovered_assets jsonb, discovery_complete boolean,
  error_code text, expires_at timestamptz
)
language sql security definer set search_path = private, public
as $$
  select id, business_id, user_id, token_id, intent, status, revision,
         discovered_assets, discovery_complete, error_code, expires_at
  from private.meta_connection_attempts
  where id = p_attempt_id and user_id = p_user_id;
$$;

create or replace function public.meta_attempt_set_discovering(
  p_attempt_id uuid, p_retry boolean default false
)
returns boolean language sql security definer set search_path = private, public
as $$
  with updated as (
    update private.meta_connection_attempts
    set status = 'discovering', revision = revision + 1, error_code = null
    where id = p_attempt_id
      and ((p_retry and status in ('failed', 'action_required'))
        or (not p_retry and status = 'authorizing'))
    returning 1
  ) select exists(select 1 from updated);
$$;

create or replace function public.meta_attempt_retry_claim(p_attempt_id uuid, p_user_id uuid, p_revision bigint)
returns boolean language sql security definer set search_path = private, public
as $$
  with updated as (
    update private.meta_connection_attempts as attempt
    set status = 'discovering', revision = revision + 1, error_code = null
    where id = p_attempt_id and user_id = p_user_id and revision = p_revision
      and expires_at > now() and status in ('failed', 'action_required')
      and exists (select 1 from public.businesses where id = attempt.business_id and owner_id = p_user_id)
      and expected_generation = coalesce((select generation from public.meta_connections where business_id = attempt.business_id), 0)
    returning 1
  ) select exists(select 1 from updated);
$$;
revoke all on function public.meta_attempt_retry_claim(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.meta_attempt_retry_claim(uuid, uuid, bigint) to service_role;

create or replace function public.meta_attempt_attach_token(p_attempt_id uuid, p_token_id uuid)
returns boolean language sql security definer set search_path = private, public
as $$
  with updated as (
    update private.meta_connection_attempts
    set token_id = p_token_id
    where id = p_attempt_id and status = 'discovering' and token_id is null
    returning 1
  ) select exists(select 1 from updated);
$$;

create or replace function public.meta_attempt_action_required(
  p_attempt_id uuid, p_discovered_assets jsonb
)
returns boolean language sql security definer set search_path = private, public
as $$
  with updated as (
    update private.meta_connection_attempts
    set status = 'action_required', revision = revision + 1,
        discovered_assets = p_discovered_assets,
        discovery_complete = coalesce(p_discovered_assets->'complete' = 'true'::jsonb, false),
        error_code = 'SETUP_REQUIRED'
    where id = p_attempt_id and status = 'discovering'
    returning 1
  ) select exists(select 1 from updated);
$$;

create or replace function public.meta_attempt_discovery_result(
  p_attempt_id uuid, p_discovered_assets jsonb, p_status text, p_error_code text
)
returns boolean language sql security definer set search_path = private, public
as $$
  with updated as (
    update private.meta_connection_attempts
    set status = p_status, revision = revision + 1,
        discovered_assets = p_discovered_assets,
        discovery_complete = coalesce(p_discovered_assets->'complete' = 'true'::jsonb, false),
        error_code = p_error_code
    where id = p_attempt_id and status = 'discovering'
      and p_status in ('selection_required', 'action_required')
    returning 1
  ) select exists(select 1 from updated);
$$;

create or replace function public.meta_attempt_failed(p_attempt_id uuid, p_error_code text)
returns boolean language sql security definer set search_path = private, public
as $$
  with updated as (
    update private.meta_connection_attempts
    set status = 'failed', revision = revision + 1, error_code = p_error_code
    where id = p_attempt_id and status <> 'connected'
    returning 1
  ) select exists(select 1 from updated);
$$;

create or replace function public.meta_attempt_cancelled(p_attempt_id uuid)
returns boolean language sql security definer set search_path = private, public
as $$
  with updated as (
    update private.meta_connection_attempts
    set status = 'cancelled', revision = revision + 1
    where id = p_attempt_id and status = 'authorizing'
    returning 1
  ) select exists(select 1 from updated);
$$;

create or replace function public.meta_attempt_commit_selection(
  p_attempt_id uuid, p_user_id uuid, p_pair_id text, p_revision bigint,
  p_confirm_replacement boolean
)
returns boolean language plpgsql security definer set search_path = private, public
as $$
declare
  attempt_row private.meta_connection_attempts%rowtype;
  candidate jsonb;
  assets jsonb;
  changed integer;
begin
  select * into attempt_row
  from private.meta_connection_attempts
  where id = p_attempt_id and user_id = p_user_id
  for update;
  if not found or attempt_row.revision <> p_revision
      or attempt_row.expires_at <= now()
     or not attempt_row.discovery_complete
     or attempt_row.token_id is null
     or attempt_row.status not in ('selection_required', 'action_required') then
    return false;
  end if;
  perform 1 from public.businesses where id = attempt_row.business_id and owner_id = p_user_id for update;
  if not found then return false; end if;
  if coalesce((select generation from public.meta_connections where business_id = attempt_row.business_id), 0) <> attempt_row.expected_generation then
    return false;
  end if;
  perform 1 from private.meta_tokens where id = attempt_row.token_id and business_id = attempt_row.business_id
    and revoked_at is null and (expires_at is null or expires_at > now())
    and (data_access_expires_at is null or data_access_expires_at > now()) for share;
  if not found then return false; end if;
  select value into candidate
  from jsonb_array_elements(case when jsonb_typeof(attempt_row.discovered_assets) = 'array'
    then attempt_row.discovered_assets else coalesce(attempt_row.discovered_assets->'candidates', '[]'::jsonb) end) value
  where value->>'pairId' = p_pair_id and value->>'eligible' = 'true'
  limit 1;
  if candidate is null or (attempt_row.status = 'action_required' and not p_confirm_replacement) then
    return false;
  end if;
  assets := candidate->'assets';
  if assets is null then return false; end if;

  insert into public.meta_connections
    (business_id, token_id, meta_business_id, ad_account_id, page_id, account_name,
     page_name, currency, timezone_name, authorization_status, capabilities,
     selection_reason, generation, last_checked_at)
  values
    (attempt_row.business_id, attempt_row.token_id, assets->>'metaBusinessId',
     assets->>'adAccountId', assets->>'pageId', assets->>'accountName',
     assets->>'pageName', assets->>'currency', assets->>'timezoneName',
     'connected', '{"canReadInsights":{"state":"unknown","blockers":[]},"canReadLeads":{"state":"unknown","blockers":[]},"canCreatePaused":{"state":"unknown","blockers":[]},"canActivate":{"state":"unknown","blockers":[]}}'::jsonb,
     'explicit_selection', attempt_row.expected_generation + 1, now())
  on conflict (business_id) do update set
    token_id = excluded.token_id, meta_business_id = excluded.meta_business_id,
    ad_account_id = excluded.ad_account_id, page_id = excluded.page_id,
    account_name = excluded.account_name, page_name = excluded.page_name,
    currency = excluded.currency, timezone_name = excluded.timezone_name,
    authorization_status = 'connected', capabilities = excluded.capabilities,
    selection_reason = excluded.selection_reason,
    generation = excluded.generation,
    last_checked_at = excluded.last_checked_at, updated_at = now()
  where meta_connections.generation = attempt_row.expected_generation;
  get diagnostics changed = row_count;
  if changed <> 1 then return false; end if;

  update private.meta_connection_attempts
  set status = 'connected', revision = revision + 1, error_code = null
  where id = p_attempt_id and user_id = p_user_id and revision = p_revision;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Meta connection attempt changed during selection'; end if;
  return true;
end;
$$;

create or replace function public.meta_disconnect(p_business_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = private, public
as $$
begin
  perform 1 from public.businesses where id = p_business_id and owner_id = p_user_id for update;
  if not found then return false; end if;
  update private.meta_tokens set revoked_at = coalesce(revoked_at, now()) where business_id = p_business_id;
  update private.meta_connection_attempts set status = 'cancelled', revision = revision + 1
    where business_id = p_business_id and status <> 'connected';
  update public.meta_connections set authorization_status = 'revoked', token_id = null,
    ad_account_id = null, page_id = null, capabilities = '{}', generation = generation + 1, updated_at = now()
    where business_id = p_business_id;
  return true;
end;
$$;
revoke all on function public.meta_disconnect(uuid, uuid) from public, anon, authenticated;
grant execute on function public.meta_disconnect(uuid, uuid) to service_role;

create or replace function public.meta_revoke_subject(p_subject_id text)
returns integer language plpgsql security definer set search_path = private, public
as $$
declare affected_count integer;
begin
  with affected as (
    select distinct business_id from private.meta_tokens where subject_id = p_subject_id
  ), revoked as (
    update private.meta_tokens
    set revoked_at = coalesce(revoked_at, now())
    where subject_id = p_subject_id
    returning business_id
  )
  update public.meta_connections connection
  set token_id = null, ad_account_id = null, page_id = null,
      authorization_status = 'revoked', generation = connection.generation + 1,
      updated_at = now()
  where connection.business_id in (select business_id from affected);
  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'meta_token_insert', 'meta_token_get', 'meta_token_delete',
      'meta_attempt_create', 'meta_attempt_claim', 'meta_attempt_get',
      'meta_attempt_set_discovering', 'meta_attempt_attach_token',
      'meta_attempt_action_required', 'meta_attempt_failed',
      'meta_attempt_cancelled', 'meta_attempt_discovery_result',
      'meta_attempt_commit_selection', 'meta_revoke_subject'
    )
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn.signature);
    execute format('grant execute on function %s to service_role', fn.signature);
  end loop;
end
$$;

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

alter table public.creatives add column if not exists generation jsonb;
create index if not exists creatives_variant_group_idx
  on public.creatives (variant_group);
-- Speeds up the common "approved creatives for a business" filter.
create index if not exists creatives_business_status_idx
  on public.creatives (business_id, status);

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
-- One row per Meta campaign per business, so "Sync from Meta" can't duplicate.
create unique index if not exists campaigns_meta_campaign_id_uidx
  on public.campaigns (business_id, meta_campaign_id)
  where meta_campaign_id is not null;

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
-- Matches the "latest result per campaign" ordering (campaign_id, fetched_at desc).
create index if not exists campaign_results_campaign_fetched_idx
  on public.campaign_results (campaign_id, fetched_at desc);

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

-- ════════════════════════════════════════════════════════════════════════
--  campaigns: extra Meta object references + raw snapshot (observability)
-- ════════════════════════════════════════════════════════════════════════
alter table public.campaigns
  add column if not exists meta_adset_id text,
  add column if not exists meta_ad_ids   text[] not null default '{}',
  add column if not exists raw           jsonb,
  add column if not exists meta_ad_account_id text,
  add column if not exists meta_page_id text,
  add column if not exists meta_connection_generation bigint;

create index if not exists campaigns_binding_idx
  on public.campaigns (business_id, meta_ad_account_id, meta_page_id);

-- ════════════════════════════════════════════════════════════════════════
--  campaign_drafts: durable manual/guided campaign intent
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.campaign_drafts (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  version     bigint not null default 1 check (version >= 1),
  input       jsonb not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (business_id, id)
);

create index if not exists campaign_drafts_owner_idx
  on public.campaign_drafts (owner_id, business_id, updated_at desc);

alter table public.campaign_drafts enable row level security;
drop policy if exists "campaign drafts: own business" on public.campaign_drafts;
create policy "campaign drafts: own business"
  on public.campaign_drafts for all
  using (public.owns_business(business_id))
  with check (public.owns_business(business_id) and owner_id = auth.uid());

-- ════════════════════════════════════════════════════════════════════════
--  campaign_operations: durable external mutation/idempotency ledger
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.campaign_operations (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses (id) on delete cascade,
  draft_id              uuid not null references public.campaign_drafts (id) on delete restrict,
  campaign_id           uuid references public.campaigns (id) on delete set null,
  draft_version         bigint not null check (draft_version >= 1),
  connection_generation bigint not null check (connection_generation >= 0),
  kind                  text not null check (kind in ('campaign_create')),
  idempotency_key       text not null check (length(idempotency_key) between 8 and 200),
  request_hash          text not null check (length(request_hash) = 64),
  state                 text not null check (state in ('pending', 'running', 'succeeded', 'failed', 'needs_reconciliation')),
  phase                 text not null check (phase in ('campaign', 'adset', 'creative', 'ad', 'reconcile', 'complete')),
  lease_until           timestamptz,
  attempt_count         integer not null default 0 check (attempt_count >= 0),
  payload               jsonb not null default '{}',
  result                jsonb,
  external_ids          jsonb not null default '[]',
  sanitized_error       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (business_id, kind, idempotency_key),
  unique (business_id, id, draft_id),
  foreign key (business_id, draft_id)
    references public.campaign_drafts (business_id, id) on delete restrict
);

create index if not exists campaign_operations_lease_idx
  on public.campaign_operations (state, lease_until);
create index if not exists campaign_operations_owner_idx
  on public.campaign_operations (business_id, created_at desc);

alter table public.campaign_operations enable row level security;
drop policy if exists "campaign operations: own business" on public.campaign_operations;
create policy "campaign operations: own business"
  on public.campaign_operations for select to authenticated
  using (public.owns_business(business_id));
revoke all on public.campaign_operations from public, anon, authenticated;
grant select on public.campaign_operations to authenticated;
grant select, insert, update, delete on public.campaign_operations to service_role;

create unique index if not exists campaign_operations_draft_id_uidx on public.campaign_operations(draft_id);

create or replace function public.update_campaign_draft_if_version(
  p_draft_id uuid,
  p_business_id uuid,
  p_owner_id uuid,
  p_expected_version bigint,
  p_input jsonb,
  p_now timestamptz default now()
)
returns setof public.campaign_drafts
language sql
security invoker
set search_path = public
as $$
  update public.campaign_drafts
  set input = p_input, version = version + 1, updated_at = p_now
  where id = p_draft_id and business_id = p_business_id and owner_id = p_owner_id
    and version = p_expected_version and expires_at > p_now
    and not exists (select 1 from public.campaign_operations where draft_id = p_draft_id)
  returning *;
$$;

revoke execute on function public.update_campaign_draft_if_version(uuid, uuid, uuid, bigint, jsonb, timestamptz) from public;
grant execute on function public.update_campaign_draft_if_version(uuid, uuid, uuid, bigint, jsonb, timestamptz) to authenticated;

create or replace function public.claim_campaign_operation(
  p_operation_id uuid, p_business_id uuid, p_draft_id uuid, p_draft_version bigint,
  p_connection_generation bigint, p_kind text, p_idempotency_key text,
  p_request_hash text, p_lease_until timestamptz, p_payload jsonb default '{}',
  p_now timestamptz default now()
)
returns setof public.campaign_operations
language plpgsql
security invoker
set search_path = public
as $$
declare current_operation public.campaign_operations;
begin
  perform pg_advisory_xact_lock(hashtextextended(json_build_array(p_business_id, p_kind, p_idempotency_key)::text, 0));
  perform 1 from public.meta_connections
  where business_id = p_business_id and generation = p_connection_generation
    and authorization_status = 'connected' for share;
  if not found or p_lease_until <= now() then return; end if;
  perform 1 from public.campaign_drafts
    where id = p_draft_id and business_id = p_business_id and version = p_draft_version
      and expires_at > now() for update;
  if not found then return; end if;
  if exists (select 1 from public.campaign_operations where draft_id = p_draft_id
    and (kind <> p_kind or idempotency_key <> p_idempotency_key)) then return; end if;
  select * into current_operation from public.campaign_operations
  where business_id = p_business_id and kind = p_kind and idempotency_key = p_idempotency_key
  for update;
  if not found then
    insert into public.campaign_operations
      (id, business_id, draft_id, draft_version, connection_generation, kind,
       idempotency_key, request_hash, state, phase, lease_until, attempt_count, payload)
    values
      (p_operation_id, p_business_id, p_draft_id, p_draft_version, p_connection_generation,
       p_kind, p_idempotency_key, p_request_hash, 'running', 'campaign', p_lease_until, 1, p_payload)
    returning * into current_operation;
  elsif current_operation.request_hash = p_request_hash
    and current_operation.connection_generation = p_connection_generation
    and current_operation.state in ('pending', 'running')
    and (current_operation.lease_until is null or current_operation.lease_until <= now()) then
    update public.campaign_operations
    set state = 'needs_reconciliation', phase = 'reconcile', lease_until = null,
        sanitized_error = 'Operation expired with an unverified external outcome.', updated_at = now()
    where id = current_operation.id
    returning * into current_operation;
  elsif current_operation.state in ('pending', 'running') then
    return;
  end if;
  return next current_operation;
end;
$$;

create or replace function public.checkpoint_campaign_operation(
  p_operation_id uuid, p_business_id uuid, p_connection_generation bigint,
  p_phase text, p_lease_until timestamptz, p_external_ids jsonb,
  p_campaign_id uuid default null, p_now timestamptz default now()
)
returns setof public.campaign_operations
language sql
security invoker
set search_path = public
as $$
  update public.campaign_operations
  set phase = p_phase, lease_until = p_lease_until, external_ids = p_external_ids,
      campaign_id = coalesce(p_campaign_id, campaign_id), updated_at = p_now
  where id = p_operation_id and business_id = p_business_id
    and connection_generation = p_connection_generation and state = 'running'
    and lease_until > now()
    and exists (select 1 from public.meta_connections connection
      where connection.business_id = p_business_id and connection.generation = p_connection_generation
        and connection.authorization_status = 'connected')
  returning *;
$$;

create or replace function public.finish_campaign_operation(
  p_operation_id uuid, p_business_id uuid, p_connection_generation bigint,
  p_campaign_id uuid, p_result jsonb, p_now timestamptz default now()
)
returns setof public.campaign_operations
language sql
security invoker
set search_path = public
as $$
  update public.campaign_operations
  set state = 'succeeded', phase = 'complete', lease_until = null,
      campaign_id = p_campaign_id, result = p_result, sanitized_error = null, updated_at = p_now
  where id = p_operation_id and business_id = p_business_id
    and connection_generation = p_connection_generation and state = 'running'
    and lease_until > now()
    and exists (select 1 from public.meta_connections connection
      where connection.business_id = p_business_id and connection.generation = p_connection_generation
        and connection.authorization_status = 'connected')
  returning *;
$$;

create or replace function public.fail_campaign_operation(
  p_operation_id uuid, p_business_id uuid, p_connection_generation bigint,
  p_state text, p_external_ids jsonb, p_campaign_id uuid default null, p_error text default null
)
returns setof public.campaign_operations language plpgsql security invoker set search_path = public
as $$
declare
  current_operation public.campaign_operations;
  known_ids jsonb;
  next_state text;
begin
  if p_state not in ('failed', 'needs_reconciliation') or jsonb_typeof(p_external_ids) <> 'array' then return; end if;
  select * into current_operation from public.campaign_operations
  where id = p_operation_id and business_id = p_business_id
    and connection_generation = p_connection_generation
    and state in ('running', 'needs_reconciliation') for update;
  if not found then return; end if;
  if p_campaign_id is not null and not exists (
    select 1 from public.campaigns where id = p_campaign_id and business_id = p_business_id
  ) then return; end if;
  select coalesce(jsonb_agg(external_id), '[]'::jsonb) into known_ids
  from (select distinct value as external_id from jsonb_array_elements_text(current_operation.external_ids || p_external_ids)) known;
  next_state := case when p_state = 'failed' and current_operation.state = 'running'
    and current_operation.lease_until > now() and jsonb_array_length(known_ids) = 0
    and coalesce(p_campaign_id, current_operation.campaign_id) is null then 'failed' else 'needs_reconciliation' end;
  return query update public.campaign_operations
  set state = next_state, phase = case when next_state = 'failed' then 'complete' else 'reconcile' end,
    external_ids = known_ids, campaign_id = coalesce(p_campaign_id, current_operation.campaign_id),
    lease_until = null, sanitized_error = left(p_error, 240), updated_at = now()
  where id = current_operation.id returning *;
end;
$$;

create or replace function public.expire_campaign_operation(p_operation_id uuid, p_business_id uuid)
returns setof public.campaign_operations language plpgsql security invoker set search_path = public
as $$ begin
  update public.campaign_operations set state = 'needs_reconciliation', phase = 'reconcile',
    lease_until = null, sanitized_error = 'Operation expired with an unverified external outcome.', updated_at = now()
  where id = p_operation_id and business_id = p_business_id and state in ('pending', 'running')
    and (lease_until is null or lease_until <= now());
  return query select * from public.campaign_operations where id = p_operation_id and business_id = p_business_id;
end; $$;

revoke execute on function public.fail_campaign_operation(uuid, uuid, bigint, text, jsonb, uuid, text) from public, anon, authenticated;
revoke execute on function public.expire_campaign_operation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fail_campaign_operation(uuid, uuid, bigint, text, jsonb, uuid, text) to service_role;
grant execute on function public.expire_campaign_operation(uuid, uuid) to service_role;

revoke execute on function public.claim_campaign_operation(uuid, uuid, uuid, bigint, bigint, text, text, text, timestamptz, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.checkpoint_campaign_operation(uuid, uuid, bigint, text, timestamptz, jsonb, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.finish_campaign_operation(uuid, uuid, bigint, uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_campaign_operation(uuid, uuid, uuid, bigint, bigint, text, text, text, timestamptz, jsonb, timestamptz) to service_role;
grant execute on function public.checkpoint_campaign_operation(uuid, uuid, bigint, text, timestamptz, jsonb, uuid, timestamptz) to service_role;
grant execute on function public.finish_campaign_operation(uuid, uuid, bigint, uuid, jsonb, timestamptz) to service_role;

-- Imported (Meta-created) campaigns carry a name and may lack a campaign budget.
alter table public.campaigns add column if not exists name text;
alter table public.campaigns alter column daily_budget drop not null;

-- ════════════════════════════════════════════════════════════════════════
--  ad_instructions: per-customer instruction files that guide ad creation
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.ad_instructions (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  title       text not null,
  content     text not null default '',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists ad_instructions_business_id_idx
  on public.ad_instructions (business_id);

drop trigger if exists ad_instructions_set_updated_at on public.ad_instructions;
create trigger ad_instructions_set_updated_at
  before update on public.ad_instructions
  for each row execute function public.set_updated_at();

alter table public.ad_instructions enable row level security;

drop policy if exists "ad_instructions: all own" on public.ad_instructions;
create policy "ad_instructions: all own"
  on public.ad_instructions for all
  using (public.owns_business(business_id))
  with check (public.owns_business(business_id));

-- ════════════════════════════════════════════════════════════════════════
--  audit_log: append-only observability of every change (who/what/when/why)
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.audit_log (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid references public.businesses (id) on delete cascade,
  actor_id       uuid references auth.users (id) on delete set null,
  actor_label    text,
  action         text not null,
  entity_type    text not null,
  entity_id      text,
  meta_object_id text,
  reason         text,
  details        jsonb not null default '{}',
  created_at     timestamptz not null default now()
);

create index if not exists audit_log_business_id_idx
  on public.audit_log (business_id, created_at desc);
create index if not exists audit_log_entity_idx
  on public.audit_log (entity_type, entity_id);

alter table public.audit_log enable row level security;

-- Append-only: owners can read and insert their own business's events; the
-- absence of update/delete policies denies those for non-service roles.
drop policy if exists "audit_log: select own" on public.audit_log;
create policy "audit_log: select own"
  on public.audit_log for select
  using (public.owns_business(business_id));

drop policy if exists "audit_log: insert own" on public.audit_log;
create policy "audit_log: insert own"
  on public.audit_log for insert
  with check (business_id is not null and public.owns_business(business_id));

-- ════════════════════════════════════════════════════════════════════════
--  leads: instant-form leads pulled from Meta into one inbox
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.leads (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  campaign_id  uuid references public.campaigns (id) on delete set null,
  meta_lead_id text not null,
  form_id      text,
  form_name    text,
  full_name    text,
  phone        text,
  email        text,
  city         text,
  field_data   jsonb not null default '{}',
  created_time timestamptz,
  created_at   timestamptz not null default now(),
  unique (business_id, meta_lead_id)
);

create index if not exists leads_business_id_idx
  on public.leads (business_id, created_time desc);
create index if not exists leads_campaign_id_idx
  on public.leads (campaign_id);

alter table public.leads enable row level security;

drop policy if exists "leads: all own" on public.leads;
create policy "leads: all own"
  on public.leads for all
  using (public.owns_business(business_id))
  with check (public.owns_business(business_id));

-- ════════════════════════════════════════════════════════════════════════
--  rate_limit_hits: shared (cross-instance) sliding-window rate limiting
--  Only the SECURITY DEFINER function below touches this table (RLS on, no
--  policies), so counts can't be read or tampered with by clients.
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.rate_limit_hits (
  key    text        not null,
  hit_at timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════════════════
--  llm_usage_events  (persistent paid-model usage and quota accounting)
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.llm_usage_events (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses (id) on delete cascade,
  user_id           uuid references auth.users (id) on delete set null,
  route             text not null,
  usage_kind        text not null default 'text'
                    check (usage_kind in ('text', 'image')),
  provider          text not null,
  model             text not null,
  prompt_tokens     integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens      integer not null default 0,
  estimated_cost_usd numeric(12, 8) not null default 0,
  prompt_version    text,
  input_chars       integer not null default 0,
  output_chars      integer not null default 0,
  temperature       numeric(5, 3),
  max_tokens        integer,
  cache_hit         boolean not null default false,
  latency_ms        integer,
  attempt           integer not null default 1,
  status            text not null default 'success'
                    check (status in ('success', 'error', 'fallback')),
  error_code        text,
  image_width       integer,
  image_height      integer,
  metadata          jsonb not null default '{}'::jsonb,
  request_id        text,
  created_at        timestamptz not null default now()
);

-- Idempotent telemetry upgrades for databases created before detailed usage
-- logging. Never store raw prompts, brand fields, API keys, or image bytes here.
alter table public.llm_usage_events add column if not exists usage_kind text not null default 'text';
alter table public.llm_usage_events add column if not exists prompt_version text;
alter table public.llm_usage_events add column if not exists input_chars integer not null default 0;
alter table public.llm_usage_events add column if not exists output_chars integer not null default 0;
alter table public.llm_usage_events add column if not exists temperature numeric(5, 3);
alter table public.llm_usage_events add column if not exists max_tokens integer;
alter table public.llm_usage_events add column if not exists cache_hit boolean not null default false;
alter table public.llm_usage_events add column if not exists latency_ms integer;
alter table public.llm_usage_events add column if not exists attempt integer not null default 1;
alter table public.llm_usage_events add column if not exists status text not null default 'success';
alter table public.llm_usage_events add column if not exists error_code text;
alter table public.llm_usage_events add column if not exists image_width integer;
alter table public.llm_usage_events add column if not exists image_height integer;
alter table public.llm_usage_events add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists llm_usage_events_business_month_idx
  on public.llm_usage_events (business_id, created_at);

alter table public.llm_usage_events enable row level security;

drop policy if exists "llm_usage_events: own business" on public.llm_usage_events;
create policy "llm_usage_events: own business"
  on public.llm_usage_events for select
  using (public.owns_business(business_id));

drop policy if exists "llm_usage_events: insert own business" on public.llm_usage_events;
create policy "llm_usage_events: insert own business"
  on public.llm_usage_events for insert
  with check (public.owns_business(business_id));

create index if not exists rate_limit_hits_key_time_idx
  on public.rate_limit_hits (key, hit_at);

alter table public.rate_limit_hits enable row level security;

-- Atomically check a sliding-window limit and record the hit when allowed.
-- Runs as owner (bypasses RLS); callable by signed-in users via RPC.
create or replace function public.check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_ms integer
)
returns table(allowed boolean, retry_after_ms integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window interval := make_interval(secs => p_window_ms / 1000.0);
  v_count integer;
  v_oldest timestamptz;
begin
  -- Opportunistic cleanup of anything well outside any active window.
  delete from public.rate_limit_hits where hit_at < now() - interval '1 hour';

  select count(*), min(hit_at)
    into v_count, v_oldest
    from public.rate_limit_hits
   where key = p_key and hit_at > now() - v_window;

  if v_count >= p_limit then
    return query
      select false,
             greatest(
               0,
               extract(epoch from (v_oldest + v_window - now())) * 1000
             )::integer;
  else
    insert into public.rate_limit_hits(key) values (p_key);
    return query select true, 0;
  end if;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public;
grant execute on function public.check_rate_limit(text, integer, integer)
  to authenticated, anon;

-- ════════════════════════════════════════════════════════════════════════
--  spend_limits: per-business ad-spend guardrails (weekly cap + auto-pause)
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.spend_limits (
  business_id       uuid primary key references public.businesses (id) on delete cascade,
  weekly_cap_rupees integer,  -- null = no cap
  alert_pct         integer not null default 80 check (alert_pct between 1 and 100),
  auto_pause        boolean not null default false,
  updated_at        timestamptz not null default now()
);

alter table public.spend_limits enable row level security;

drop policy if exists "spend_limits: all own" on public.spend_limits;
create policy "spend_limits: all own"
  on public.spend_limits for all
  using (public.owns_business(business_id))
  with check (public.owns_business(business_id));



