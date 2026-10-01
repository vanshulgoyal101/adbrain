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

-- Declared, opt-in preferences are private to the owner and business.
create table if not exists public.preference_settings (
  business_id uuid not null references public.businesses(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  epoch bigint not null default 0 check (epoch >= 0),
  updated_at timestamptz not null default now(),
  primary key (business_id, owner_id)
);

create table if not exists public.declared_preferences (
  business_id uuid not null,
  owner_id uuid not null,
  category text not null check (category in ('copy_length', 'tone', 'language', 'visual_style', 'layout_density', 'creative_dislikes', 'workflow')),
  value text not null check (char_length(value) between 1 and 160),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  primary key (business_id, owner_id, category),
  foreign key (business_id, owner_id) references public.preference_settings(business_id, owner_id) on delete cascade
);

alter table public.preference_settings enable row level security;
alter table public.declared_preferences enable row level security;
revoke all on public.preference_settings, public.declared_preferences from public, anon, authenticated;
grant select on public.preference_settings, public.declared_preferences to authenticated;
drop policy if exists "preference settings: read own" on public.preference_settings;
create policy "preference settings: read own" on public.preference_settings for select to authenticated
  using (owner_id = auth.uid() and public.owns_business(business_id));
drop policy if exists "declared preferences: read own" on public.declared_preferences;
create policy "declared preferences: read own" on public.declared_preferences for select to authenticated
  using (owner_id = auth.uid() and public.owns_business(business_id));

create or replace function public.change_declared_preferences(
  p_business_id uuid, p_operation text, p_expected_epoch bigint,
  p_category text default null, p_value text default null
) returns bigint language plpgsql security definer set search_path = public
as $$
declare current_settings public.preference_settings;
begin
  if auth.uid() is null then raise exception 'Unauthenticated' using errcode = '42501'; end if;
  perform 1 from public.businesses where id = p_business_id and owner_id = auth.uid() for update;
  if not found then raise exception 'Business unavailable' using errcode = '42501'; end if;
  if p_operation is null or p_operation not in ('enable', 'pause', 'save', 'forget', 'clear') then
    raise exception 'Invalid preference operation' using errcode = '22023';
  end if;
  insert into public.preference_settings (business_id, owner_id) values (p_business_id, auth.uid())
    on conflict do nothing;
  select * into current_settings from public.preference_settings
    where business_id = p_business_id and owner_id = auth.uid() for update;
  if current_settings.epoch is distinct from p_expected_epoch then
    raise exception 'Preferences changed; reload before saving' using errcode = '40001';
  end if;
  if p_operation = 'save' then
    if not current_settings.enabled then raise exception 'Preferences are paused' using errcode = '22023'; end if;
    if p_category is null or p_category not in ('copy_length', 'tone', 'language', 'visual_style', 'layout_density', 'creative_dislikes', 'workflow')
      or p_value is null or char_length(trim(p_value)) not between 1 and 160
      or p_value ~ '[[:cntrl:]]' or p_value like '%' || chr(8377) || '%'
      or p_value ~* '(https?://|www\.|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|[0-9]{6,}|[$][0-9]|api[_ -]?key|password|secret|token|budget|spend|inr|rupees|per day|daily|weekly|monthly|city|location|target|service area|deadline|offer|discount|guarantee|price|approval|activate|religion|ethnicity|medical|health condition|credit card|phone number|ignore (all|previous|system|developer)|system prompt|you must|override (rules|safety))' then
      raise exception 'Invalid preference content' using errcode = '22023';
    end if;
    if not exists (select 1 from public.declared_preferences where business_id = p_business_id and owner_id = auth.uid() and category = p_category)
      and (select count(*) from public.declared_preferences where business_id = p_business_id and owner_id = auth.uid()) >= 12 then
      raise exception 'Preference limit reached' using errcode = '22023';
    end if;
    insert into public.declared_preferences (business_id, owner_id, category, value)
      values (p_business_id, auth.uid(), p_category, trim(p_value))
      on conflict (business_id, owner_id, category) do update
        set value = excluded.value, version = declared_preferences.version + 1, updated_at = now();
  elsif p_operation = 'forget' then
    if p_category is null or p_category not in ('copy_length', 'tone', 'language', 'visual_style', 'layout_density', 'creative_dislikes', 'workflow') then
      raise exception 'Invalid preference category' using errcode = '22023';
    end if;
    delete from public.declared_preferences where business_id = p_business_id and owner_id = auth.uid() and category = p_category;
  elsif p_operation = 'clear' then
    delete from public.declared_preferences where business_id = p_business_id and owner_id = auth.uid();
  elsif p_operation = 'pause' then
    update public.preference_settings set enabled = false where business_id = p_business_id and owner_id = auth.uid();
  elsif p_operation = 'enable' then
    update public.preference_settings set enabled = true where business_id = p_business_id and owner_id = auth.uid();
  end if;
  update public.preference_settings set epoch = epoch + 1, updated_at = now()
    where business_id = p_business_id and owner_id = auth.uid() returning epoch into current_settings.epoch;
  return current_settings.epoch;
end
$$;
revoke all on function public.change_declared_preferences(uuid, text, bigint, text, text) from public, anon, service_role;
grant execute on function public.change_declared_preferences(uuid, text, bigint, text, text) to authenticated;

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
create index if not exists campaigns_business_created_id_idx
  on public.campaigns (business_id, created_at desc, id desc);
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

alter table public.campaign_results
  add column if not exists conversations bigint check (conversations >= 0),
  add column if not exists cost_per_conversation numeric(12, 2) check (cost_per_conversation >= 0);

create index if not exists campaign_results_campaign_id_idx
  on public.campaign_results (campaign_id);
-- Matches the "latest result per campaign" ordering (campaign_id, fetched_at desc).
create index if not exists campaign_results_campaign_fetched_idx
  on public.campaign_results (campaign_id, fetched_at desc);

alter table public.campaigns
  add column if not exists destination text not null default 'unknown'
    check (destination in ('instant_form', 'whatsapp', 'call', 'mixed', 'unknown'));
alter table public.campaign_results
  add column if not exists destination text not null default 'unknown'
    check (destination in ('instant_form', 'whatsapp', 'call', 'mixed', 'unknown')),
  add column if not exists period_start date,
  add column if not exists period_end date;

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

create or replace function public.initialize_owned_campaign_draft()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if current_user = 'authenticated' then
    if new.owner_id is distinct from auth.uid() or not public.owns_business(new.business_id) then
      raise exception 'Draft owner mismatch' using errcode = '42501';
    end if;
    perform 1 from public.businesses where id = new.business_id for update;
    if (select count(*) from public.campaign_drafts draft
      where draft.business_id = new.business_id and draft.expires_at > now()
        and not exists (select 1 from public.campaign_operations operation where operation.draft_id = draft.id)) >= 50 then
      raise exception 'Draft limit reached' using errcode = '23514';
    end if;
    new.version := 1;
    new.created_at := now();
    new.updated_at := now();
    new.expires_at := now() + interval '7 days';
  end if;
  return new;
end;
$$;
revoke all on function public.initialize_owned_campaign_draft() from public, anon, authenticated;
create trigger initialize_owned_campaign_draft before insert on public.campaign_drafts
  for each row execute function public.initialize_owned_campaign_draft();

create or replace function public.update_campaign_draft_if_version(
  p_draft_id uuid,
  p_business_id uuid,
  p_owner_id uuid,
  p_expected_version bigint,
  p_input jsonb,
  p_now timestamptz default now()
)
returns setof public.campaign_drafts
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_owner_id is distinct from auth.uid() or not public.owns_business(p_business_id) then
    raise exception 'Draft owner mismatch' using errcode = '42501';
  end if;
  if p_expected_version < 1 or p_expected_version >= 9007199254740991
    or p_input is null or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 65536 then
    raise exception 'Invalid draft input' using errcode = '23514';
  end if;
  perform 1 from public.campaign_drafts where id = p_draft_id
    and business_id = p_business_id and owner_id = p_owner_id for update;
  if not found then return; end if;
  return query update public.campaign_drafts
    set input = p_input, version = version + 1, updated_at = now()
    where id = p_draft_id and version = p_expected_version and expires_at > now()
      and not exists (select 1 from public.campaign_operations where draft_id = p_draft_id)
    returning *;
end;
$$;

revoke execute on function public.update_campaign_draft_if_version(uuid, uuid, uuid, bigint, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.update_campaign_draft_if_version(uuid, uuid, uuid, bigint, jsonb, timestamptz) to authenticated;

create or replace function public.delete_campaign_draft_if_version(p_draft_id uuid, p_expected_version bigint)
returns setof public.campaign_drafts
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform 1 from public.campaign_drafts where id = p_draft_id and owner_id = auth.uid()
    and public.owns_business(business_id) for update;
  if not found then return; end if;
  return query delete from public.campaign_drafts
    where id = p_draft_id and version = p_expected_version
    returning *;
end;
$$;
revoke all on function public.delete_campaign_draft_if_version(uuid, bigint) from public, anon, authenticated;
grant execute on function public.delete_campaign_draft_if_version(uuid, bigint) to authenticated;
revoke all on public.campaign_drafts from public, anon, authenticated;
grant select, insert on public.campaign_drafts to authenticated;

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

revoke all on public.campaigns, public.campaign_results, public.audit_log from public, anon, authenticated;
grant select on public.campaigns, public.campaign_results, public.audit_log to authenticated;
revoke delete, truncate on public.businesses from public, anon, authenticated;
revoke all on public.audit_log from service_role;
grant select on public.audit_log to service_role;
alter table public.audit_log add column authority text not null default 'legacy_unverified'
  check (authority in ('legacy_unverified', 'server'));

create or replace function public.append_verified_audit_event(
  p_business_id uuid, p_actor_id uuid, p_action text, p_entity_type text,
  p_entity_id text default null, p_meta_object_id text default null,
  p_reason text default null, p_details jsonb default '{}', p_system_actor text default null
)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  actor_label text;
  event_id uuid;
begin
  if p_actor_id is not null then
    perform 1 from public.businesses where id = p_business_id and owner_id = p_actor_id for share;
    if not found or p_system_actor is not null then
      raise exception 'Audit owner mismatch' using errcode = '42501';
    end if;
    select coalesce(email, 'owner') into actor_label from auth.users where id = p_actor_id;
  else
    if p_system_actor is null or p_system_actor not in ('cron', 'worker') then
      raise exception 'Explicit system identity required' using errcode = '23514';
    end if;
    actor_label := p_system_actor;
  end if;
  insert into public.audit_log(business_id, actor_id, actor_label, action, entity_type,
    entity_id, meta_object_id, reason, details, authority, created_at)
  values (p_business_id, p_actor_id, actor_label, p_action, p_entity_type,
    p_entity_id, p_meta_object_id, p_reason, p_details, 'server', now()) returning id into event_id;
  return event_id;
end;
$$;
revoke all on function public.append_verified_audit_event(uuid, uuid, text, text, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.append_verified_audit_event(uuid, uuid, text, text, text, text, text, jsonb, text) to service_role;

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

create table if not exists public.lead_sync_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  generation bigint not null,
  ad_account_id text not null,
  page_id text not null,
  state text not null default 'partial' check (state in ('partial', 'complete')),
  version bigint not null default 0 check (version >= 0),
  progress jsonb not null default '{"formsDone":false,"formsAfter":null,"formsSeen":[],"formIds":[],"pending":[],"discover":true}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(progress) = 'object')
);
create index if not exists lead_sync_runs_business_idx on public.lead_sync_runs(business_id, created_at desc);
alter table public.lead_sync_runs enable row level security;
revoke all on public.lead_sync_runs from public, anon, authenticated;
grant select, insert, update on public.lead_sync_runs to service_role;

create or replace function public.lead_sync_start(
  p_business_id uuid, p_owner_id uuid, p_sync_id uuid,
  p_generation bigint, p_ad_account_id text, p_page_id text
) returns setof public.lead_sync_runs
language plpgsql security invoker set search_path = public
as $$
declare current_run public.lead_sync_runs;
begin
  perform 1 from public.businesses where id = p_business_id and owner_id = p_owner_id for update;
  if not found then raise exception 'Business unavailable' using errcode = '42501'; end if;
  perform 1 from public.meta_connections where business_id = p_business_id
    and generation = p_generation and ad_account_id = p_ad_account_id and page_id = p_page_id
    and authorization_status = 'connected' for share;
  if not found then raise exception 'Meta binding changed' using errcode = '40001'; end if;
  if p_sync_id is not null then
    select * into current_run from public.lead_sync_runs
      where id = p_sync_id and business_id = p_business_id and owner_id = p_owner_id for update;
    if not found then raise exception 'Sync unavailable' using errcode = 'P0002'; end if;
    if current_run.generation <> p_generation or current_run.ad_account_id <> p_ad_account_id or current_run.page_id <> p_page_id then
      raise exception 'Sync binding changed; start a fresh sync' using errcode = '40001';
    end if;
  else
    select * into current_run from public.lead_sync_runs
      where business_id = p_business_id and owner_id = p_owner_id and generation = p_generation
        and ad_account_id = p_ad_account_id and page_id = p_page_id and state = 'partial'
      order by created_at desc limit 1 for update;
    if not found then
      insert into public.lead_sync_runs(business_id, owner_id, generation, ad_account_id, page_id)
        values (p_business_id, p_owner_id, p_generation, p_ad_account_id, p_page_id) returning * into current_run;
    end if;
  end if;
  return next current_run;
end
$$;

create or replace function public.lead_sync_checkpoint(
  p_business_id uuid, p_owner_id uuid, p_sync_id uuid,
  p_generation bigint, p_ad_account_id text, p_page_id text,
  p_version bigint, p_rows jsonb, p_progress jsonb
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare current_run public.lead_sync_runs; inserted_count integer;
begin
  select * into current_run from public.lead_sync_start(p_business_id, p_owner_id, p_sync_id, p_generation, p_ad_account_id, p_page_id);
  if current_run.version <> p_version or current_run.state <> 'partial' then
    raise exception 'Sync progress changed; reload and resume' using errcode = '40001';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200
    or p_progress is null or jsonb_typeof(p_progress) <> 'object'
    or jsonb_typeof(p_progress->'pending') is distinct from 'array'
    or jsonb_typeof(p_progress->'formsDone') is distinct from 'boolean' then
    raise exception 'Invalid sync checkpoint' using errcode = '22023';
  end if;
  insert into public.leads(business_id, meta_lead_id, form_id, form_name, full_name, phone, email, city, field_data, created_time)
    select p_business_id, incoming.meta_lead_id, incoming.form_id, incoming.form_name,
      incoming.full_name, incoming.phone, incoming.email, incoming.city, coalesce(incoming.field_data, '{}'), incoming.created_time
    from jsonb_to_recordset(p_rows) as incoming(meta_lead_id text, form_id text, form_name text,
      full_name text, phone text, email text, city text, field_data jsonb, created_time timestamptz)
    on conflict (business_id, meta_lead_id) do nothing;
  get diagnostics inserted_count = row_count;
  update public.lead_sync_runs set progress = p_progress, version = version + 1, updated_at = now(),
    state = case when (p_progress->>'formsDone')::boolean and jsonb_array_length(p_progress->'pending') = 0 then 'complete' else 'partial' end
    where id = current_run.id returning * into current_run;
  return jsonb_build_object('run', to_jsonb(current_run), 'imported', inserted_count);
end
$$;

revoke all on function public.lead_sync_start(uuid, uuid, uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function public.lead_sync_checkpoint(uuid, uuid, uuid, bigint, text, text, bigint, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.lead_sync_start(uuid, uuid, uuid, bigint, text, text) to service_role;
grant execute on function public.lead_sync_checkpoint(uuid, uuid, uuid, bigint, text, text, bigint, jsonb, jsonb) to service_role;

alter table public.leads
  add column if not exists workflow_status text not null default 'new'
    check (workflow_status in ('new', 'contacted', 'qualified', 'booked', 'closed')),
  add column if not exists follow_up_note text not null default ''
    check (char_length(follow_up_note) <= 2000);

create index if not exists leads_inbox_cursor_idx
  on public.leads (business_id, created_time desc nulls last, id);
create index if not exists leads_workflow_idx
  on public.leads (business_id, workflow_status);

create or replace function public.get_lead_page(
  p_business_id uuid, p_query text default '', p_status text default 'all',
  p_contact text default 'all', p_sort text default 'newest', p_limit integer default 50,
  p_after_id uuid default null, p_after_key text default '', p_after_null boolean default false
) returns jsonb
language plpgsql stable security invoker set search_path = public
as $$
declare result jsonb;
begin
  if not public.owns_business(p_business_id) then
    raise insufficient_privilege using message = 'Business access denied';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_query is null or char_length(p_query) > 200
    or p_status is null or p_status not in ('all', 'new', 'contacted', 'qualified', 'booked', 'closed')
    or p_contact is null or p_contact not in ('all', 'ready', 'missing')
    or p_sort is null or p_sort not in ('newest', 'oldest', 'name')
    or p_after_key is null or p_after_null is null then
    raise invalid_parameter_value using message = 'Invalid enquiry filters';
  end if;
  with matching as materialized (
    select lead as record,
      case when p_sort = 'name' then coalesce(lower(lead.full_name), '')
        else coalesce(to_char(lead.created_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), '') end collate "C" as sort_key,
      case when p_sort = 'name' then lead.full_name is null else lead.created_time is null end as missing_key
    from public.leads lead
    where lead.business_id = p_business_id
      and (p_status = 'all' or lead.workflow_status = p_status)
      and (p_query = '' or strpos(lower(concat_ws(' ', lead.full_name, lead.phone, lead.email, lead.city, lead.form_name)), lower(p_query)) > 0)
      and (p_contact = 'all' or
        (coalesce(btrim(lead.phone), '') <> '' or coalesce(btrim(lead.email), '') <> '') = (p_contact = 'ready'))
  ), candidates as (
    select * from matching
    where p_after_id is null or missing_key > p_after_null
      or (missing_key = p_after_null and (
        case when p_sort = 'newest' then sort_key < p_after_key collate "C"
          else sort_key > p_after_key collate "C" end
        or (sort_key = p_after_key collate "C" and (record).id > p_after_id)))
  ), numbered as (
    select *, row_number() over (order by missing_key,
      case when p_sort = 'newest' then sort_key end desc,
      case when p_sort <> 'newest' then sort_key end asc, (record).id) as position
    from candidates
    order by missing_key,
      case when p_sort = 'newest' then sort_key end desc,
      case when p_sort <> 'newest' then sort_key end asc, (record).id
    limit p_limit + 1
  )
  select jsonb_build_object(
    'leads', coalesce((select jsonb_agg(to_jsonb(record) order by position) from numbered where position <= p_limit), '[]'::jsonb),
    'total', (select count(*) from matching),
    'nextCursor', case when exists (select 1 from numbered where position > p_limit)
      then (select jsonb_build_object('id', (record).id, 'key', sort_key, 'missing', missing_key)
        from numbered where position = p_limit) else null end
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_lead_page(uuid, text, text, text, text, integer, uuid, text, boolean) from public, anon;
grant execute on function public.get_lead_page(uuid, text, text, text, text, integer, uuid, text, boolean) to authenticated;

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
revoke all on public.llm_usage_events from public, anon, authenticated;
grant select on public.llm_usage_events to authenticated;
grant select, insert on public.llm_usage_events to service_role;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'llm_usage_nonnegative'
    and conrelid = 'public.llm_usage_events'::regclass) then
    alter table public.llm_usage_events add constraint llm_usage_nonnegative
      check (prompt_tokens >= 0 and completion_tokens >= 0 and total_tokens >= 0
        and estimated_cost_usd >= 0) not valid;
  end if;
end $$;

create or replace function public.monthly_token_usage(p_business_id uuid, p_since timestamptz)
returns bigint language sql stable security invoker set search_path = public
as $$
  select coalesce(sum(greatest(total_tokens, 0)), 0)::bigint
  from public.llm_usage_events
  where business_id = p_business_id and created_at >= p_since;
$$;
revoke all on function public.monthly_token_usage(uuid, timestamptz) from public, anon;
grant execute on function public.monthly_token_usage(uuid, timestamptz) to authenticated, service_role;

create index if not exists rate_limit_hits_key_time_idx
  on public.rate_limit_hits (key, hit_at);

alter table public.rate_limit_hits enable row level security;

-- Atomically check a sliding-window limit and record the hit when allowed.
-- Runs as owner (bypasses RLS); callable only by the trusted server.
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
  v_window interval;
  v_count integer;
  v_oldest timestamptz;
  v_now timestamptz;
begin
  if p_key is null or length(p_key) not between 1 and 512
    or p_limit is null or p_limit not between 1 and 10000
    or p_window_ms is null or p_window_ms not between 1 and 3600000 then
    raise exception 'Invalid rate limit parameters' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_key, 0));
  v_now := clock_timestamp();
  v_window := make_interval(secs => p_window_ms / 1000.0);
  delete from public.rate_limit_hits where hit_at < v_now - interval '1 hour';
  select count(*), min(hit_at) into v_count, v_oldest
    from public.rate_limit_hits
    where key = p_key and hit_at > v_now - v_window;
  if v_count >= p_limit then
    return query select false,
      greatest(1, ceil(extract(epoch from (v_oldest + v_window - v_now)) * 1000))::integer;
  else
    insert into public.rate_limit_hits(key, hit_at) values (p_key, v_now);
    return query select true, 0;
  end if;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

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

alter table public.campaigns
  add constraint campaigns_budget_finite_nonnegative
    check (daily_budget is null or (daily_budget >= 0 and daily_budget < 'Infinity'::numeric));
alter table public.campaign_results
  add constraint campaign_results_metrics_safe
    check (impressions between 0 and 9007199254740991
      and clicks between 0 and 9007199254740991
      and leads between 0 and 9007199254740991
      and (conversations is null or conversations between 0 and 9007199254740991)),
  add constraint campaign_results_costs_finite_nonnegative
    check (spend >= 0 and spend < 'Infinity'::numeric
      and (cpl is null or (cpl >= 0 and cpl < 'Infinity'::numeric))
      and (cost_per_conversation is null or (cost_per_conversation >= 0 and cost_per_conversation < 'Infinity'::numeric))),
  add constraint campaign_results_period_order
    check ((period_start is null and period_end is null)
      or (period_start is not null and period_end is not null
        and isfinite(period_start) and isfinite(period_end) and period_start <= period_end)),
  add constraint campaign_results_fetched_finite check (isfinite(fetched_at));
alter table public.spend_limits
  add constraint spend_limits_positive_cap check (weekly_cap_rupees is null or weekly_cap_rupees > 0);
alter table public.campaigns add constraint campaigns_business_id_id_key unique (business_id, id);
alter table public.leads
  add constraint leads_same_business_campaign foreign key (business_id, campaign_id)
    references public.campaigns(business_id, id) on delete set null (campaign_id);
alter table public.campaign_operations
  add constraint operations_same_business_campaign foreign key (business_id, campaign_id)
    references public.campaigns(business_id, id) on delete set null (campaign_id),
  add constraint operations_same_business_draft foreign key (business_id, draft_id)
    references public.campaign_drafts(business_id, id) on delete restrict;



create table if not exists public.product_events (
  event_id uuid primary key,
  request_id uuid not null,
  version smallint not null check (version = 1),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  kind text not null check (kind in ('request', 'action', 'workflow', 'system', 'client')),
  name text not null check (length(name) between 1 and 160),
  outcome text not null check (outcome in ('success', 'rejected', 'failed', 'partial', 'started')),
  duration_ms integer check (duration_ms between 0 and 86400000),
  attributes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(attributes) = 'object' and octet_length(attributes::text) <= 4096)
);

create index if not exists product_events_time_idx on public.product_events(created_at);
create index if not exists product_events_user_time_idx on public.product_events(user_id, created_at desc);
create index if not exists product_events_business_time_idx on public.product_events(business_id, created_at desc);
create index if not exists product_events_request_idx on public.product_events(request_id);
create index if not exists product_events_name_time_idx on public.product_events(name, created_at desc);

alter table public.product_events enable row level security;
revoke all on public.product_events from public, anon, authenticated;
grant select, insert, delete on public.product_events to service_role;

create or replace function public.prune_product_events()
returns integer language plpgsql security definer set search_path = public as $$
declare
  removed integer;
begin
  delete from public.product_events where event_id in (
    select event_id from public.product_events
    where created_at < now() - interval '90 days'
    order by created_at limit 10000 for update skip locked
  );
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.prune_product_events() from public, anon, authenticated;
grant execute on function public.prune_product_events() to service_role;

create index if not exists campaign_operations_worker_pending_idx
  on public.campaign_operations (created_at, id)
  where state = 'pending' and payload->>'execution' = 'worker';

create or replace function public.enqueue_campaign_operation(p_operation_id uuid, p_input jsonb, p_request_hash text)
returns setof public.campaign_operations
language plpgsql security invoker set search_path = public
as $$
declare claimed public.campaign_operations;
begin
  select * into claimed from public.claim_campaign_operation(
    p_operation_id, (p_input->>'businessId')::uuid, (p_input->>'draftId')::uuid,
    (p_input->>'draftVersion')::bigint, (p_input->>'connectionGeneration')::bigint,
    'campaign_create', p_input->>'idempotencyKey', p_request_hash, now() + interval '24 hours',
    jsonb_build_object('execution', 'worker', 'request', p_input), now());
  if not found then return; end if;
  if claimed.id = p_operation_id and claimed.state = 'running' then
    update public.campaign_operations set state = 'pending'
      where id = claimed.id returning * into claimed;
  end if;
  return next claimed;
end
$$;

create or replace function public.claim_next_campaign_job()
returns setof public.campaign_operations
language plpgsql security invoker set search_path = public
as $$
declare selected_id uuid;
begin
  update public.campaign_operations
    set state = case when state = 'pending' then 'failed' else 'needs_reconciliation' end,
        phase = case when state = 'pending' then 'complete' else 'reconcile' end,
        lease_until = null, updated_at = now(),
        sanitized_error = 'Worker deadline expired. Review operation status before retrying.'
    where payload->>'execution' = 'worker' and state in ('pending', 'running') and lease_until <= now();
  select id into selected_id from public.campaign_operations
    where state = 'pending' and payload->>'execution' = 'worker' and lease_until > now()
    order by created_at, id for update skip locked limit 1;
  if not found then return; end if;
  return query update public.campaign_operations
    set state = 'running', lease_until = now() + interval '10 minutes', updated_at = now()
    where id = selected_id and state = 'pending' returning *;
end
$$;

revoke all on function public.enqueue_campaign_operation(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.claim_next_campaign_job() from public, anon, authenticated;
grant execute on function public.enqueue_campaign_operation(uuid, jsonb, text) to service_role;
grant execute on function public.claim_next_campaign_job() to service_role;

create table if not exists public.meta_billing_profiles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  environment text not null check (environment in ('test', 'live')),
  ad_account_id text not null check (ad_account_id ~ '^act_[0-9]+$'),
  owner_business_id text not null check (owner_business_id ~ '^[0-9]+$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (business_id, environment),
  unique (ad_account_id, environment)
);

alter table public.meta_billing_profiles enable row level security;
revoke all on public.meta_billing_profiles from public, anon, authenticated, service_role;
grant select on public.meta_billing_profiles to authenticated;
grant select, insert on public.meta_billing_profiles to service_role;
drop policy if exists "meta billing: read own" on public.meta_billing_profiles;
create policy "meta billing: read own" on public.meta_billing_profiles
  for select to authenticated using (public.owns_business(business_id));

create table if not exists public.meta_funding_evidence (
  id uuid primary key,
  profile_id uuid not null references public.meta_billing_profiles(id) on delete restrict,
  verified_by uuid not null references auth.users(id) on delete restrict,
  source text not null check (source in ('provider_verification', 'operator_review', 'test_fixture')),
  source_reference uuid not null,
  verified_at timestamptz not null,
  record jsonb not null check (
    jsonb_typeof(record) = 'object' and octet_length(record::text) <= 16384
    and record - array['version', 'businessId', 'environment', 'connectionGeneration', 'evidenceId',
      'verifiedAt', 'expiresAt', 'revokedAt', 'setup'] = '{}'::jsonb
  ),
  created_at timestamptz not null default now()
);
create index if not exists meta_funding_evidence_profile_idx
  on public.meta_funding_evidence(profile_id, verified_at desc, created_at desc, id desc);
alter table public.meta_funding_evidence enable row level security;
revoke all on public.meta_funding_evidence from public, anon, authenticated, service_role;
grant select, insert on public.meta_funding_evidence to service_role;

create or replace function public.validate_meta_funding_evidence()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  profile public.meta_billing_profiles;
  verified_at timestamptz;
  expires_at timestamptz;
begin
  select * into strict profile from public.meta_billing_profiles where id = new.profile_id;
  if new.record->>'version' is distinct from '1'
    or new.record->>'evidenceId' is distinct from new.id::text
    or new.record->>'businessId' is distinct from profile.business_id::text
    or new.record->>'environment' is distinct from profile.environment
    or new.record#>>'{setup,accountId}' is distinct from profile.ad_account_id
    or new.record#>>'{setup,expectedOwnerBusinessId}' is distinct from profile.owner_business_id
    or new.record#>>'{setup,ownerBusinessId}' is distinct from profile.owner_business_id
    or new.record->'revokedAt' is distinct from 'null'::jsonb
    or (new.source = 'test_fixture' and profile.environment <> 'test')
    or jsonb_typeof(new.record->'setup') is distinct from 'object'
    or (new.record->'setup') - array['method', 'accountId', 'expectedOwnerBusinessId', 'ownerBusinessId',
      'currency', 'country', 'accountActive', 'billingMode', 'paymentMethod', 'recurringAuthorisation',
      'spendControls', 'ownerAcceptedMetaInitiatedPayments'] <> '{}'::jsonb
    or jsonb_typeof(new.record->'connectionGeneration') is distinct from 'number'
    or (new.record->>'connectionGeneration') !~ '^[0-9]+$'
    or (new.record->>'connectionGeneration')::numeric > 9007199254740991
  then
    raise exception 'Funding evidence does not match its billing profile' using errcode = '23514';
  end if;
  verified_at := (new.record->>'verifiedAt')::timestamptz;
  expires_at := (new.record->>'expiresAt')::timestamptz;
  if verified_at is null or expires_at is null or not isfinite(verified_at) or not isfinite(expires_at)
    or verified_at > clock_timestamp() or expires_at <= verified_at then
    raise exception 'Funding evidence timestamps are invalid' using errcode = '23514';
  end if;
  new.verified_at := verified_at;
  new.created_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.validate_meta_funding_evidence() from public, anon, authenticated, service_role;
drop trigger if exists validate_meta_funding_evidence on public.meta_funding_evidence;
create trigger validate_meta_funding_evidence before insert on public.meta_funding_evidence
  for each row execute function public.validate_meta_funding_evidence();

create table if not exists public.meta_funding_revocations (
  evidence_id uuid primary key references public.meta_funding_evidence(id) on delete restrict,
  revoked_by uuid not null references auth.users(id) on delete restrict,
  reason text not null check (reason in ('mandate_revoked', 'account_changed', 'evidence_invalid', 'operator_hold')),
  revoked_at timestamptz not null default now()
);
alter table public.meta_funding_revocations enable row level security;
revoke all on public.meta_funding_revocations from public, anon, authenticated, service_role;
grant select, insert on public.meta_funding_revocations to service_role;

create or replace function public.stamp_meta_funding_revocation()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.revoked_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.stamp_meta_funding_revocation() from public, anon, authenticated, service_role;
drop trigger if exists stamp_meta_funding_revocation on public.meta_funding_revocations;
create trigger stamp_meta_funding_revocation before insert on public.meta_funding_revocations
  for each row execute function public.stamp_meta_funding_revocation();

create or replace function public.meta_funding_latest_record(p_business_id uuid, p_environment text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select evidence.record || jsonb_build_object('revokedAt',
    case when invalidation.revoked_at >= evidence.verified_at
      then to_char(invalidation.revoked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      else null end)
  from public.meta_billing_profiles profile
  join lateral (
    select * from public.meta_funding_evidence
    where profile_id = profile.id
    order by verified_at desc, created_at desc, id desc limit 1
  ) evidence on true
  left join lateral (
    select max(revocation.revoked_at) as revoked_at
    from public.meta_funding_revocations revocation
    join public.meta_funding_evidence previous on previous.id = revocation.evidence_id
    where previous.profile_id = profile.id
  ) invalidation on true
  where profile.business_id = p_business_id and profile.environment = p_environment;
$$;
revoke all on function public.meta_funding_latest_record(uuid, text) from public, anon, authenticated;
grant execute on function public.meta_funding_latest_record(uuid, text) to service_role;
create schema if not exists private;

create table if not exists private.production_payment_orders (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  request_key uuid not null,
  environment text not null default 'live' check (environment = 'live'),
  account_id text not null check (account_id ~ '^acc_[A-Za-z0-9]{1,100}$'),
  key_id text not null check (key_id ~ '^rzp_live_[A-Za-z0-9]{1,100}$'),
  amount_paise bigint not null default 1000000 check (amount_paise = 1000000),
  currency text not null default 'INR' check (currency = 'INR'),
  quote jsonb not null check (quote = '{"version":"inr-annual-total-v1","merchantDisplay":"Vanshul Goyal","currency":"INR","totalPaise":1000000,"serviceAllocationPaise":200000,"metaAllocationPaise":800000,"additionalCustomerTaxPaise":0,"metaTaxTreatment":"included-in-meta-allocation","gatewayFees":"absorbed-by-adbrain","automaticRenewal":false}'::jsonb),
  terms jsonb not null check (jsonb_typeof(terms) = 'object' and octet_length(terms::text) <= 32768),
  terms_hash text not null check (terms_hash ~ '^[a-f0-9]{64}$'),
  funding_evidence_id uuid not null references public.meta_funding_evidence(id) on delete restrict,
  accepted_at timestamptz not null default clock_timestamp(),
  provider_order_id text check (provider_order_id ~ '^order_[A-Za-z0-9]{1,100}$'),
  payment_id text check (payment_id ~ '^pay_[A-Za-z0-9]{1,100}$'),
  captured_paise bigint not null default 0 check (captured_paise in (0,1000000)),
  refunded_paise bigint not null default 0 check (refunded_paise between 0 and 1000000),
  provider_refunded_paise bigint not null default 0 check (provider_refunded_paise between 0 and 1000000),
  review_required boolean not null default false,
  refund_hold boolean not null default false,
  creation_uncertain boolean not null default false,
  state text generated always as (case
    when review_required then 'review_required'
    when refunded_paise = 1000000 then 'refunded'
    when refunded_paise > 0 then 'partially_refunded'
    when refund_hold then 'refund_pending'
    when captured_paise = 1000000 then 'captured'
    when creation_uncertain then 'needs_reconciliation'
    when provider_order_id is not null then 'created'
    else 'creating' end) stored,
  updated_at timestamptz not null default clock_timestamp(),
  unique (business_id,request_key),
  unique (account_id,provider_order_id),
  unique (account_id,payment_id)
);
create unique index if not exists production_payment_orders_active_business_idx
  on private.production_payment_orders(business_id) where refunded_paise < amount_paise or review_required;

create table if not exists private.production_payment_events (
  account_id text not null check (account_id ~ '^acc_[A-Za-z0-9]{1,100}$'),
  event_id text not null check (event_id ~ '^[A-Za-z0-9_:.-]{1,160}$'),
  key_id text not null check (key_id ~ '^rzp_live_[A-Za-z0-9]{1,100}$'),
  webhook_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  payment_id text not null check (payment_id ~ '^pay_[A-Za-z0-9]{1,100}$'),
  provider_order_id text check (provider_order_id ~ '^order_[A-Za-z0-9]{1,100}$'),
  refund_id text check (refund_id ~ '^rfnd_[A-Za-z0-9]{1,100}$'),
  kind text not null check (kind in ('capture','pending','refund','dispute')),
  conflicted boolean not null default false,
  processed_at timestamptz,
  received_at timestamptz not null default clock_timestamp(),
  primary key (account_id,event_id)
);
create index if not exists production_payment_events_pending_idx
  on private.production_payment_events(account_id,received_at) where processed_at is null;
create index if not exists production_payment_events_payment_idx
  on private.production_payment_events(account_id,payment_id);

create table if not exists private.production_payment_event_conflicts (
  account_id text not null,
  event_id text not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  payment_id text not null check (payment_id ~ '^pay_[A-Za-z0-9]{1,100}$'),
  provider_order_id text check (provider_order_id ~ '^order_[A-Za-z0-9]{1,100}$'),
  received_at timestamptz not null default clock_timestamp(),
  primary key(account_id,event_id,payload_hash),
  foreign key(account_id,event_id) references private.production_payment_events(account_id,event_id) on delete restrict
);
create index if not exists production_payment_event_conflicts_payment_idx
  on private.production_payment_event_conflicts(account_id,payment_id);
alter table private.production_payment_event_conflicts enable row level security;
revoke all on private.production_payment_event_conflicts from public,anon,authenticated,service_role;

create table if not exists private.production_payment_effects (
  account_id text not null,
  kind text not null check (kind in ('capture','refund')),
  provider_id text not null,
  payment_id text not null check (payment_id ~ '^pay_[A-Za-z0-9]{1,100}$'),
  order_id uuid not null references private.production_payment_orders(id) on delete restrict,
  amount_paise bigint not null check (amount_paise between 1 and 1000000),
  snapshot_hash text not null check (snapshot_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (account_id,kind,provider_id),
  check ((kind = 'capture' and provider_id = payment_id and amount_paise = 1000000)
    or (kind = 'refund' and provider_id ~ '^rfnd_[A-Za-z0-9]{1,100}$'))
);

alter table private.production_payment_orders enable row level security;
alter table private.production_payment_events enable row level security;
alter table private.production_payment_effects enable row level security;
revoke all on private.production_payment_orders,private.production_payment_events,private.production_payment_effects from public,anon,authenticated,service_role;

create or replace function public.production_payment_funding_valid(p_business_id uuid, p_funding_evidence_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare funding jsonb;
begin
  funding := public.meta_funding_latest_record(p_business_id,'live');
  return ((funding->>'evidenceId' = p_funding_evidence_id::text
    and funding->>'environment' = 'live' and funding->'revokedAt' = 'null'::jsonb
    and (funding->>'verifiedAt')::timestamptz <= clock_timestamp()
    and (funding->>'expiresAt')::timestamptz > clock_timestamp()
    and funding#>>'{setup,accountActive}' = 'true'
    and funding#>>'{setup,currency}' = 'INR' and funding#>>'{setup,country}' = 'IN'
    and funding#>>'{setup,paymentMethod}' = 'verified' and funding#>>'{setup,recurringAuthorisation}' = 'verified'
    and funding#>>'{setup,spendControls}' = 'verified' and funding#>>'{setup,ownerAcceptedMetaInitiatedPayments}' = 'true'
    and ((funding#>>'{setup,method}' = 'upi_auto_reload' and funding#>>'{setup,billingMode}' = 'available_funds')
      or (funding#>>'{setup,method}' = 'recurring_card' and funding#>>'{setup,billingMode}' in ('automatic','hybrid')))
    and exists(select 1 from public.meta_connections connection where connection.business_id = p_business_id
      and connection.authorization_status = 'connected' and connection.ad_account_id = funding#>>'{setup,accountId}'
      and connection.generation::text = funding->>'connectionGeneration')) is true);
end;
$$;
revoke all on function public.production_payment_funding_valid(uuid,uuid) from public,anon,authenticated;
grant execute on function public.production_payment_funding_valid(uuid,uuid) to service_role;

create or replace function public.production_payment_order_claim(
  p_business_id uuid, p_user_id uuid, p_request_key uuid, p_order_id uuid,
  p_account_id text, p_key_id text, p_quote jsonb, p_terms text, p_terms_hash text, p_funding_evidence_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved private.production_payment_orders;
  policy jsonb;
  inserted boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:' || p_account_id,0));
  perform 1 from public.businesses where id = p_business_id and owner_id = p_user_id for update;
  if not found then raise exception 'Payment owner not found' using errcode = '23514'; end if;
  select * into saved from private.production_payment_orders where business_id = p_business_id
    and (request_key = p_request_key or refunded_paise < amount_paise or review_required)
    order by (request_key = p_request_key) desc limit 1;
  if found then
    if saved.user_id is distinct from p_user_id or saved.account_id is distinct from p_account_id or saved.key_id is distinct from p_key_id
      or saved.terms_hash is distinct from p_terms_hash or saved.quote is distinct from p_quote then
      raise exception 'Payment request scope changed' using errcode = '23514';
    end if;
    if saved.funding_evidence_id is distinct from p_funding_evidence_id
      or not public.production_payment_funding_valid(p_business_id,saved.funding_evidence_id) then
      raise exception 'Live automatic funding evidence unavailable' using errcode = '23514';
    end if;
    return jsonb_build_object('claimed',false,'order',to_jsonb(saved));
  end if;
  if p_terms is null or octet_length(p_terms) > 32768 or p_terms_hash is distinct from encode(sha256(convert_to(p_terms,'UTF8')),'hex') then
    raise exception 'Payment terms digest mismatch' using errcode = '23514';
  end if;
  policy := p_terms::jsonb;
  if not ((jsonb_typeof(policy) = 'object'
    and policy - array['version','approvalReference','approvedAt','expiresAt','serviceScope','invoiceTerms','refundTerms','automaticFundingApprovalReference'] = '{}'::jsonb
    and (policy->>'version') ~ '^[a-z0-9][a-z0-9-]{0,63}$'
    and (policy->>'approvalReference')::uuid is not null
    and (policy->>'automaticFundingApprovalReference')::uuid is not null
    and length(trim(policy->>'serviceScope')) between 1 and 8000
    and length(trim(policy->>'invoiceTerms')) between 1 and 8000
    and length(trim(policy->>'refundTerms')) between 1 and 8000
    and isfinite((policy->>'approvedAt')::timestamptz) and (policy->>'approvedAt')::timestamptz <= clock_timestamp()
    and isfinite((policy->>'expiresAt')::timestamptz) and (policy->>'expiresAt')::timestamptz > clock_timestamp()) is true) then
    raise exception 'Payment policy is incomplete or expired' using errcode = '23514';
  end if;
  if not public.production_payment_funding_valid(p_business_id,p_funding_evidence_id) then
    raise exception 'Live automatic funding evidence unavailable' using errcode = '23514';
  end if;
  insert into private.production_payment_orders(id,business_id,user_id,request_key,account_id,key_id,quote,terms,terms_hash,funding_evidence_id)
    values(p_order_id,p_business_id,p_user_id,p_request_key,p_account_id,p_key_id,p_quote,policy,p_terms_hash,p_funding_evidence_id)
    returning * into saved;
  inserted := found;
  return jsonb_build_object('claimed',inserted,'order',to_jsonb(saved));
end;
$$;

create or replace function public.production_payment_order_get(p_order_id uuid, p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(payment_order) from private.production_payment_orders payment_order
    join public.businesses business on business.id = payment_order.business_id
    where payment_order.id = p_order_id and payment_order.user_id = p_user_id and business.owner_id = p_user_id;
$$;

create or replace function public.production_payment_order_result(p_order_id uuid, p_account_id text, p_key_id text, p_provider_order_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.production_payment_orders;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:' || p_account_id,0));
  select * into saved from private.production_payment_orders where id = p_order_id and account_id = p_account_id and key_id = p_key_id for update;
  if not found then raise exception 'Payment order not found' using errcode = '23514'; end if;
  if p_provider_order_id is null then
    update private.production_payment_orders set creation_uncertain = provider_order_id is null, updated_at = clock_timestamp() where id = p_order_id returning * into saved;
  elsif saved.provider_order_id is not null and saved.provider_order_id <> p_provider_order_id then
    update private.production_payment_orders set review_required = true, updated_at = clock_timestamp() where id = p_order_id returning * into saved;
  else
    update private.production_payment_orders set provider_order_id = p_provider_order_id, creation_uncertain = false,
      review_required = review_required or exists(select 1 from private.production_payment_events where account_id = p_account_id
        and provider_order_id = p_provider_order_id and (conflicted or kind = 'dispute'))
        or exists(select 1 from private.production_payment_event_conflicts where account_id = p_account_id and provider_order_id = p_provider_order_id),
      refund_hold = refund_hold or exists(select 1 from private.production_payment_events where account_id = p_account_id
        and provider_order_id = p_provider_order_id and kind = 'refund'), updated_at = clock_timestamp()
      where id = p_order_id returning * into saved;
  end if;
  return to_jsonb(saved);
end;
$$;

create or replace function public.production_payment_event_receive(
  p_account_id text,p_key_id text,p_webhook_id uuid,p_event_id text,p_payload_hash text,
  p_payment_id text,p_provider_order_id text,p_refund_id text,p_kind text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.production_payment_events;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:' || p_account_id,0));
  insert into private.production_payment_events(account_id,key_id,webhook_id,event_id,payload_hash,payment_id,provider_order_id,refund_id,kind)
    values(p_account_id,p_key_id,p_webhook_id,p_event_id,p_payload_hash,p_payment_id,p_provider_order_id,p_refund_id,p_kind)
    on conflict (account_id,event_id) do nothing;
  select * into saved from private.production_payment_events where account_id = p_account_id and event_id = p_event_id;
  if saved.payload_hash is distinct from p_payload_hash or saved.payment_id is distinct from p_payment_id
    or saved.provider_order_id is distinct from p_provider_order_id or saved.refund_id is distinct from p_refund_id or saved.kind is distinct from p_kind then
    update private.production_payment_events set conflicted = true, processed_at = null
      where account_id = p_account_id and event_id = p_event_id returning * into saved;
    insert into private.production_payment_event_conflicts(account_id,event_id,payload_hash,payment_id,provider_order_id)
      values(p_account_id,p_event_id,p_payload_hash,p_payment_id,p_provider_order_id) on conflict do nothing;
  end if;
  update private.production_payment_orders set
    review_required = review_required or saved.conflicted or p_kind = 'dispute' or saved.kind = 'dispute',
    refund_hold = refund_hold or p_kind = 'refund' or saved.kind = 'refund', updated_at = clock_timestamp()
    where account_id = p_account_id and (payment_id in (p_payment_id,saved.payment_id)
      or provider_order_id in (p_provider_order_id,saved.provider_order_id));
  return to_jsonb(saved);
end;
$$;

create or replace function public.production_payment_observe(
  p_order_id uuid,p_account_id text,p_key_id text,p_payment_id text,p_capture_verified boolean,
  p_provider_refunded_paise bigint,p_review_required boolean,p_snapshot_hash text,
  p_refund_id text default null,p_refund_amount_paise bigint default null,p_refund_status text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved private.production_payment_orders;
  existing private.production_payment_effects;
  refund_total bigint;
begin
  if not ((p_payment_id ~ '^pay_[A-Za-z0-9]{1,100}$' and p_capture_verified is not null and p_review_required is not null
    and p_provider_refunded_paise between 0 and 1000000 and p_snapshot_hash ~ '^[a-f0-9]{64}$'
    and ((p_refund_id is null and p_refund_amount_paise is null and p_refund_status is null)
      or (p_refund_id ~ '^rfnd_[A-Za-z0-9]{1,100}$' and p_refund_amount_paise between 1 and 1000000 and p_refund_status in ('pending','processed','failed')))) is true) then
    raise exception 'Invalid payment observation' using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:' || p_account_id,0));
  select * into saved from private.production_payment_orders where id = p_order_id and account_id = p_account_id and key_id = p_key_id for update;
  if not found or saved.provider_order_id is null then raise exception 'Payment order not ready' using errcode = '23514'; end if;
  update private.production_payment_orders set
    review_required = review_required or p_review_required
      or (payment_id is not null and payment_id <> p_payment_id and (p_capture_verified or p_refund_id is not null or p_provider_refunded_paise > 0))
      or exists(select 1 from private.production_payment_effects where order_id = p_order_id and payment_id <> p_payment_id)
      or exists(select 1 from private.production_payment_events where account_id = p_account_id
        and (payment_id = p_payment_id or provider_order_id = saved.provider_order_id) and (conflicted or kind = 'dispute'))
      or exists(select 1 from private.production_payment_event_conflicts where account_id = p_account_id
        and (payment_id = p_payment_id or provider_order_id = saved.provider_order_id)),
    refund_hold = refund_hold or p_refund_id is not null or p_provider_refunded_paise > 0
      or exists(select 1 from private.production_payment_events where account_id = p_account_id
        and (payment_id = p_payment_id or provider_order_id = saved.provider_order_id) and kind = 'refund'),
    provider_refunded_paise = greatest(provider_refunded_paise,p_provider_refunded_paise), updated_at = clock_timestamp()
    where id = p_order_id returning * into saved;
  if p_capture_verified then
    select * into existing from private.production_payment_effects where account_id = p_account_id and kind = 'capture' and provider_id = p_payment_id;
    if (found and existing.order_id <> p_order_id) or (saved.payment_id is not null and saved.payment_id <> p_payment_id) then
      update private.production_payment_orders set review_required = true where id in (p_order_id,existing.order_id);
    else
      insert into private.production_payment_effects(account_id,kind,provider_id,payment_id,order_id,amount_paise,snapshot_hash)
        values(p_account_id,'capture',p_payment_id,p_payment_id,p_order_id,1000000,p_snapshot_hash) on conflict do nothing;
      update private.production_payment_orders set captured_paise = 1000000,payment_id = p_payment_id where id = p_order_id;
    end if;
  end if;
  if p_refund_id is not null and (saved.payment_id is null or saved.payment_id = p_payment_id) then
    select * into existing from private.production_payment_effects where account_id = p_account_id and kind = 'refund' and provider_id = p_refund_id;
    if found and (existing.order_id <> p_order_id or existing.payment_id <> p_payment_id or existing.amount_paise <> p_refund_amount_paise or p_refund_status = 'failed') then
      update private.production_payment_orders set review_required = true where id in (p_order_id,existing.order_id);
    elsif p_refund_status = 'processed' then
      select coalesce(sum(amount_paise),0) into refund_total from private.production_payment_effects where order_id = p_order_id and kind = 'refund' and provider_id <> p_refund_id;
      if refund_total + p_refund_amount_paise > 1000000 then
        update private.production_payment_orders set review_required = true where id = p_order_id;
      else
        insert into private.production_payment_effects(account_id,kind,provider_id,payment_id,order_id,amount_paise,snapshot_hash)
          values(p_account_id,'refund',p_refund_id,p_payment_id,p_order_id,p_refund_amount_paise,p_snapshot_hash) on conflict do nothing;
        update private.production_payment_orders set refunded_paise = refund_total + p_refund_amount_paise where id = p_order_id;
      end if;
    end if;
  end if;
  select * into saved from private.production_payment_orders where id = p_order_id;
  return to_jsonb(saved);
end;
$$;

revoke all on function public.production_payment_order_claim(uuid,uuid,uuid,uuid,text,text,jsonb,text,text,uuid) from public,anon,authenticated;
revoke all on function public.production_payment_order_get(uuid,uuid) from public,anon,authenticated;
revoke all on function public.production_payment_order_result(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.production_payment_event_receive(text,text,uuid,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.production_payment_observe(uuid,text,text,text,boolean,bigint,boolean,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.production_payment_order_claim(uuid,uuid,uuid,uuid,text,text,jsonb,text,text,uuid) to service_role;
grant execute on function public.production_payment_order_get(uuid,uuid) to service_role;
grant execute on function public.production_payment_order_result(uuid,text,text,text) to service_role;
grant execute on function public.production_payment_event_receive(text,text,uuid,text,text,text,text,text,text) to service_role;
grant execute on function public.production_payment_observe(uuid,text,text,text,boolean,bigint,boolean,text,text,bigint,text) to service_role;

create table if not exists private.production_payment_operators (
  user_id uuid primary key references auth.users(id) on delete restrict,
  approval_reference uuid not null,
  can_refund boolean not null default false,
  expires_at timestamptz not null check (isfinite(expires_at)),
  revoked_at timestamptz
);
create table if not exists private.production_payment_refunds (
  id uuid primary key,
  order_id uuid not null references private.production_payment_orders(id) on delete restrict,
  request_key uuid not null,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approval_reference uuid not null,
  terms_hash text not null check (terms_hash ~ '^[a-f0-9]{64}$'),
  reason text not null check (length(trim(reason)) between 1 and 1000),
  amount_paise bigint not null check (amount_paise between 100 and 1000000),
  state text not null default 'creating' check (state in ('creating','submitted','needs_reconciliation','processed','failed')),
  provider_refund_id text check (provider_refund_id ~ '^rfnd_[A-Za-z0-9]{1,100}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique(order_id,request_key),
  unique(order_id,provider_refund_id)
);
alter table private.production_payment_operators enable row level security;
alter table private.production_payment_refunds enable row level security;
revoke all on private.production_payment_operators,private.production_payment_refunds from public,anon,authenticated,service_role;

create or replace function public.production_payment_operator_allowed(p_user_id uuid,p_refund boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.production_payment_operators where user_id = p_user_id and revoked_at is null
    and expires_at > clock_timestamp() and (not p_refund or can_refund));
$$;

create or replace function public.production_payment_refund_claim(
  p_order_id uuid,p_account_id text,p_key_id text,p_actor_id uuid,p_request_key uuid,p_refund_id uuid,
  p_amount_paise bigint,p_terms_hash text,p_approval_reference uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved private.production_payment_orders;
  refund private.production_payment_refunds;
  outstanding bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:' || p_account_id,0));
  if not public.production_payment_operator_allowed(p_actor_id,true) then raise exception 'Refund operator not authorized' using errcode = '42501'; end if;
  select * into saved from private.production_payment_orders where id = p_order_id and account_id = p_account_id and key_id = p_key_id for update;
  if not found then raise exception 'Payment order not found' using errcode = '23514'; end if;
  select * into refund from private.production_payment_refunds where order_id = p_order_id and request_key = p_request_key;
  if found then
    if refund.approved_by is distinct from p_actor_id or refund.terms_hash is distinct from p_terms_hash
      or refund.approval_reference is distinct from p_approval_reference or refund.reason is distinct from p_reason
      or refund.amount_paise is distinct from p_amount_paise then raise exception 'Refund request conflict' using errcode = '23514'; end if;
    return jsonb_build_object('claimed',false,'refund',to_jsonb(refund));
  end if;
  select coalesce(sum(amount_paise),0) into outstanding from private.production_payment_refunds
    where order_id = p_order_id and state in ('creating','submitted','needs_reconciliation');
  if saved.review_required or saved.captured_paise <> saved.amount_paise or saved.payment_id is null or outstanding > 0
    or p_terms_hash is distinct from saved.terms_hash or p_amount_paise is null
    or p_amount_paise > saved.captured_paise - greatest(saved.refunded_paise,saved.provider_refunded_paise)
    or exists(select 1 from private.production_payment_events where account_id = p_account_id
      and (payment_id = saved.payment_id or provider_order_id = saved.provider_order_id) and processed_at is null and kind in ('refund','dispute')) then
    raise exception 'Refund needs reconciliation or approved policy' using errcode = '23514';
  end if;
  insert into private.production_payment_refunds(id,order_id,request_key,approved_by,approval_reference,terms_hash,reason,amount_paise)
    values(p_refund_id,p_order_id,p_request_key,p_actor_id,p_approval_reference,p_terms_hash,p_reason,p_amount_paise) returning * into refund;
  update private.production_payment_orders set refund_hold = true, updated_at = clock_timestamp() where id = p_order_id;
  return jsonb_build_object('claimed',true,'refund',to_jsonb(refund));
end;
$$;

create or replace function public.production_payment_refund_result(p_refund_id uuid,p_account_id text,p_key_id text,p_provider_refund_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare refund private.production_payment_refunds;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:' || p_account_id,0));
  select operation.* into refund from private.production_payment_refunds operation
    join private.production_payment_orders payment_order on payment_order.id = operation.order_id
    where operation.id = p_refund_id and payment_order.account_id = p_account_id and payment_order.key_id = p_key_id for update of operation;
  if not found then raise exception 'Refund not found' using errcode = '23514'; end if;
  if p_provider_refund_id is null then
    update private.production_payment_refunds set state = case when provider_refund_id is null then 'needs_reconciliation' else state end
      where id = p_refund_id returning * into refund;
  elsif refund.provider_refund_id is not null and refund.provider_refund_id <> p_provider_refund_id then
    update private.production_payment_orders set review_required = true where id = refund.order_id;
  else
    update private.production_payment_refunds set provider_refund_id = p_provider_refund_id,
      state = case when state in ('processed','failed') then state else 'submitted' end where id = p_refund_id returning * into refund;
  end if;
  return to_jsonb(refund);
end;
$$;

create or replace function public.production_payment_refund_observed(
  p_refund_id uuid,p_account_id text,p_provider_refund_id text,p_amount_paise bigint,p_status text
) returns void language plpgsql security definer set search_path = '' as $$
declare refund private.production_payment_refunds;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:' || p_account_id,0));
  select operation.* into refund from private.production_payment_refunds operation
    join private.production_payment_orders payment_order on payment_order.id = operation.order_id
    where operation.id = p_refund_id and payment_order.account_id = p_account_id for update of operation;
  if not found then raise exception 'Refund not found' using errcode = '23514'; end if;
  if refund.provider_refund_id is distinct from p_provider_refund_id or refund.amount_paise is distinct from p_amount_paise
    or p_status is null or p_status not in ('pending','processed','failed')
    or (refund.state in ('processed','failed') and p_status in ('processed','failed') and refund.state <> p_status) then
    update private.production_payment_orders set review_required = true where id = refund.order_id;
  elsif p_status = 'processed' then
    if exists(select 1 from private.production_payment_effects where order_id = refund.order_id and kind = 'refund'
      and provider_id = p_provider_refund_id and amount_paise = p_amount_paise) then
      update private.production_payment_refunds set state = 'processed' where id = p_refund_id;
    else raise exception 'Refund effect not recorded' using errcode = '23514'; end if;
  elsif p_status = 'failed' then
    update private.production_payment_refunds set state = 'failed' where id = p_refund_id;
  end if;
end;
$$;

create or replace function public.production_payment_orders_list(p_business_id uuid,p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(owned_order)),'[]'::jsonb) from (
    select payment_order.* from private.production_payment_orders payment_order
      join public.businesses business on business.id = payment_order.business_id
      where payment_order.business_id = p_business_id and payment_order.user_id = p_user_id and business.owner_id = p_user_id
      order by payment_order.accepted_at desc limit 20
  ) owned_order;
$$;

create or replace function public.production_payment_recovery(
  p_account_id text,p_key_id text,p_order_id uuid default null,p_provider_order_id text default null
) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('order',to_jsonb(payment_order),'refunds',coalesce((select jsonb_agg(to_jsonb(refund))
    from private.production_payment_refunds refund where order_id = payment_order.id),'[]'::jsonb),
    'refundIds',coalesce((select jsonb_agg(provider_id) from private.production_payment_effects where order_id = payment_order.id and kind = 'refund'),'[]'::jsonb))
  from private.production_payment_orders payment_order where account_id = p_account_id and key_id = p_key_id
    and ((p_order_id is not null and p_provider_order_id is null and id = p_order_id)
      or (p_order_id is null and p_provider_order_id is not null and provider_order_id = p_provider_order_id));
$$;

create or replace function public.production_payment_events_pending(p_account_id text,p_key_id text,p_order_id uuid default null,p_after_event_id text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(pending)),'[]'::jsonb) from (
    select event.* from private.production_payment_events event where account_id = p_account_id and key_id = p_key_id and processed_at is null
      and (p_after_event_id is null or (event.received_at,event.event_id) > (select cursor_event.received_at,cursor_event.event_id
        from private.production_payment_events cursor_event where cursor_event.account_id = p_account_id and cursor_event.event_id = p_after_event_id))
      and (p_order_id is null or exists(select 1 from private.production_payment_orders where id = p_order_id and account_id = p_account_id
        and (provider_order_id = event.provider_order_id or payment_id = event.payment_id)))
      order by received_at,event_id limit 25
  ) pending;
$$;

create or replace function public.production_payment_event_processed(p_account_id text,p_event_id text,p_payload_hash text)
returns void language sql security definer set search_path = '' as $$
  update private.production_payment_events set processed_at = clock_timestamp()
    where account_id = p_account_id and event_id = p_event_id and payload_hash = p_payload_hash and not conflicted;
$$;

revoke all on function public.production_payment_operator_allowed(uuid,boolean) from public,anon,authenticated;
revoke all on function public.production_payment_refund_claim(uuid,text,text,uuid,uuid,uuid,bigint,text,uuid,text) from public,anon,authenticated;
revoke all on function public.production_payment_refund_result(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.production_payment_refund_observed(uuid,text,text,bigint,text) from public,anon,authenticated;
revoke all on function public.production_payment_orders_list(uuid,uuid) from public,anon,authenticated;
revoke all on function public.production_payment_recovery(text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.production_payment_events_pending(text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.production_payment_event_processed(text,text,text) from public,anon,authenticated;
grant execute on function public.production_payment_operator_allowed(uuid,boolean) to service_role;
grant execute on function public.production_payment_refund_claim(uuid,text,text,uuid,uuid,uuid,bigint,text,uuid,text) to service_role;
grant execute on function public.production_payment_refund_result(uuid,text,text,text) to service_role;
grant execute on function public.production_payment_refund_observed(uuid,text,text,bigint,text) to service_role;
grant execute on function public.production_payment_orders_list(uuid,uuid) to service_role;
grant execute on function public.production_payment_recovery(text,text,uuid,text) to service_role;
grant execute on function public.production_payment_events_pending(text,text,uuid,text) to service_role;
grant execute on function public.production_payment_event_processed(text,text,text) to service_role;

create or replace function public.production_payment_event_get(p_account_id text,p_key_id text,p_event_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(event) from private.production_payment_events event
    where account_id = p_account_id and key_id = p_key_id and event_id = p_event_id;
$$;
create or replace function public.production_payment_order_review(p_order_id uuid,p_account_id text,p_key_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.production_payment_orders;
begin
  update private.production_payment_orders set review_required = true,updated_at = clock_timestamp()
    where id = p_order_id and account_id = p_account_id and key_id = p_key_id returning * into saved;
  if not found then raise exception 'Payment order not found' using errcode = '23514'; end if;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.production_payment_event_get(text,text,text) from public,anon,authenticated;
revoke all on function public.production_payment_order_review(uuid,text,text) from public,anon,authenticated;
grant execute on function public.production_payment_event_get(text,text,text) to service_role;
grant execute on function public.production_payment_order_review(uuid,text,text) to service_role;

alter table private.production_payment_orders alter column funding_evidence_id drop not null;
alter table private.production_payment_orders drop constraint if exists production_payment_funding_mode_check;
alter table private.production_payment_orders add constraint production_payment_funding_mode_check check (((
  terms->>'version' = 'operator-managed-v1' and terms->>'fundingMode' = 'operator_managed' and funding_evidence_id is null
) or (
  terms->>'version' <> 'operator-managed-v1' and not (terms ? 'fundingMode') and funding_evidence_id is not null
)) is true);

create or replace function public.production_payment_order_claim(
  p_business_id uuid, p_user_id uuid, p_request_key uuid, p_order_id uuid,
  p_account_id text, p_key_id text, p_quote jsonb, p_terms text, p_terms_hash text, p_funding_evidence_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved private.production_payment_orders;
  policy jsonb;
  operator_managed boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:' || p_account_id,0));
  perform 1 from public.businesses where id = p_business_id and owner_id = p_user_id for update;
  if not found then raise exception 'Payment owner not found' using errcode = '23514'; end if;
  if p_terms is null or octet_length(p_terms) > 32768 or p_terms_hash is distinct from encode(sha256(convert_to(p_terms,'UTF8')),'hex') then
    raise exception 'Payment terms digest mismatch' using errcode = '23514';
  end if;
  policy := p_terms::jsonb;
  operator_managed := coalesce(policy->>'version' = 'operator-managed-v1',false);
  if operator_managed then
    if p_funding_evidence_id is not null or policy is distinct from $policy${"version":"operator-managed-v1","fundingMode":"operator_managed","approvalReference":"https://github.com/vanshulgoyal101/adbrain/issues/48#issuecomment-5848530300","approvedAt":"2026-09-26T17:58:20Z","serviceScope":"INR 10,000 total for 12 months for one business, one offer and one service area, including up to two creatives and one capped Meta campaign. INR 2,000 is allocated to service and INR 8,000 to advertising including applicable Meta taxes. AdBrain absorbs gateway fees. No extra checkout charge, automatic renewal, year-round ad delivery or guaranteed results. The operator pays Meta separately; payment to AdBrain is not confirmation of a transfer to Meta or permission to activate ads.","invoiceTerms":"The invoice will reflect Vanshul Goyal's actual tax status and applicable law. This payment receipt is not a tax invoice and makes no GST-registration claim. No additional checkout charge applies. Mandatory customer rights remain applicable.","refundTerms":"Full refund before work starts. After work starts, unused advertising allocation is refundable after pending costs are reconciled. The INR 2,000 service allocation is earned only after the agreed creatives and campaign setup are delivered; otherwise it remains refundable. Mandatory customer rights remain applicable."}$policy$::jsonb
      or (policy->>'approvedAt')::timestamptz > clock_timestamp() then
      raise exception 'Operator-managed policy is not approved' using errcode = '23514';
    end if;
  else
    if not ((jsonb_typeof(policy) = 'object'
      and policy - array['version','approvalReference','approvedAt','expiresAt','serviceScope','invoiceTerms','refundTerms','automaticFundingApprovalReference'] = '{}'::jsonb
      and (policy->>'version') ~ '^[a-z0-9][a-z0-9-]{0,63}$'
      and (policy->>'approvalReference')::uuid is not null
      and (policy->>'automaticFundingApprovalReference')::uuid is not null
      and length(trim(policy->>'serviceScope')) between 1 and 8000
      and length(trim(policy->>'invoiceTerms')) between 1 and 8000
      and length(trim(policy->>'refundTerms')) between 1 and 8000
      and isfinite((policy->>'approvedAt')::timestamptz) and (policy->>'approvedAt')::timestamptz <= clock_timestamp()
      and isfinite((policy->>'expiresAt')::timestamptz) and (policy->>'expiresAt')::timestamptz > clock_timestamp()) is true)
      or not public.production_payment_funding_valid(p_business_id,p_funding_evidence_id) then
      raise exception 'Legacy policy or automatic funding evidence unavailable' using errcode = '23514';
    end if;
  end if;
  select * into saved from private.production_payment_orders where business_id = p_business_id
    and (request_key = p_request_key or refunded_paise < amount_paise or review_required)
    order by (request_key = p_request_key) desc limit 1;
  if found then
    if saved.user_id is distinct from p_user_id or saved.account_id is distinct from p_account_id or saved.key_id is distinct from p_key_id
      or saved.terms_hash is distinct from p_terms_hash or saved.terms is distinct from policy or saved.quote is distinct from p_quote
      or saved.funding_evidence_id is distinct from p_funding_evidence_id then
      raise exception 'Payment request scope changed' using errcode = '23514';
    end if;
    return jsonb_build_object('claimed',false,'order',to_jsonb(saved));
  end if;
  insert into private.production_payment_orders(id,business_id,user_id,request_key,account_id,key_id,quote,terms,terms_hash,funding_evidence_id)
    values(p_order_id,p_business_id,p_user_id,p_request_key,p_account_id,p_key_id,p_quote,policy,p_terms_hash,p_funding_evidence_id)
    returning * into saved;
  return jsonb_build_object('claimed',true,'order',to_jsonb(saved));
end;
$$;
revoke all on function public.production_payment_order_claim(uuid,uuid,uuid,uuid,text,text,jsonb,text,text,uuid) from public,anon,authenticated;
grant execute on function public.production_payment_order_claim(uuid,uuid,uuid,uuid,text,text,jsonb,text,text,uuid) to service_role;
create table if not exists private.customer_ad_costs (
  campaign_id uuid primary key references public.campaigns(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  account_id text not null,
  ad_account_id text not null,
  connection_generation bigint not null,
  media_paise bigint not null check (media_paise between 0 and 9007199254740991),
  tax_paise bigint not null check (tax_paise between 0 and 9007199254740991),
  tax_rate_bps integer not null check (tax_rate_bps between 0 and 10000),
  observed_at timestamptz not null check (isfinite(observed_at)),
  held boolean not null default false,
  finalized boolean not null default false
);
create table if not exists private.customer_ad_cost_evidence (
  reference uuid primary key,
  actor_id uuid not null references auth.users(id) on delete restrict,
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  input jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create table if not exists private.customer_ad_reservations (
  campaign_id uuid primary key references public.campaigns(id) on delete restrict,
  id uuid not null unique default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  account_id text not null,
  ad_account_id text not null,
  connection_generation bigint not null,
  meta_campaign_id text not null check (length(meta_campaign_id) between 1 and 128),
  request_key text not null check (request_key ~ '^[a-f0-9]{64}$'),
  ceiling_paise bigint not null check (ceiling_paise between 1 and 9007199254740991),
  daily_budget_paise bigint not null check (daily_budget_paise between 1 and 9007199254740991),
  media_limit_paise bigint not null check (media_limit_paise between 1 and 9007199254740991),
  state text not null check (state in ('uncertain','active','paused','closed')),
  activation_in_flight boolean not null default true,
  updated_at timestamptz not null default clock_timestamp()
);
create table if not exists private.customer_refund_allocations (
  order_id uuid primary key references private.production_payment_orders(id) on delete restrict,
  service_refunded_paise bigint not null check (service_refunded_paise between 0 and 200000),
  advertising_refunded_paise bigint not null check (advertising_refunded_paise between 0 and 800000),
  service_earned_paise bigint not null check (service_earned_paise in (0,200000)),
  evidence_reference uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  check (service_refunded_paise + service_earned_paise <= 200000)
);
create table if not exists private.customer_refund_allocation_evidence (
  reference uuid primary key,
  order_id uuid not null references private.production_payment_orders(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  input jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.customer_ad_costs enable row level security;
alter table private.customer_ad_cost_evidence enable row level security;
alter table private.customer_ad_reservations enable row level security;
alter table private.customer_refund_allocations enable row level security;
alter table private.customer_refund_allocation_evidence enable row level security;
revoke all on private.customer_ad_costs,private.customer_ad_cost_evidence,private.customer_ad_reservations,private.customer_refund_allocations,private.customer_refund_allocation_evidence from public,anon,authenticated,service_role;

create or replace function public.customer_ad_balance(p_business_id uuid,p_user_id uuid,p_account_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  captured bigint; refunded bigint; service_allocation bigint; advertising bigint; ad_refunded bigint;
  media bigint; tax bigint; reserved bigint; held boolean; cost_held boolean;
begin
  if not exists(select 1 from public.businesses where id=p_business_id and owner_id=p_user_id) then
    raise exception 'Customer owner not found' using errcode='42501';
  end if;
  select coalesce(sum(payment.captured_paise),0),coalesce(sum(payment.refunded_paise),0),
    coalesce(sum(case when payment.captured_paise=payment.amount_paise then (payment.quote->>'serviceAllocationPaise')::bigint else 0 end),0),
    coalesce(sum(case when payment.captured_paise=payment.amount_paise then (payment.quote->>'metaAllocationPaise')::bigint else 0 end),0),
    coalesce(sum(case when payment.refunded_paise=payment.amount_paise then (payment.quote->>'metaAllocationPaise')::bigint else coalesce(allocation.advertising_refunded_paise,0) end),0),
    coalesce(bool_or(payment.review_required or payment.provider_refunded_paise<>payment.refunded_paise
      or (payment.refunded_paise>0 and payment.refunded_paise<payment.amount_paise
        and coalesce(allocation.service_refunded_paise+allocation.advertising_refunded_paise,-1)<>payment.refunded_paise)
      or (payment.refund_hold and payment.refunded_paise=0)
      or exists(select 1 from private.production_payment_refunds refund where refund.order_id=payment.id and refund.state in ('creating','submitted','needs_reconciliation'))
      or exists(select 1 from private.production_payment_events event where event.account_id=p_account_id
        and (event.payment_id=payment.payment_id or event.provider_order_id=payment.provider_order_id)
        and event.processed_at is null and event.kind in ('refund','dispute'))
      or (payment.captured_paise>0 and not exists(select 1 from private.production_payment_effects effect
        where effect.account_id=p_account_id and effect.order_id=payment.id and effect.kind='capture'
          and effect.payment_id=payment.payment_id and effect.amount_paise=payment.captured_paise))),false)
    into captured,refunded,service_allocation,advertising,ad_refunded,held
    from private.production_payment_orders payment
    left join private.customer_refund_allocations allocation on allocation.order_id=payment.id
    where payment.business_id=p_business_id and payment.user_id=p_user_id and payment.account_id=p_account_id and payment.environment='live';
  select coalesce(sum(cost.media_paise),0),coalesce(sum(cost.tax_paise),0),
    coalesce(bool_or(cost.held or (not cost.finalized and cost.observed_at<clock_timestamp()-interval '15 minutes')),false)
    into media,tax,cost_held from private.customer_ad_costs cost where cost.business_id=p_business_id and cost.account_id=p_account_id;
  select coalesce(sum(greatest(reservation.ceiling_paise-coalesce(cost.media_paise,0)-coalesce(cost.tax_paise,0),0)),0)
    into reserved from private.customer_ad_reservations reservation
    left join private.customer_ad_costs cost on cost.campaign_id=reservation.campaign_id
    where reservation.business_id=p_business_id and reservation.account_id=p_account_id and reservation.state<>'closed';
  held := held or cost_held or media+tax+reserved>advertising-ad_refunded
    or exists(select 1 from private.customer_ad_reservations reservation
      left join private.customer_ad_costs cost on cost.campaign_id=reservation.campaign_id
      where reservation.business_id=p_business_id and reservation.account_id=p_account_id and reservation.state<>'closed'
        and (cost.campaign_id is null or ceil(reservation.daily_budget_paise::numeric*7*(10000+cost.tax_rate_bps)/10000)
          >reservation.ceiling_paise-cost.media_paise-cost.tax_paise))
    or exists(select 1 from public.campaigns campaign where campaign.business_id=p_business_id and campaign.status='active'
      and not exists(select 1 from private.customer_ad_reservations reservation where reservation.campaign_id=campaign.id
        and reservation.account_id=p_account_id and reservation.state<>'closed'));
  return jsonb_build_object('businessId',p_business_id,'currency','INR','capturedPaise',captured,'refundedPaise',refunded,
    'serviceAllocationPaise',service_allocation,'advertisingAllocationPaise',advertising,'advertisingRefundedPaise',ad_refunded,
    'serviceEarnedPaise',coalesce((select sum(allocation.service_earned_paise) from private.customer_refund_allocations allocation
      join private.production_payment_orders payment on payment.id=allocation.order_id where payment.business_id=p_business_id and payment.account_id=p_account_id),0),
    'mediaCostPaise',media,'taxCostPaise',tax,'reservedPaise',reserved,
    'remainingPaise',case when held then 0 else greatest(advertising-ad_refunded-media-tax-reserved,0) end,
    'held',held,'reason',case when held then 'Payment, refund or cost reconciliation is required.' else null end,
    'reservations',coalesce((select jsonb_agg(jsonb_build_object('campaignId',campaign_id,'reservationId',id,'state',state))
      from private.customer_ad_reservations where business_id=p_business_id and account_id=p_account_id),'[]'::jsonb));
end;
$$;

create or replace function public.customer_ad_reserve(p_business_id uuid,p_user_id uuid,p_account_id text,
  p_campaign_id uuid,p_ad_account_id text,p_connection_generation bigint,p_daily_budget_paise bigint,p_request_key text,p_review_only boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  campaign public.campaigns;
  cost private.customer_ad_costs;
  reservation private.customer_ad_reservations;
  balance jsonb;
  available bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:'||p_account_id,0));
  balance := public.customer_ad_balance(p_business_id,p_user_id,p_account_id);
  select * into campaign from public.campaigns where id=p_campaign_id and business_id=p_business_id for update;
  if not found or not ((campaign.meta_campaign_id is not null and campaign.meta_campaign_id<>''
    and campaign.meta_ad_account_id=p_ad_account_id and campaign.meta_connection_generation=p_connection_generation
    and campaign.daily_budget*100=p_daily_budget_paise and p_daily_budget_paise>0 and p_request_key ~ '^[a-f0-9]{64}$'
    and exists(select 1 from public.meta_connections where business_id=p_business_id and authorization_status='connected'
      and ad_account_id=p_ad_account_id and generation=p_connection_generation)) is true) then
    raise exception 'Campaign customer binding changed' using errcode='23514';
  end if;
  select * into cost from private.customer_ad_costs where campaign_id=p_campaign_id;
  if not found or not ((cost.business_id=p_business_id and cost.account_id=p_account_id and cost.ad_account_id=p_ad_account_id
    and cost.connection_generation=p_connection_generation and not cost.held
    and cost.observed_at>=clock_timestamp()-interval '15 minutes' and not (balance->>'held')::boolean) is true) then
    raise exception 'Current attributed media and tax evidence required' using errcode='23514';
  end if;
  select * into reservation from private.customer_ad_reservations where campaign_id=p_campaign_id;
  if found and reservation.state not in ('paused','closed') then
    raise exception 'Existing activation must be reconciled before another attempt' using errcode='23514';
  end if;
  available := (balance->>'remainingPaise')::bigint;
  if reservation.state='paused' then available:=available+greatest(reservation.ceiling_paise-cost.media_paise-cost.tax_paise,0); end if;
  if available<ceil(p_daily_budget_paise::numeric*7*(10000+cost.tax_rate_bps)/10000) then
    raise exception 'Insufficient customer advertising allowance' using errcode='23514';
  end if;
  if p_review_only then return jsonb_build_object('reservationId',p_campaign_id,'mediaLimitPaise',cost.media_paise+floor(available::numeric*10000/(10000+cost.tax_rate_bps)),'balance',balance); end if;
  insert into private.customer_ad_reservations(campaign_id,business_id,account_id,ad_account_id,connection_generation,meta_campaign_id,request_key,ceiling_paise,daily_budget_paise,media_limit_paise,state)
    values(p_campaign_id,p_business_id,p_account_id,p_ad_account_id,p_connection_generation,campaign.meta_campaign_id,p_request_key,available+cost.media_paise+cost.tax_paise,p_daily_budget_paise,
      cost.media_paise+floor(available::numeric*10000/(10000+cost.tax_rate_bps)),'uncertain')
    on conflict(campaign_id) do update set id=gen_random_uuid(),request_key=excluded.request_key,ceiling_paise=excluded.ceiling_paise,
      daily_budget_paise=excluded.daily_budget_paise,media_limit_paise=excluded.media_limit_paise,state='uncertain',activation_in_flight=true,updated_at=clock_timestamp()
    returning * into reservation;
  update private.customer_ad_costs set finalized=false where campaign_id=p_campaign_id;
  return jsonb_build_object('reservationId',reservation.id,'mediaLimitPaise',reservation.media_limit_paise,'balance',public.customer_ad_balance(p_business_id,p_user_id,p_account_id));
end;
$$;

create or replace function public.customer_ad_activation_result(p_business_id uuid,p_user_id uuid,p_account_id text,
  p_campaign_id uuid,p_reservation_id uuid,p_state text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:'||p_account_id,0));
  perform public.customer_ad_balance(p_business_id,p_user_id,p_account_id);
  if p_state is null or p_state not in ('active','paused','uncertain') then raise exception 'Invalid provider state' using errcode='23514'; end if;
  update private.customer_ad_reservations set
    state=case when p_state='paused' and activation_in_flight then 'uncertain' else p_state end,
    activation_in_flight=case when p_state in ('active','uncertain') then false else activation_in_flight end,
    updated_at=clock_timestamp()
    where campaign_id=p_campaign_id and business_id=p_business_id and account_id=p_account_id and id=p_reservation_id and state<>'closed';
  if not found then raise exception 'Reservation changed' using errcode='23514'; end if;
end;
$$;

create or replace function public.customer_ad_reconcile_costs(p_business_id uuid,p_actor_id uuid,p_account_id text,
  p_campaign_id uuid,p_ad_account_id text,p_connection_generation bigint,p_media_paise bigint,p_tax_paise bigint,p_tax_rate_bps integer,
  p_observed_at timestamptz,p_evidence_reference uuid,p_final boolean,p_reservation_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  previous private.customer_ad_costs;
  reservation private.customer_ad_reservations;
  evidence jsonb;
  saved_evidence private.customer_ad_cost_evidence;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:'||p_account_id,0));
  if not public.production_payment_operator_allowed(p_actor_id,true) then raise exception 'Financial operator required' using errcode='42501'; end if;
  if not ((p_media_paise between 0 and 9007199254740991 and p_tax_paise between 0 and 9007199254740991
    and p_tax_rate_bps between 0 and 10000 and isfinite(p_observed_at) and p_observed_at<=clock_timestamp()
    and p_evidence_reference is not null and p_final is not null
    and exists(select 1 from public.campaigns where id=p_campaign_id and business_id=p_business_id
      and meta_ad_account_id=p_ad_account_id and meta_connection_generation=p_connection_generation)
    and exists(select 1 from private.production_payment_orders where business_id=p_business_id and account_id=p_account_id and environment='live')) is true) then
    raise exception 'Invalid attributed cost evidence' using errcode='23514';
  end if;
  evidence := jsonb_build_object('business',p_business_id,'merchant',p_account_id,'account',p_ad_account_id,'generation',p_connection_generation,
    'media',p_media_paise,'tax',p_tax_paise,'taxRateBps',p_tax_rate_bps,'observedAt',p_observed_at,'final',p_final,'reservation',p_reservation_id);
  select * into saved_evidence from private.customer_ad_cost_evidence where reference=p_evidence_reference;
  if found then
    if saved_evidence.actor_id<>p_actor_id or saved_evidence.campaign_id<>p_campaign_id or saved_evidence.input<>evidence then
      raise exception 'Cost evidence identity conflict' using errcode='23514';
    end if;
    return;
  end if;
  select * into previous from private.customer_ad_costs where campaign_id=p_campaign_id;
  if found and (previous.business_id<>p_business_id or previous.account_id<>p_account_id or previous.ad_account_id<>p_ad_account_id
    or previous.connection_generation<>p_connection_generation) then raise exception 'Cost account changed' using errcode='23514'; end if;
  select * into reservation from private.customer_ad_reservations where campaign_id=p_campaign_id;
  if p_final and ((reservation.id is not null and (reservation.id is distinct from p_reservation_id or reservation.state<>'paused'
      or reservation.activation_in_flight or p_observed_at<reservation.updated_at))
    or not exists(select 1 from public.campaigns where id=p_campaign_id and status='paused')
    or p_observed_at<clock_timestamp()-interval '15 minutes' or p_observed_at<previous.observed_at
    or p_media_paise<previous.media_paise or p_tax_paise<previous.tax_paise) then
    raise exception 'Paused delivery and final reconciled costs required' using errcode='23514';
  end if;
  insert into private.customer_ad_cost_evidence(reference,actor_id,campaign_id,input) values(p_evidence_reference,p_actor_id,p_campaign_id,evidence);
  insert into private.customer_ad_costs(campaign_id,business_id,account_id,ad_account_id,connection_generation,media_paise,tax_paise,tax_rate_bps,observed_at,finalized)
    values(p_campaign_id,p_business_id,p_account_id,p_ad_account_id,p_connection_generation,p_media_paise,p_tax_paise,p_tax_rate_bps,p_observed_at,p_final)
    on conflict(campaign_id) do update set media_paise=greatest(private.customer_ad_costs.media_paise,excluded.media_paise),
      tax_paise=greatest(private.customer_ad_costs.tax_paise,excluded.tax_paise),
      tax_rate_bps=case when excluded.observed_at>=private.customer_ad_costs.observed_at then excluded.tax_rate_bps else private.customer_ad_costs.tax_rate_bps end,
      held=private.customer_ad_costs.held or (excluded.observed_at>=private.customer_ad_costs.observed_at
        and (excluded.media_paise<private.customer_ad_costs.media_paise or excluded.tax_paise<private.customer_ad_costs.tax_paise)),
      observed_at=greatest(private.customer_ad_costs.observed_at,excluded.observed_at),
      finalized=case when excluded.observed_at>=private.customer_ad_costs.observed_at then excluded.finalized else private.customer_ad_costs.finalized end;
  if p_final then update private.customer_ad_reservations set state='closed',updated_at=clock_timestamp() where campaign_id=p_campaign_id and id=p_reservation_id; end if;
end;
$$;

create or replace function public.customer_ad_refund_allocation(p_business_id uuid,p_actor_id uuid,p_account_id text,p_order_id uuid,
  p_service_refunded_paise bigint,p_advertising_refunded_paise bigint,p_service_earned_paise bigint,p_evidence_reference uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare payment private.production_payment_orders; previous private.customer_refund_allocations;
  evidence jsonb; saved_evidence private.customer_refund_allocation_evidence;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:'||p_account_id,0));
  if not public.production_payment_operator_allowed(p_actor_id,true) then raise exception 'Financial operator required' using errcode='42501'; end if;
  select * into payment from private.production_payment_orders where id=p_order_id and business_id=p_business_id and account_id=p_account_id and environment='live';
  if not found or not ((payment.captured_paise=payment.amount_paise and p_service_refunded_paise between 0 and (payment.quote->>'serviceAllocationPaise')::bigint
    and p_advertising_refunded_paise between 0 and (payment.quote->>'metaAllocationPaise')::bigint
    and p_service_refunded_paise+p_advertising_refunded_paise=payment.refunded_paise and p_service_earned_paise in (0,200000)
    and p_service_earned_paise+p_service_refunded_paise<=200000 and p_evidence_reference is not null) is true) then
    raise exception 'Refund allocation must match verified payment and delivery evidence' using errcode='23514';
  end if;
  evidence:=jsonb_build_object('serviceRefunded',p_service_refunded_paise,'advertisingRefunded',p_advertising_refunded_paise,'serviceEarned',p_service_earned_paise);
  select * into saved_evidence from private.customer_refund_allocation_evidence where reference=p_evidence_reference;
  if found then
    if saved_evidence.order_id<>p_order_id or saved_evidence.actor_id<>p_actor_id or saved_evidence.input<>evidence then
      raise exception 'Refund allocation evidence conflict' using errcode='23514';
    end if;
    return;
  end if;
  select * into previous from private.customer_refund_allocations where order_id=p_order_id;
  if found and (p_service_refunded_paise<previous.service_refunded_paise or p_advertising_refunded_paise<previous.advertising_refunded_paise
    or p_service_earned_paise<previous.service_earned_paise) then raise exception 'Financial allocations cannot be silently reduced' using errcode='23514'; end if;
  insert into private.customer_refund_allocation_evidence(reference,order_id,actor_id,input) values(p_evidence_reference,p_order_id,p_actor_id,evidence);
  insert into private.customer_refund_allocations(order_id,service_refunded_paise,advertising_refunded_paise,service_earned_paise,evidence_reference,actor_id)
    values(p_order_id,p_service_refunded_paise,p_advertising_refunded_paise,p_service_earned_paise,p_evidence_reference,p_actor_id)
    on conflict(order_id) do update set service_refunded_paise=excluded.service_refunded_paise,advertising_refunded_paise=excluded.advertising_refunded_paise,
      service_earned_paise=excluded.service_earned_paise,evidence_reference=excluded.evidence_reference,actor_id=excluded.actor_id;
end;
$$;

create or replace function private.customer_ad_refund_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare payment private.production_payment_orders;
begin
  select * into payment from private.production_payment_orders where id=new.order_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:'||payment.account_id,0));
  if exists(select 1 from private.customer_ad_reservations where business_id=payment.business_id and account_id=payment.account_id and state<>'closed')
    or exists(select 1 from private.customer_ad_costs where business_id=payment.business_id and account_id=payment.account_id and (not finalized or held))
    or new.amount_paise>payment.captured_paise-greatest(payment.refunded_paise,payment.provider_refunded_paise)
      -coalesce((select sum(media_paise+tax_paise) from private.customer_ad_costs where business_id=payment.business_id and account_id=payment.account_id),0)
      -coalesce((select service_earned_paise from private.customer_refund_allocations where order_id=payment.id),0) then
    raise exception 'Customer costs and reservations must be reconciled before refund' using errcode='23514';
  end if;
  return new;
end;
$$;
drop trigger if exists customer_ad_refund_guard on private.production_payment_refunds;
create trigger customer_ad_refund_guard before insert on private.production_payment_refunds for each row execute function private.customer_ad_refund_guard();

create or replace function private.customer_ad_campaign_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare reservation private.customer_ad_reservations; cost private.customer_ad_costs; balance jsonb; owner_id uuid;
begin
  if tg_op='UPDATE' and new.meta_campaign_id is distinct from old.meta_campaign_id
    and (exists(select 1 from private.customer_ad_reservations where campaign_id=new.id)
      or exists(select 1 from private.customer_ad_costs where campaign_id=new.id)) then
    raise exception 'Financially attributed Meta campaign cannot be rebound' using errcode='23514';
  end if;
  if new.status<>'active' then return new; end if;
  if tg_op='UPDATE' and old.status='active' and new.daily_budget is not distinct from old.daily_budget
    and new.business_id=old.business_id and new.meta_ad_account_id is not distinct from old.meta_ad_account_id
    and new.meta_connection_generation is not distinct from old.meta_connection_generation
    and new.meta_campaign_id is not distinct from old.meta_campaign_id then return new; end if;
  select * into reservation from private.customer_ad_reservations where campaign_id=new.id;
  if not found then raise exception 'Customer reservation required before activation or budget change' using errcode='23514'; end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:'||reservation.account_id,0)) then
    raise exception 'Customer accounting is busy; retry after reconciliation' using errcode='55P03';
  end if;
  select * into reservation from private.customer_ad_reservations where campaign_id=new.id;
  select * into cost from private.customer_ad_costs where campaign_id=new.id;
  select business.owner_id into owner_id from public.businesses business where id=new.business_id;
  balance:=public.customer_ad_balance(new.business_id,owner_id,reservation.account_id);
  if not ((reservation.state in ('uncertain','active') and reservation.business_id=new.business_id and reservation.ad_account_id=new.meta_ad_account_id
    and reservation.meta_campaign_id=new.meta_campaign_id
    and reservation.connection_generation=new.meta_connection_generation and new.daily_budget*100<=reservation.daily_budget_paise
    and not (balance->>'held')::boolean and cost.observed_at>=clock_timestamp()-interval '15 minutes'
    and ceil(new.daily_budget::numeric*100*7*(10000+cost.tax_rate_bps)/10000)<=reservation.ceiling_paise-cost.media_paise-cost.tax_paise) is true) then
    raise exception 'Customer advertising reservation is unavailable' using errcode='23514';
  end if;
  return new;
end;
$$;
drop trigger if exists customer_ad_campaign_guard on public.campaigns;
create trigger customer_ad_campaign_guard before insert or update on public.campaigns for each row execute function private.customer_ad_campaign_guard();

revoke all on function public.customer_ad_balance(uuid,uuid,text),public.customer_ad_reserve(uuid,uuid,text,uuid,text,bigint,bigint,text,boolean),
  public.customer_ad_activation_result(uuid,uuid,text,uuid,uuid,text),
  public.customer_ad_refund_allocation(uuid,uuid,text,uuid,bigint,bigint,bigint,uuid),
  public.customer_ad_reconcile_costs(uuid,uuid,text,uuid,text,bigint,bigint,bigint,integer,timestamptz,uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.customer_ad_balance(uuid,uuid,text),public.customer_ad_reserve(uuid,uuid,text,uuid,text,bigint,bigint,text,boolean),
  public.customer_ad_activation_result(uuid,uuid,text,uuid,uuid,text),
  public.customer_ad_refund_allocation(uuid,uuid,text,uuid,bigint,bigint,bigint,uuid),
  public.customer_ad_reconcile_costs(uuid,uuid,text,uuid,text,bigint,bigint,bigint,integer,timestamptz,uuid,boolean,uuid) to service_role;
revoke all on function private.customer_ad_refund_guard(),private.customer_ad_campaign_guard() from public,anon,authenticated,service_role;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create schema if not exists private;
create table if not exists private.creative_generation_intents (
  generation_id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  expected_count integer not null check (expected_count between 1 and 6),
  month_start date not null,
  reserved_tokens bigint not null check (reserved_tokens between 0 and 9007199254740991),
  image_floor_tokens bigint not null check (image_floor_tokens between 0 and 9007199254740991),
  accounted_tokens bigint not null default 0 check (accounted_tokens between 0 and 9007199254740991),
  state text not null default 'processing' check (state in ('processing', 'partial', 'complete', 'failed', 'unresolved', 'abandoned')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists creative_generation_intents_month_idx
  on private.creative_generation_intents(business_id, month_start);
alter table private.creative_generation_intents enable row level security;
revoke all on private.creative_generation_intents from public, anon, authenticated, service_role;

create or replace function public.creative_generation_admit(
  p_business_id uuid, p_user_id uuid, p_generation_id uuid, p_request_hash text,
  p_expected_count integer, p_reserved_tokens bigint, p_image_floor_tokens bigint, p_monthly_limit bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  intent private.creative_generation_intents;
  period_start date := date_trunc('month', timezone('UTC', clock_timestamp()))::date;
  used_tokens numeric;
  outstanding_tokens numeric;
begin
  if p_business_id is null or p_user_id is null or p_generation_id is null
    or p_request_hash !~ '^[a-f0-9]{64}$' or p_expected_count not between 1 and 6
    or p_reserved_tokens not between 1 and 9007199254740991
    or p_image_floor_tokens not between 0 and p_reserved_tokens
    or p_monthly_limit not between 0 and 9007199254740991 then
    raise exception 'Invalid generation admission' using errcode = '22023';
  end if;
  if not exists(select 1 from public.businesses where id=p_business_id and owner_id=p_user_id) then
    return jsonb_build_object('action','missing');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('creative-id:'||p_generation_id,0));
  select * into intent from private.creative_generation_intents where generation_id=p_generation_id;
  if found then
    if intent.business_id<>p_business_id or intent.user_id<>p_user_id then return jsonb_build_object('action','missing'); end if;
    if intent.state='abandoned' then return jsonb_build_object('action','missing'); end if;
    if intent.request_hash<>p_request_hash or intent.expected_count<>p_expected_count then return jsonb_build_object('action','conflict'); end if;
    return jsonb_build_object('action','recover','status',intent.state,'expectedCount',intent.expected_count);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('creative-quota:'||p_business_id||':'||period_start,0));
  select coalesce(sum(total_tokens),0) into used_tokens from public.llm_usage_events
    where business_id=p_business_id and created_at >= (period_start::timestamp at time zone 'UTC');
  select coalesce(sum(greatest(reserved_tokens-accounted_tokens,0)),0) into outstanding_tokens
    from private.creative_generation_intents
    where business_id=p_business_id and (month_start=period_start or state in ('processing','partial','unresolved'));
  if p_monthly_limit>0 and used_tokens+outstanding_tokens+p_reserved_tokens>p_monthly_limit then
    return jsonb_build_object('action','quota');
  end if;
  insert into private.creative_generation_intents(generation_id,business_id,user_id,request_hash,expected_count,month_start,reserved_tokens,image_floor_tokens)
    values(p_generation_id,p_business_id,p_user_id,p_request_hash,p_expected_count,period_start,p_reserved_tokens,p_image_floor_tokens);
  return jsonb_build_object('action','start','status','processing','expectedCount',p_expected_count);
end;
$$;

create or replace function public.creative_generation_status(p_business_id uuid,p_user_id uuid,p_generation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  intent private.creative_generation_intents;
  period_start date := date_trunc('month', timezone('UTC', clock_timestamp()))::date;
begin
  if not exists(select 1 from public.businesses where id=p_business_id and owner_id=p_user_id) then
    return jsonb_build_object('status','unknown');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('creative-id:'||p_generation_id,0));
  select * into intent from private.creative_generation_intents where generation_id=p_generation_id;
  if not found then
    insert into private.creative_generation_intents(generation_id,business_id,user_id,request_hash,expected_count,month_start,reserved_tokens,image_floor_tokens,state)
      values(p_generation_id,p_business_id,p_user_id,repeat('0',64),1,period_start,0,0,'abandoned');
    return jsonb_build_object('status','unknown');
  end if;
  if intent.business_id<>p_business_id or intent.user_id<>p_user_id or intent.state='abandoned' then
    return jsonb_build_object('status','unknown');
  end if;
  return jsonb_build_object('status',case when intent.state in ('processing','partial') and intent.updated_at < clock_timestamp()-interval '5 minutes'
    then 'unresolved' else intent.state end,'expectedCount',intent.expected_count);
end;
$$;

create or replace function public.creative_generation_progress(
  p_business_id uuid,p_user_id uuid,p_generation_id uuid,p_accounted_tokens bigint default 0,
  p_complete boolean default false,p_uncertain boolean default false,p_failed boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare intent private.creative_generation_intents; saved_count integer;
begin
  if p_accounted_tokens is null or p_accounted_tokens not between 0 and 9007199254740991 then
    raise exception 'Invalid recorded usage' using errcode='22023';
  end if;
  select * into intent from private.creative_generation_intents
    where generation_id=p_generation_id and business_id=p_business_id and user_id=p_user_id for update;
  if not found or not exists(select 1 from public.businesses where id=p_business_id and owner_id=p_user_id) then
    return jsonb_build_object('status','unknown');
  end if;
  if intent.state='abandoned' then return jsonb_build_object('status','unknown'); end if;
  if intent.state in ('complete','failed') then return jsonb_build_object('status',intent.state); end if;
  select count(*) into saved_count from public.creatives where business_id=p_business_id and variant_group=p_generation_id;
  update private.creative_generation_intents set
    accounted_tokens=accounted_tokens+p_accounted_tokens,
    reserved_tokens=case when intent.state<>'unresolved' and not p_uncertain and p_complete and saved_count>=intent.expected_count
      then accounted_tokens+p_accounted_tokens+intent.image_floor_tokens
      when intent.state<>'unresolved' and not p_uncertain and p_complete and p_failed and saved_count=0
      then accounted_tokens+p_accounted_tokens
      else greatest(reserved_tokens,accounted_tokens+p_accounted_tokens) end,
    state=case when intent.state='unresolved' or p_uncertain then 'unresolved'
      when p_complete and p_failed and saved_count=0 then 'failed'
      when p_complete and saved_count>=intent.expected_count then 'complete'
      when saved_count>0 then 'partial' else 'processing' end,
    updated_at=clock_timestamp()
    where generation_id=p_generation_id returning * into intent;
  return jsonb_build_object('status',intent.state,'count',saved_count,'expectedCount',intent.expected_count);
end;
$$;

revoke all on function public.creative_generation_admit(uuid,uuid,uuid,text,integer,bigint,bigint,bigint) from public,anon,authenticated;
revoke all on function public.creative_generation_status(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.creative_generation_progress(uuid,uuid,uuid,bigint,boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function public.creative_generation_admit(uuid,uuid,uuid,text,integer,bigint,bigint,bigint) to service_role;
grant execute on function public.creative_generation_status(uuid,uuid,uuid) to service_role;
grant execute on function public.creative_generation_progress(uuid,uuid,uuid,bigint,boolean,boolean,boolean) to service_role;
commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists private.creative_regeneration_claims (
  creative_id uuid primary key references public.creatives(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  attempt_id uuid not null unique,
  state text not null default 'processing' check (state in ('processing','unresolved')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table private.creative_regeneration_claims enable row level security;
revoke all on private.creative_regeneration_claims from public, anon, authenticated, service_role;

create or replace function public.creative_regeneration_claim(
  p_creative_id uuid, p_business_id uuid, p_user_id uuid, p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare previous_state text;
begin
  if p_creative_id is null or p_business_id is null or p_user_id is null or p_attempt_id is null then
    raise exception 'Invalid regeneration claim' using errcode='22023';
  end if;
  if not exists(select 1 from public.creatives c join public.businesses b on b.id=c.business_id
    where c.id=p_creative_id and c.business_id=p_business_id and b.owner_id=p_user_id) then
    return jsonb_build_object('action','missing');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('creative-regenerate:'||p_creative_id,0));
  select state into previous_state from private.creative_regeneration_claims where creative_id=p_creative_id;
  if found then return jsonb_build_object('action','busy','status',previous_state); end if;
  insert into private.creative_regeneration_claims(creative_id,business_id,user_id,attempt_id)
    values(p_creative_id,p_business_id,p_user_id,p_attempt_id);
  return jsonb_build_object('action','start');
end;
$$;

create or replace function public.creative_regeneration_finish(
  p_creative_id uuid, p_business_id uuid, p_user_id uuid, p_attempt_id uuid, p_unresolved boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare settled_id uuid;
begin
  if p_creative_id is null or p_business_id is null or p_user_id is null or p_attempt_id is null or p_unresolved is null then
    raise exception 'Invalid regeneration settlement' using errcode='22023';
  end if;
  if p_unresolved then
    update private.creative_regeneration_claims set state='unresolved',updated_at=clock_timestamp()
      where creative_id=p_creative_id and business_id=p_business_id and user_id=p_user_id
        and attempt_id=p_attempt_id and state='processing' returning creative_id into settled_id;
    return jsonb_build_object('status',case when settled_id is null then 'missing' else 'unresolved' end);
  end if;
  delete from private.creative_regeneration_claims
    where creative_id=p_creative_id and business_id=p_business_id and user_id=p_user_id
      and attempt_id=p_attempt_id and state='processing' returning creative_id into settled_id;
  return jsonb_build_object('status',case when settled_id is null then 'missing' else 'released' end);
end;
$$;

revoke all on function public.creative_regeneration_claim(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.creative_regeneration_finish(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.creative_regeneration_claim(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.creative_regeneration_finish(uuid,uuid,uuid,uuid,boolean) to service_role;
commit;

create or replace function private.production_payment_quote(p_amount bigint,p_verification boolean default false)
returns jsonb language sql immutable set search_path = '' as $$
  select case when p_amount between 100 and 1000000 and p_verification is not null then
    jsonb_build_object('version',case when p_verification then 'inr-payment-verification-v1'
      when p_amount=1000000 then 'inr-annual-total-v1' else 'inr-annual-configurable-v1' end,
      'merchantDisplay','Vanshul Goyal','currency','INR','totalPaise',p_amount,
      'serviceAllocationPaise',case when p_verification then 0 else p_amount/5 end,
      'metaAllocationPaise',case when p_verification then 0 else p_amount-p_amount/5 end,
      'additionalCustomerTaxPaise',0,'metaTaxTreatment','included-in-meta-allocation',
      'gatewayFees','absorbed-by-adbrain','automaticRenewal',false)
      || case when p_verification then jsonb_build_object('verificationAllocationPaise',p_amount) else '{}'::jsonb end
    else null end;
$$;

create or replace function private.production_payment_rupees(p_amount bigint)
returns text language sql immutable set search_path = '' as $$
  select 'INR '||rtrim(rtrim(to_char(p_amount::numeric/100,'FM999,999,990.00'),'0'),'.');
$$;

create or replace function private.production_payment_priced_policy(p_quote jsonb,p_verification jsonb default null)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare service_scope text; refund_terms text;
begin
  if p_verification is not null then
    service_scope := 'One real '||private.production_payment_rupees((p_quote->>'totalPaise')::bigint)
      ||' payment to verify checkout for the selected internal pilot. This is not the annual service and grants no service or advertising allocation, renewal or ad activation. AdBrain absorbs gateway fees; no additional checkout charge applies.';
    refund_terms := 'This verification payment remains recorded separately from service and advertising funds. Refund requests are handled by the operator under applicable law; no automatic refund is initiated. Mandatory customer rights remain applicable.';
  else
    service_scope := private.production_payment_rupees((p_quote->>'totalPaise')::bigint)
      ||' total for 12 months for one business, one offer and one service area, including up to two creatives and one capped Meta campaign. '
      ||private.production_payment_rupees((p_quote->>'serviceAllocationPaise')::bigint)||' is allocated to service and '
      ||private.production_payment_rupees((p_quote->>'metaAllocationPaise')::bigint)
      ||' to advertising including applicable Meta taxes. AdBrain absorbs gateway fees. No extra checkout charge, automatic renewal, year-round ad delivery or guaranteed results. The operator pays Meta separately; payment to AdBrain is not confirmation of a transfer to Meta or permission to activate ads.';
    refund_terms := 'Full refund before work starts. After work starts, unused advertising allocation is refundable after pending costs are reconciled. The '
      ||private.production_payment_rupees((p_quote->>'serviceAllocationPaise')::bigint)
      ||' service allocation is earned only after the agreed creatives and campaign setup are delivered; otherwise it remains refundable. Mandatory customer rights remain applicable.';
  end if;
  return jsonb_build_object('version','operator-managed-priced-v1','fundingMode','operator_managed',
    'approvalReference','https://github.com/vanshulgoyal101/adbrain/issues/48#issuecomment-5858162341',
    'approvedAt','2026-09-27T17:36:03Z','serviceScope',service_scope,
    'invoiceTerms','The invoice will reflect Vanshul Goyal''s actual tax status and applicable law. This payment receipt is not a tax invoice and makes no GST-registration claim. No additional checkout charge applies. Mandatory customer rights remain applicable.',
    'refundTerms',refund_terms,'quote',p_quote)
    || case when p_verification is not null then jsonb_build_object('verification',p_verification) else '{}'::jsonb end;
end;
$$;

create or replace function private.production_payment_contract_valid(p_amount bigint,p_quote jsonb,p_terms jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare verification boolean;
begin
  verification := coalesce(p_quote->>'version'='inr-payment-verification-v1',false);
  if p_quote is distinct from private.production_payment_quote(p_amount,verification)
    or p_amount is null or jsonb_typeof(p_quote)<>'object' then return false; end if;
  if p_terms->>'version'='operator-managed-priced-v1' then
    if verification then
      if not ((jsonb_typeof(p_terms->'verification')='object'
        and (p_terms->'verification')-array['businessId','userId','expiresAt']='{}'::jsonb
        and (p_terms#>>'{verification,businessId}')::uuid is not null
        and (p_terms#>>'{verification,userId}')::uuid is not null
        and isfinite((p_terms#>>'{verification,expiresAt}')::timestamptz)) is true) then return false; end if;
    elsif p_terms ? 'verification' then return false;
    end if;
    return p_terms=private.production_payment_priced_policy(p_quote,case when verification then p_terms->'verification' else null end);
  end if;
  return not verification and p_quote=private.production_payment_quote(1000000,false);
exception when others then return false;
end;
$$;

revoke all on function private.production_payment_quote(bigint,boolean),private.production_payment_rupees(bigint),
  private.production_payment_priced_policy(jsonb,jsonb),private.production_payment_contract_valid(bigint,jsonb,jsonb)
  from public,anon,authenticated,service_role;

alter table private.production_payment_orders drop constraint production_payment_orders_amount_paise_check;
alter table private.production_payment_orders drop constraint production_payment_orders_quote_check;
alter table private.production_payment_orders drop constraint production_payment_orders_captured_paise_check;
alter table private.production_payment_orders drop constraint production_payment_orders_refunded_paise_check;
alter table private.production_payment_orders drop constraint production_payment_orders_provider_refunded_paise_check;
alter table private.production_payment_orders drop constraint production_payment_funding_mode_check;
alter table private.production_payment_orders add constraint production_payment_amount_check check(amount_paise between 100 and 1000000);
alter table private.production_payment_orders add constraint production_payment_quote_check check(private.production_payment_contract_valid(amount_paise,quote,terms) is true);
alter table private.production_payment_orders add constraint production_payment_captured_check check(captured_paise in (0,amount_paise));
alter table private.production_payment_orders add constraint production_payment_refunded_check check(refunded_paise between 0 and amount_paise);
alter table private.production_payment_orders add constraint production_payment_provider_refunded_check check(provider_refunded_paise between 0 and amount_paise);
alter table private.production_payment_orders add constraint production_payment_funding_mode_check check((
  (terms->>'version' in ('operator-managed-v1','operator-managed-priced-v1') and terms->>'fundingMode'='operator_managed' and funding_evidence_id is null)
  or (terms->>'version' not in ('operator-managed-v1','operator-managed-priced-v1') and not(terms ? 'fundingMode') and funding_evidence_id is not null)
) is true);
alter table private.production_payment_orders drop column state;
alter table private.production_payment_orders add column state text generated always as (case
  when review_required then 'review_required'
  when refunded_paise=amount_paise then 'refunded'
  when refunded_paise>0 then 'partially_refunded'
  when refund_hold then 'refund_pending'
  when captured_paise=amount_paise then 'captured'
  when creation_uncertain then 'needs_reconciliation'
  when provider_order_id is not null then 'created'
  else 'creating' end) stored;
alter table private.production_payment_orders add column purpose text generated always as (
  case when quote->>'version'='inr-payment-verification-v1' then 'verification' else 'annual' end
) stored;
drop index private.production_payment_orders_active_business_idx;
create unique index if not exists production_payment_orders_active_business_idx on private.production_payment_orders(business_id)
  where purpose='annual' and (refunded_paise<amount_paise or review_required);
create unique index if not exists production_payment_verification_once_idx on private.production_payment_orders(business_id) where purpose='verification';

create or replace function private.production_payment_identity_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.id,new.business_id,new.user_id,new.request_key,new.environment,new.account_id,new.key_id,new.amount_paise,new.currency,new.quote,new.terms,new.terms_hash,new.funding_evidence_id,new.accepted_at)
    is distinct from (old.id,old.business_id,old.user_id,old.request_key,old.environment,old.account_id,old.key_id,old.amount_paise,old.currency,old.quote,old.terms,old.terms_hash,old.funding_evidence_id,old.accepted_at) then
    raise exception 'Payment identity and accepted quote are immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger production_payment_identity_guard before update on private.production_payment_orders
  for each row execute function private.production_payment_identity_guard();
revoke all on function private.production_payment_identity_guard() from public,anon,authenticated,service_role;

alter table private.production_payment_effects drop constraint production_payment_effects_check;
alter table private.production_payment_effects add constraint production_payment_effect_identity_check check(
  (kind='capture' and provider_id=payment_id) or (kind='refund' and provider_id ~ '^rfnd_[A-Za-z0-9]{1,100}$'));
create or replace function private.production_payment_effect_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare payment private.production_payment_orders;
begin
  select * into payment from private.production_payment_orders where id=new.order_id;
  if not found or new.account_id is distinct from payment.account_id or new.amount_paise>payment.amount_paise
    or (new.kind='capture' and new.amount_paise<>payment.amount_paise) then
    raise exception 'Payment effect must match the saved order amount' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger production_payment_effect_guard before insert or update on private.production_payment_effects
  for each row execute function private.production_payment_effect_guard();
revoke all on function private.production_payment_effect_guard() from public,anon,authenticated,service_role;

create or replace function public.production_payment_order_claim(
  p_business_id uuid,p_user_id uuid,p_request_key uuid,p_order_id uuid,
  p_account_id text,p_key_id text,p_quote jsonb,p_terms text,p_terms_hash text,p_funding_evidence_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.production_payment_orders; policy jsonb; verification boolean; amount bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:'||p_account_id,0));
  perform 1 from public.businesses where id=p_business_id and owner_id=p_user_id for update;
  if not found then raise exception 'Payment owner not found' using errcode='23514'; end if;
  if p_terms is null or octet_length(p_terms)>32768 or p_terms_hash is distinct from encode(sha256(convert_to(p_terms,'UTF8')),'hex') then
    raise exception 'Payment terms digest mismatch' using errcode='23514';
  end if;
  policy := p_terms::jsonb;
  amount := (p_quote->>'totalPaise')::bigint;
  verification := coalesce(p_quote->>'version'='inr-payment-verification-v1',false);
  if not private.production_payment_contract_valid(amount,p_quote,policy) then
    raise exception 'Invalid payment quote contract' using errcode='23514';
  end if;
  if policy->>'version'='operator-managed-priced-v1' then
    if p_funding_evidence_id is not null or (policy->>'approvedAt')::timestamptz>clock_timestamp()
      or (verification and not ((policy#>>'{verification,businessId}')::uuid=p_business_id
        and (policy#>>'{verification,userId}')::uuid=p_user_id
        and (policy#>>'{verification,expiresAt}')::timestamptz>clock_timestamp()
        and (policy#>>'{verification,expiresAt}')::timestamptz<=clock_timestamp()+interval '24 hours') is true) then
      raise exception 'Verification scope or pricing approval is unavailable' using errcode='23514';
    end if;
  elsif policy->>'version'='operator-managed-v1' then
    if p_funding_evidence_id is not null or policy is distinct from $policy${"version":"operator-managed-v1","fundingMode":"operator_managed","approvalReference":"https://github.com/vanshulgoyal101/adbrain/issues/48#issuecomment-5848530300","approvedAt":"2026-09-26T17:58:20Z","serviceScope":"INR 10,000 total for 12 months for one business, one offer and one service area, including up to two creatives and one capped Meta campaign. INR 2,000 is allocated to service and INR 8,000 to advertising including applicable Meta taxes. AdBrain absorbs gateway fees. No extra checkout charge, automatic renewal, year-round ad delivery or guaranteed results. The operator pays Meta separately; payment to AdBrain is not confirmation of a transfer to Meta or permission to activate ads.","invoiceTerms":"The invoice will reflect Vanshul Goyal's actual tax status and applicable law. This payment receipt is not a tax invoice and makes no GST-registration claim. No additional checkout charge applies. Mandatory customer rights remain applicable.","refundTerms":"Full refund before work starts. After work starts, unused advertising allocation is refundable after pending costs are reconciled. The INR 2,000 service allocation is earned only after the agreed creatives and campaign setup are delivered; otherwise it remains refundable. Mandatory customer rights remain applicable."}$policy$::jsonb
      or (policy->>'approvedAt')::timestamptz>clock_timestamp() then
      raise exception 'Operator-managed policy is not approved' using errcode='23514';
    end if;
  else
    if not ((jsonb_typeof(policy)='object'
      and policy-array['version','approvalReference','approvedAt','expiresAt','serviceScope','invoiceTerms','refundTerms','automaticFundingApprovalReference']='{}'::jsonb
      and (policy->>'version') ~ '^[a-z0-9][a-z0-9-]{0,63}$'
      and (policy->>'approvalReference')::uuid is not null and (policy->>'automaticFundingApprovalReference')::uuid is not null
      and length(trim(policy->>'serviceScope')) between 1 and 8000
      and length(trim(policy->>'invoiceTerms')) between 1 and 8000 and length(trim(policy->>'refundTerms')) between 1 and 8000
      and isfinite((policy->>'approvedAt')::timestamptz) and (policy->>'approvedAt')::timestamptz<=clock_timestamp()
      and isfinite((policy->>'expiresAt')::timestamptz) and (policy->>'expiresAt')::timestamptz>clock_timestamp()) is true)
      or not public.production_payment_funding_valid(p_business_id,p_funding_evidence_id) then
      raise exception 'Legacy policy or automatic funding evidence unavailable' using errcode='23514';
    end if;
  end if;
  select * into saved from private.production_payment_orders where business_id=p_business_id
    and (request_key=p_request_key or (purpose=case when verification then 'verification' else 'annual' end
      and (verification or refunded_paise<amount_paise or review_required)))
    order by (request_key=p_request_key) desc limit 1;
  if found then
    if saved.user_id is distinct from p_user_id or saved.account_id is distinct from p_account_id or saved.key_id is distinct from p_key_id
      or saved.terms_hash is distinct from p_terms_hash or saved.terms is distinct from policy or saved.quote is distinct from p_quote
      or saved.funding_evidence_id is distinct from p_funding_evidence_id then
      raise exception 'Payment request scope changed' using errcode='23514';
    end if;
    return jsonb_build_object('claimed',false,'order',to_jsonb(saved));
  end if;
  insert into private.production_payment_orders(id,business_id,user_id,request_key,account_id,key_id,amount_paise,quote,terms,terms_hash,funding_evidence_id)
    values(p_order_id,p_business_id,p_user_id,p_request_key,p_account_id,p_key_id,amount,p_quote,policy,p_terms_hash,p_funding_evidence_id)
    returning * into saved;
  return jsonb_build_object('claimed',true,'order',to_jsonb(saved));
end;
$$;

create or replace function public.production_payment_orders_list(p_business_id uuid,p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(payment)),'[]'::jsonb) from (
    select orders.* from private.production_payment_orders orders
    join public.businesses business on business.id=orders.business_id and business.owner_id=p_user_id
    where orders.business_id=p_business_id and orders.user_id=p_user_id
    order by (orders.purpose='verification') desc,orders.accepted_at desc limit 20
  ) payment;
$$;

create or replace function public.production_payment_observe(
  p_order_id uuid,p_account_id text,p_key_id text,p_payment_id text,p_capture_verified boolean,
  p_provider_refunded_paise bigint,p_review_required boolean,p_snapshot_hash text,
  p_refund_id text default null,p_refund_amount_paise bigint default null,p_refund_status text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.production_payment_orders; existing private.production_payment_effects; refund_total bigint;
begin
  if not ((p_payment_id ~ '^pay_[A-Za-z0-9]{1,100}$' and p_capture_verified is not null and p_review_required is not null
    and p_provider_refunded_paise between 0 and 1000000 and p_snapshot_hash ~ '^[a-f0-9]{64}$'
    and ((p_refund_id is null and p_refund_amount_paise is null and p_refund_status is null)
      or (p_refund_id ~ '^rfnd_[A-Za-z0-9]{1,100}$' and p_refund_amount_paise between 1 and 1000000 and p_refund_status in ('pending','processed','failed')))) is true) then
    raise exception 'Invalid payment observation' using errcode='23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:'||p_account_id,0));
  select * into saved from private.production_payment_orders where id=p_order_id and account_id=p_account_id and key_id=p_key_id for update;
  if not found or saved.provider_order_id is null then raise exception 'Payment order not ready' using errcode='23514'; end if;
  if p_provider_refunded_paise>saved.amount_paise or p_refund_amount_paise>saved.amount_paise then
    update private.production_payment_orders set review_required=true,updated_at=clock_timestamp() where id=p_order_id returning * into saved;
    return to_jsonb(saved);
  end if;
  update private.production_payment_orders set
    review_required=review_required or p_review_required
      or (payment_id is not null and payment_id<>p_payment_id and (p_capture_verified or p_refund_id is not null or p_provider_refunded_paise>0))
      or exists(select 1 from private.production_payment_effects where order_id=p_order_id and payment_id<>p_payment_id)
      or exists(select 1 from private.production_payment_events where account_id=p_account_id
        and (payment_id=p_payment_id or provider_order_id=saved.provider_order_id) and (conflicted or kind='dispute'))
      or exists(select 1 from private.production_payment_event_conflicts where account_id=p_account_id
        and (payment_id=p_payment_id or provider_order_id=saved.provider_order_id)),
    refund_hold=refund_hold or p_refund_id is not null or p_provider_refunded_paise>0
      or exists(select 1 from private.production_payment_events where account_id=p_account_id
        and (payment_id=p_payment_id or provider_order_id=saved.provider_order_id) and kind='refund'),
    provider_refunded_paise=greatest(provider_refunded_paise,p_provider_refunded_paise),updated_at=clock_timestamp()
    where id=p_order_id returning * into saved;
  if p_capture_verified then
    select * into existing from private.production_payment_effects where account_id=p_account_id and kind='capture' and provider_id=p_payment_id;
    if (found and (existing.order_id<>p_order_id or existing.amount_paise<>saved.amount_paise))
      or (saved.payment_id is not null and saved.payment_id<>p_payment_id) then
      update private.production_payment_orders set review_required=true where id in (p_order_id,existing.order_id);
    else
      insert into private.production_payment_effects(account_id,kind,provider_id,payment_id,order_id,amount_paise,snapshot_hash)
        values(p_account_id,'capture',p_payment_id,p_payment_id,p_order_id,saved.amount_paise,p_snapshot_hash) on conflict do nothing;
      update private.production_payment_orders set captured_paise=amount_paise,payment_id=p_payment_id where id=p_order_id;
    end if;
  end if;
  if p_refund_id is not null and (saved.payment_id is null or saved.payment_id=p_payment_id) then
    select * into existing from private.production_payment_effects where account_id=p_account_id and kind='refund' and provider_id=p_refund_id;
    if found and (existing.order_id<>p_order_id or existing.payment_id<>p_payment_id or existing.amount_paise<>p_refund_amount_paise or p_refund_status='failed') then
      update private.production_payment_orders set review_required=true where id in (p_order_id,existing.order_id);
    elsif p_refund_status='processed' then
      select coalesce(sum(amount_paise),0) into refund_total from private.production_payment_effects where order_id=p_order_id and kind='refund' and provider_id<>p_refund_id;
      if refund_total+p_refund_amount_paise>saved.amount_paise then
        update private.production_payment_orders set review_required=true where id=p_order_id;
      else
        insert into private.production_payment_effects(account_id,kind,provider_id,payment_id,order_id,amount_paise,snapshot_hash)
          values(p_account_id,'refund',p_refund_id,p_payment_id,p_order_id,p_refund_amount_paise,p_snapshot_hash) on conflict do nothing;
        update private.production_payment_orders set refunded_paise=refund_total+p_refund_amount_paise where id=p_order_id;
      end if;
    end if;
  end if;
  select * into saved from private.production_payment_orders where id=p_order_id;
  return to_jsonb(saved);
end;
$$;

create or replace function public.customer_ad_balance(p_business_id uuid,p_user_id uuid,p_account_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  captured bigint; refunded bigint; service_allocation bigint; advertising bigint; ad_refunded bigint;
  media bigint; tax bigint; reserved bigint; held boolean; cost_held boolean;
begin
  if not exists(select 1 from public.businesses where id=p_business_id and owner_id=p_user_id) then
    raise exception 'Customer owner not found' using errcode='42501';
  end if;
  select coalesce(sum(payment.captured_paise),0),coalesce(sum(payment.refunded_paise),0),
    coalesce(sum(case when payment.captured_paise=payment.amount_paise then (payment.quote->>'serviceAllocationPaise')::bigint else 0 end),0),
    coalesce(sum(case when payment.captured_paise=payment.amount_paise then (payment.quote->>'metaAllocationPaise')::bigint else 0 end),0),
    coalesce(sum(case when payment.refunded_paise=payment.amount_paise then (payment.quote->>'metaAllocationPaise')::bigint else coalesce(allocation.advertising_refunded_paise,0) end),0),
    coalesce(bool_or(payment.review_required or payment.provider_refunded_paise<>payment.refunded_paise
      or (payment.purpose<>'verification' and payment.refunded_paise>0 and payment.refunded_paise<payment.amount_paise
        and coalesce(allocation.service_refunded_paise+allocation.advertising_refunded_paise,-1)<>payment.refunded_paise)
      or (payment.refund_hold and payment.refunded_paise=0)
      or exists(select 1 from private.production_payment_refunds refund where refund.order_id=payment.id and refund.state in ('creating','submitted','needs_reconciliation'))
      or exists(select 1 from private.production_payment_events event where event.account_id=p_account_id
        and (event.payment_id=payment.payment_id or event.provider_order_id=payment.provider_order_id)
        and event.processed_at is null and event.kind in ('refund','dispute'))
      or (payment.captured_paise>0 and not exists(select 1 from private.production_payment_effects effect
        where effect.account_id=p_account_id and effect.order_id=payment.id and effect.kind='capture'
          and effect.payment_id=payment.payment_id and effect.amount_paise=payment.captured_paise))),false)
    into captured,refunded,service_allocation,advertising,ad_refunded,held
    from private.production_payment_orders payment
    left join private.customer_refund_allocations allocation on allocation.order_id=payment.id
    where payment.business_id=p_business_id and payment.user_id=p_user_id and payment.account_id=p_account_id and payment.environment='live';
  select coalesce(sum(cost.media_paise),0),coalesce(sum(cost.tax_paise),0),
    coalesce(bool_or(cost.held or (not cost.finalized and cost.observed_at<clock_timestamp()-interval '15 minutes')),false)
    into media,tax,cost_held from private.customer_ad_costs cost where cost.business_id=p_business_id and cost.account_id=p_account_id;
  select coalesce(sum(greatest(reservation.ceiling_paise-coalesce(cost.media_paise,0)-coalesce(cost.tax_paise,0),0)),0)
    into reserved from private.customer_ad_reservations reservation
    left join private.customer_ad_costs cost on cost.campaign_id=reservation.campaign_id
    where reservation.business_id=p_business_id and reservation.account_id=p_account_id and reservation.state<>'closed';
  held := held or cost_held or media+tax+reserved>advertising-ad_refunded
    or exists(select 1 from private.customer_ad_reservations reservation
      left join private.customer_ad_costs cost on cost.campaign_id=reservation.campaign_id
      where reservation.business_id=p_business_id and reservation.account_id=p_account_id and reservation.state<>'closed'
        and (cost.campaign_id is null or ceil(reservation.daily_budget_paise::numeric*7*(10000+cost.tax_rate_bps)/10000)
          >reservation.ceiling_paise-cost.media_paise-cost.tax_paise))
    or exists(select 1 from public.campaigns campaign where campaign.business_id=p_business_id and campaign.status='active'
      and not exists(select 1 from private.customer_ad_reservations reservation where reservation.campaign_id=campaign.id
        and reservation.account_id=p_account_id and reservation.state<>'closed'));
  return jsonb_build_object('businessId',p_business_id,'currency','INR','capturedPaise',captured,'refundedPaise',refunded,
    'serviceAllocationPaise',service_allocation,'advertisingAllocationPaise',advertising,'advertisingRefundedPaise',ad_refunded,
    'serviceEarnedPaise',coalesce((select sum(allocation.service_earned_paise) from private.customer_refund_allocations allocation
      join private.production_payment_orders payment on payment.id=allocation.order_id where payment.business_id=p_business_id and payment.account_id=p_account_id),0),
    'mediaCostPaise',media,'taxCostPaise',tax,'reservedPaise',reserved,
    'remainingPaise',case when held then 0 else greatest(advertising-ad_refunded-media-tax-reserved,0) end,
    'held',held,'reason',case when held then 'Payment, refund or cost reconciliation is required.' else null end,
    'reservations',coalesce((select jsonb_agg(jsonb_build_object('campaignId',campaign_id,'reservationId',id,'state',state))
      from private.customer_ad_reservations where business_id=p_business_id and account_id=p_account_id),'[]'::jsonb));
end;
$$;

alter table private.customer_refund_allocations drop constraint customer_refund_allocations_service_earned_paise_check;
alter table private.customer_refund_allocations add constraint customer_refund_service_earned_check check(service_earned_paise between 0 and 200000);

create or replace function public.customer_ad_refund_allocation(p_business_id uuid,p_actor_id uuid,p_account_id text,p_order_id uuid,
  p_service_refunded_paise bigint,p_advertising_refunded_paise bigint,p_service_earned_paise bigint,p_evidence_reference uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare payment private.production_payment_orders; previous private.customer_refund_allocations;
  evidence jsonb; saved_evidence private.customer_refund_allocation_evidence;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:'||p_account_id,0));
  if not public.production_payment_operator_allowed(p_actor_id,true) then raise exception 'Financial operator required' using errcode='42501'; end if;
  select * into payment from private.production_payment_orders where id=p_order_id and business_id=p_business_id and account_id=p_account_id and environment='live';
  if not found or not ((payment.captured_paise=payment.amount_paise and p_service_refunded_paise between 0 and (payment.quote->>'serviceAllocationPaise')::bigint
    and p_advertising_refunded_paise between 0 and (payment.quote->>'metaAllocationPaise')::bigint
    and p_service_refunded_paise+p_advertising_refunded_paise=case when payment.purpose='verification' then 0 else payment.refunded_paise end
    and p_service_earned_paise in (0,(payment.quote->>'serviceAllocationPaise')::bigint)
    and p_service_earned_paise+p_service_refunded_paise<=(payment.quote->>'serviceAllocationPaise')::bigint and p_evidence_reference is not null) is true) then
    raise exception 'Refund allocation must match verified payment and delivery evidence' using errcode='23514';
  end if;
  evidence:=jsonb_build_object('serviceRefunded',p_service_refunded_paise,'advertisingRefunded',p_advertising_refunded_paise,'serviceEarned',p_service_earned_paise);
  select * into saved_evidence from private.customer_refund_allocation_evidence where reference=p_evidence_reference;
  if found then
    if saved_evidence.order_id<>p_order_id or saved_evidence.actor_id<>p_actor_id or saved_evidence.input<>evidence then
      raise exception 'Refund allocation evidence conflict' using errcode='23514';
    end if;
    return;
  end if;
  select * into previous from private.customer_refund_allocations where order_id=p_order_id;
  if found and (p_service_refunded_paise<previous.service_refunded_paise or p_advertising_refunded_paise<previous.advertising_refunded_paise
    or p_service_earned_paise<previous.service_earned_paise) then raise exception 'Financial allocations cannot be silently reduced' using errcode='23514'; end if;
  insert into private.customer_refund_allocation_evidence(reference,order_id,actor_id,input) values(p_evidence_reference,p_order_id,p_actor_id,evidence);
  insert into private.customer_refund_allocations(order_id,service_refunded_paise,advertising_refunded_paise,service_earned_paise,evidence_reference,actor_id)
    values(p_order_id,p_service_refunded_paise,p_advertising_refunded_paise,p_service_earned_paise,p_evidence_reference,p_actor_id)
    on conflict(order_id) do update set service_refunded_paise=excluded.service_refunded_paise,advertising_refunded_paise=excluded.advertising_refunded_paise,
      service_earned_paise=excluded.service_earned_paise,evidence_reference=excluded.evidence_reference,actor_id=excluded.actor_id;
end;
$$;

revoke all on function public.production_payment_order_claim(uuid,uuid,uuid,uuid,text,text,jsonb,text,text,uuid),
  public.production_payment_orders_list(uuid,uuid),public.production_payment_observe(uuid,text,text,text,boolean,bigint,boolean,text,text,bigint,text),
  public.customer_ad_refund_allocation(uuid,uuid,text,uuid,bigint,bigint,bigint,uuid) from public,anon,authenticated;
grant execute on function public.production_payment_order_claim(uuid,uuid,uuid,uuid,text,text,jsonb,text,text,uuid),
  public.production_payment_orders_list(uuid,uuid),public.production_payment_observe(uuid,text,text,text,boolean,bigint,boolean,text,text,bigint,text),
  public.customer_ad_refund_allocation(uuid,uuid,text,uuid,bigint,bigint,bigint,uuid) to service_role;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table private.creative_generation_intents
  add column if not exists receipt_version integer not null default 0;
alter table private.creative_generation_intents
  alter column receipt_version set default 1;

create table if not exists private.creative_generation_reconciliations (
  generation_id uuid primary key references private.creative_generation_intents(generation_id) on delete restrict,
  business_id uuid not null,
  user_id uuid not null,
  operator_ref text not null,
  evidence_ref text not null,
  outcome text not null,
  previous_accounted_tokens bigint not null,
  previous_reserved_tokens bigint not null,
  verified_tokens bigint not null,
  adjustment_tokens bigint not null,
  saved_count integer not null,
  reconciled_at timestamptz not null default clock_timestamp()
);
alter table private.creative_generation_reconciliations enable row level security;
revoke all on private.creative_generation_reconciliations from public, anon, authenticated, service_role;

create or replace function private.creative_generation_reconciliation_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from private.creative_generation_reconciliations
    where generation_id=old.generation_id) then
    raise exception 'Reconciled generation is immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
drop trigger if exists creative_generation_reconciliation_guard on private.creative_generation_intents;
create trigger creative_generation_reconciliation_guard before update
  on private.creative_generation_intents for each row
  execute function private.creative_generation_reconciliation_guard();

create or replace function private.creative_generation_settled_write_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_id uuid;
begin
  if tg_op in ('UPDATE','DELETE') then
    if tg_table_name='llm_usage_events' then
      if old.route='creatives.generate' and (old.metadata->>'generationId') ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        target_id:=(old.metadata->>'generationId')::uuid;
      end if;
    else
      target_id:=old.variant_group;
    end if;
    if target_id is not null then
      perform 1 from private.creative_generation_intents
        where generation_id=target_id for share;
      if exists(select 1 from private.creative_generation_reconciliations
        where generation_id=target_id) then
        raise exception 'Reconciled generation cannot change receipts' using errcode='23514';
      end if;
    end if;
    if tg_op='DELETE' then return old; end if;
    target_id:=null;
  end if;
  if tg_table_name='llm_usage_events' then
    if new.route='creatives.generate' and (new.metadata->>'generationId') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      target_id:=(new.metadata->>'generationId')::uuid;
    end if;
  else
    target_id:=new.variant_group;
  end if;
  if target_id is not null then
    perform 1 from private.creative_generation_intents
      where generation_id=target_id for share;
    if exists(select 1 from private.creative_generation_reconciliations
      where generation_id=target_id) then
      raise exception 'Reconciled generation cannot accept late receipts' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists creative_generation_settled_usage_guard on public.llm_usage_events;
create trigger creative_generation_settled_usage_guard before insert or update or delete
  on public.llm_usage_events for each row
  execute function private.creative_generation_settled_write_guard();
drop trigger if exists creative_generation_settled_creative_guard on public.creatives;
create trigger creative_generation_settled_creative_guard before insert or update of business_id, variant_group
  on public.creatives for each row
  execute function private.creative_generation_settled_write_guard();

create or replace function public.creative_generation_status(p_business_id uuid,p_user_id uuid,p_generation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  intent private.creative_generation_intents;
  period_start date := date_trunc('month', timezone('UTC', clock_timestamp()))::date;
begin
  if not exists(select 1 from public.businesses where id=p_business_id and owner_id=p_user_id) then
    return jsonb_build_object('status','unknown');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('creative-id:'||p_generation_id,0));
  select * into intent from private.creative_generation_intents where generation_id=p_generation_id;
  if not found then
    insert into private.creative_generation_intents(generation_id,business_id,user_id,request_hash,expected_count,month_start,reserved_tokens,image_floor_tokens,state)
      values(p_generation_id,p_business_id,p_user_id,repeat('0',64),1,period_start,0,0,'abandoned');
    return jsonb_build_object('status','unknown');
  end if;
  if intent.business_id<>p_business_id or intent.user_id<>p_user_id or intent.state='abandoned' then
    return jsonb_build_object('status','unknown');
  end if;
  return jsonb_build_object('status',case when intent.state in ('processing','partial')
    and intent.updated_at < clock_timestamp()-interval '5 minutes'
    and not exists(select 1 from private.creative_generation_reconciliations where generation_id=p_generation_id)
    then 'unresolved' else intent.state end,'expectedCount',intent.expected_count);
end;
$$;

create or replace function public.creative_generation_progress(
  p_business_id uuid,p_user_id uuid,p_generation_id uuid,p_accounted_tokens bigint default 0,
  p_complete boolean default false,p_uncertain boolean default false,p_failed boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare intent private.creative_generation_intents; saved_count integer;
begin
  if p_accounted_tokens is null or p_accounted_tokens not between 0 and 9007199254740991 then
    raise exception 'Invalid recorded usage' using errcode='22023';
  end if;
  select * into intent from private.creative_generation_intents
    where generation_id=p_generation_id and business_id=p_business_id and user_id=p_user_id for update;
  if not found or not exists(select 1 from public.businesses where id=p_business_id and owner_id=p_user_id) then
    return jsonb_build_object('status','unknown');
  end if;
  if intent.state='abandoned' then return jsonb_build_object('status','unknown'); end if;
  if intent.state in ('complete','failed')
    or exists(select 1 from private.creative_generation_reconciliations where generation_id=p_generation_id) then
    return jsonb_build_object('status',intent.state);
  end if;
  select count(*) into saved_count from public.creatives where business_id=p_business_id and variant_group=p_generation_id;
  update private.creative_generation_intents set
    accounted_tokens=accounted_tokens+p_accounted_tokens,
    reserved_tokens=case when intent.state<>'unresolved' and not p_uncertain and p_complete and saved_count>=intent.expected_count
      then accounted_tokens+p_accounted_tokens+intent.image_floor_tokens
      when intent.state<>'unresolved' and not p_uncertain and p_complete and p_failed and saved_count=0
      then accounted_tokens+p_accounted_tokens
      else greatest(reserved_tokens,accounted_tokens+p_accounted_tokens) end,
    state=case when intent.state='unresolved' or p_uncertain then 'unresolved'
      when p_complete and p_failed and saved_count=0 then 'failed'
      when p_complete and saved_count>=intent.expected_count then 'complete'
      when saved_count>0 then 'partial' else 'processing' end,
    updated_at=clock_timestamp()
    where generation_id=p_generation_id returning * into intent;
  return jsonb_build_object('status',intent.state,'count',saved_count,'expectedCount',intent.expected_count);
end;
$$;

create or replace function public.creative_generation_reconcile(
  p_business_id uuid, p_user_id uuid, p_generation_id uuid,
  p_operator_ref text, p_evidence_ref text, p_outcome text,
  p_verified_tokens bigint, p_expected_accounted bigint, p_expected_reserved bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  intent private.creative_generation_intents;
  saved_count integer;
  recorded_tokens bigint;
  adjustment_tokens bigint;
  final_reserved bigint;
begin
  if p_business_id is null or p_user_id is null or p_generation_id is null
    or p_operator_ref is null or p_operator_ref !~ '^[A-Za-z0-9._:-]{3,100}$'
    or p_evidence_ref is null or p_evidence_ref !~ '^[A-Za-z0-9._:-]{8,200}$'
    or p_outcome is null or p_outcome not in ('failed','partial','complete')
    or p_verified_tokens is null or p_verified_tokens not between 0 and 9007199254740991
    or p_expected_accounted is null or p_expected_accounted not between 0 and 9007199254740991
    or p_expected_reserved is null or p_expected_reserved not between 0 and 9007199254740991 then
    raise exception 'Invalid reconciliation evidence' using errcode='22023';
  end if;
  select * into intent from private.creative_generation_intents
    where generation_id=p_generation_id for update;
  if not found or intent.business_id<>p_business_id or intent.user_id<>p_user_id
    or not exists(select 1 from public.businesses where id=p_business_id and owner_id=p_user_id) then
    raise exception 'Generation is not owned by this tenant' using errcode='42501';
  end if;
  if exists(select 1 from private.creative_generation_reconciliations where generation_id=p_generation_id) then
    raise exception 'Generation already reconciled' using errcode='23505';
  end if;
  if intent.state<>'unresolved' or intent.receipt_version<>1
    or intent.accounted_tokens<>p_expected_accounted or intent.reserved_tokens<>p_expected_reserved then
    raise exception 'Generation is not eligible for reconciliation' using errcode='23514';
  end if;
  select count(*) into saved_count from public.creatives
    where business_id=p_business_id and variant_group=p_generation_id;
  if (p_outcome='failed' and saved_count<>0)
    or (p_outcome='partial' and (saved_count<1 or saved_count>=intent.expected_count))
    or (p_outcome='complete' and saved_count<>intent.expected_count) then
    raise exception 'Reconciliation outcome contradicts saved creatives' using errcode='23514';
  end if;
  select coalesce(sum(total_tokens),0) into recorded_tokens from public.llm_usage_events
    where business_id=p_business_id and user_id=p_user_id and route='creatives.generate'
      and metadata->>'generationId'=p_generation_id::text;
  if p_verified_tokens<greatest(recorded_tokens,intent.accounted_tokens)
    or p_verified_tokens+intent.image_floor_tokens>9007199254740991 then
    raise exception 'Verified usage cannot reduce recorded exposure' using errcode='23514';
  end if;
  adjustment_tokens:=p_verified_tokens-recorded_tokens;
  if adjustment_tokens>0 then
    insert into public.llm_usage_events(business_id,user_id,route,provider,model,
      total_tokens,request_id,status,metadata)
    values(p_business_id,p_user_id,'creatives.generate','operator-attested','reconciliation',
      adjustment_tokens,p_generation_id::text,'error',
      jsonb_build_object('generationId',p_generation_id,'evidenceRef',p_evidence_ref,
        'operatorAdjustment',true,'providerFinalStatus','unknown'));
  end if;
  final_reserved:=p_verified_tokens+case when saved_count>0 then intent.image_floor_tokens else 0 end;
  update private.creative_generation_intents set
    accounted_tokens=p_verified_tokens,reserved_tokens=final_reserved,
    state=p_outcome,updated_at=clock_timestamp()
    where generation_id=p_generation_id;
  insert into private.creative_generation_reconciliations(generation_id,business_id,user_id,
    operator_ref,evidence_ref,outcome,previous_accounted_tokens,previous_reserved_tokens,
    verified_tokens,adjustment_tokens,saved_count)
  values(p_generation_id,p_business_id,p_user_id,p_operator_ref,p_evidence_ref,p_outcome,
    intent.accounted_tokens,intent.reserved_tokens,p_verified_tokens,adjustment_tokens,saved_count);
  return jsonb_build_object('status',p_outcome,'count',saved_count,'verifiedTokens',p_verified_tokens);
end;
$$;

revoke all on function public.creative_generation_reconcile(uuid,uuid,uuid,text,text,text,bigint,bigint,bigint)
  from public, anon, authenticated;
grant execute on function public.creative_generation_reconcile(uuid,uuid,uuid,text,text,text,bigint,bigint,bigint)
  to service_role;
commit;

create table if not exists public.product_event_daily (
  day date not null,
  environment text not null,
  release text not null,
  kind text not null,
  name text not null,
  outcome text not null,
  route text not null,
  action text not null,
  viewport text not null,
  provider text not null,
  model text not null,
  event_count bigint not null check(event_count > 0),
  timed_event_count bigint not null check(timed_event_count >= 0),
  duration_sum_ms bigint not null check(duration_sum_ms >= 0),
  duration_max_ms integer not null check(duration_max_ms >= 0),
  input_tokens numeric not null check(input_tokens >= 0),
  output_tokens numeric not null check(output_tokens >= 0),
  total_tokens numeric not null check(total_tokens >= 0),
  estimated_cost_usd numeric not null check(estimated_cost_usd >= 0),
  item_count numeric not null check(item_count >= 0),
  failed_item_count numeric not null check(failed_item_count >= 0),
  primary key(day,environment,release,kind,name,outcome,route,action,viewport,provider,model)
);

alter table public.product_event_daily enable row level security;
revoke all on public.product_event_daily from public,anon,authenticated,service_role;
grant select on public.product_event_daily to service_role;

create or replace function public.prune_product_events()
returns integer language plpgsql security definer set search_path = '' as $$
declare removed_count integer;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('adbrain:product-event-retention',0)) then return 0; end if;
  with expired as (
    select event_id from public.product_events
    where created_at < now() - interval '90 days'
    order by created_at,event_id limit 10000 for update skip locked
  ), removed as (
    delete from public.product_events event using expired
    where event.event_id=expired.event_id returning event.*
  ), rolled_up as (
    insert into public.product_event_daily as daily
      (day,environment,release,kind,name,outcome,route,action,viewport,provider,model,
       event_count,timed_event_count,duration_sum_ms,duration_max_ms,input_tokens,output_tokens,total_tokens,
       estimated_cost_usd,item_count,failed_item_count)
    select (created_at at time zone 'UTC')::date,
      coalesce(attributes->>'environment','unknown'),coalesce(attributes->>'release',''),kind,name,outcome,
      coalesce(attributes->>'route',''),coalesce(attributes->>'action',''),coalesce(attributes->>'viewport',''),
      coalesce(attributes->>'provider',''),coalesce(attributes->>'model',''),
      count(*),count(duration_ms),coalesce(sum(duration_ms),0),coalesce(max(duration_ms),0),
      sum(case when jsonb_typeof(attributes->'inputTokens')='number' then greatest((attributes->>'inputTokens')::numeric,0) else 0 end),
      sum(case when jsonb_typeof(attributes->'outputTokens')='number' then greatest((attributes->>'outputTokens')::numeric,0) else 0 end),
      sum(case when jsonb_typeof(attributes->'totalTokens')='number' then greatest((attributes->>'totalTokens')::numeric,0) else 0 end),
      sum(case when jsonb_typeof(attributes->'estimatedCostUsd')='number' then greatest((attributes->>'estimatedCostUsd')::numeric,0) else 0 end),
      sum(case when jsonb_typeof(attributes->'count')='number' then greatest((attributes->>'count')::numeric,0) else 0 end),
      sum(case when jsonb_typeof(attributes->'failedCount')='number' then greatest((attributes->>'failedCount')::numeric,0) else 0 end)
    from removed where (created_at at time zone 'UTC')::date >= (now() at time zone 'UTC')::date - 730
    group by 1,2,3,4,5,6,7,8,9,10,11
    on conflict(day,environment,release,kind,name,outcome,route,action,viewport,provider,model) do update set
      event_count=daily.event_count+excluded.event_count,
      timed_event_count=daily.timed_event_count+excluded.timed_event_count,
      duration_sum_ms=daily.duration_sum_ms+excluded.duration_sum_ms,
      duration_max_ms=greatest(daily.duration_max_ms,excluded.duration_max_ms),
      input_tokens=daily.input_tokens+excluded.input_tokens,
      output_tokens=daily.output_tokens+excluded.output_tokens,
      total_tokens=daily.total_tokens+excluded.total_tokens,
      estimated_cost_usd=daily.estimated_cost_usd+excluded.estimated_cost_usd,
      item_count=daily.item_count+excluded.item_count,
      failed_item_count=daily.failed_item_count+excluded.failed_item_count
    returning 1
  ) select count(*) into removed_count from removed;
  delete from public.product_event_daily where ctid in (
    select ctid from public.product_event_daily
    where day < (now() at time zone 'UTC')::date - 730
    order by day limit 10000 for update skip locked
  );
  return removed_count;
end;
$$;

revoke all on function public.prune_product_events() from public,anon,authenticated;
grant execute on function public.prune_product_events() to service_role;

create table if not exists public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  kind text not null check (kind in ('export', 'delete')),
  status text not null default 'received' check (status in ('received', 'in_review', 'completed', 'declined')),
  handled_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists privacy_requests_open_idx on public.privacy_requests(owner_id, kind)
  where status in ('received', 'in_review');
create index if not exists privacy_requests_queue_idx on public.privacy_requests(status, created_at);

alter table public.privacy_requests enable row level security;
revoke all on public.privacy_requests from public, anon, authenticated, service_role;
grant select on public.privacy_requests to authenticated;
grant insert(owner_id, kind) on public.privacy_requests to authenticated;
grant select on public.privacy_requests to service_role;
grant update(status, handled_by, updated_at) on public.privacy_requests to service_role;
drop policy if exists "privacy requests: read own" on public.privacy_requests;
create policy "privacy requests: read own" on public.privacy_requests for select to authenticated
  using (owner_id = auth.uid());
drop policy if exists "privacy requests: submit own" on public.privacy_requests;
create policy "privacy requests: submit own" on public.privacy_requests for insert to authenticated
  with check (owner_id = auth.uid() and status = 'received');

create table if not exists private.privacy_request_operators (
  user_id uuid primary key references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table private.privacy_request_operators enable row level security;
revoke all on private.privacy_request_operators from public, anon, authenticated, service_role;

create or replace function public.privacy_request_operator_allowed(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.privacy_request_operators
    where user_id = p_user_id and revoked_at is null);
$$;
revoke all on function public.privacy_request_operator_allowed(uuid) from public, anon, authenticated;
grant execute on function public.privacy_request_operator_allowed(uuid) to service_role;
