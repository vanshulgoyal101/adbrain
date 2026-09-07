-- Meta Instant Connect foundation.
-- Review and apply only after the server token-store cutover and isolated RLS tests.
-- This migration is intentionally not executed by Worker 1.

create schema if not exists private;

create table if not exists private.meta_tokens (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  authorized_by uuid not null references auth.users(id),
  subject_id text not null,
  token_kind text not null check (token_kind in ('user', 'business_system_user', 'page')),
  ciphertext bytea not null,
  nonce bytea not null check (octet_length(nonce) = 12),
  auth_tag bytea not null check (octet_length(auth_tag) = 16),
  key_id text not null,
  format_version text not null default 'v1',
  granted_scopes text[] not null default '{}',
  granted_assets jsonb not null default '[]',
  expires_at timestamptz,
  data_access_expires_at timestamptz,
  validated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, id)
);

create index if not exists meta_tokens_business_idx
  on private.meta_tokens (business_id, revoked_at, expires_at);

create table if not exists public.meta_connections (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  token_id uuid,
  meta_business_id text,
  ad_account_id text,
  page_id text,
  account_name text,
  page_name text,
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  timezone_name text,
  authorization_status text not null default 'disconnected'
    check (authorization_status in ('disconnected', 'connected', 'reauth_required', 'revoked')),
  capabilities jsonb not null default '{}',
  selection_reason text,
  generation bigint not null default 0 check (generation >= 0),
  last_checked_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (business_id, token_id)
    references private.meta_tokens(business_id, id)
);

create table if not exists private.meta_connection_attempts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_id uuid,
  state_hash text not null unique,
  browser_binding_hash text not null,
  status text not null check (status in (
    'authorizing', 'discovering', 'selection_required', 'action_required',
    'connected', 'cancelled', 'expired', 'failed'
  )),
  intent jsonb not null,
  expected_generation bigint not null default 0 check (expected_generation >= 0),
  revision bigint not null default 0 check (revision >= 0),
  discovered_assets jsonb,
  discovery_complete boolean not null default false,
  error_code text,
  claimed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (business_id, token_id)
    references private.meta_tokens(business_id, id)
);

create index if not exists meta_attempts_owner_idx
  on private.meta_connection_attempts (user_id, business_id, expires_at);

alter table private.meta_tokens enable row level security;
alter table private.meta_connection_attempts enable row level security;
alter table public.meta_connections enable row level security;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;
revoke all on private.meta_tokens from public, anon, authenticated, service_role;
revoke all on private.meta_connection_attempts from public, anon, authenticated, service_role;
revoke all on public.meta_connections from public, anon, authenticated;
grant select, insert, update, delete on public.meta_connections to service_role;

-- Keep an existing legacy table available for the controlled backfill, but make
-- it unreadable to browser roles immediately. The backfill tool must run and
-- verify counts before the legacy table is dropped in a later cutover step.
do $$
begin
  if to_regclass('public.meta_credentials') is not null then
    execute 'revoke all on table public.meta_credentials from public, anon, authenticated';
    execute 'grant select on table public.meta_credentials to service_role';
    execute 'drop policy if exists "meta_credentials: all own" on public.meta_credentials';
  end if;
end
$$;

create or replace function public.meta_attempt_discovery_result(
  p_attempt_id uuid, p_discovered_assets jsonb, p_status text, p_error_code text
)
returns boolean language sql security definer set search_path = private, public
as $$ with updated as (
  update private.meta_connection_attempts set status = p_status,
    revision = revision + 1, discovered_assets = p_discovered_assets,
    discovery_complete = coalesce(p_discovered_assets->'complete' = 'true'::jsonb, false), error_code = p_error_code
  where id = p_attempt_id and status = 'discovering'
    and p_status in ('selection_required', 'action_required') returning 1
) select exists(select 1 from updated); $$;

-- Server-only fixed-search-path RPCs and grants are added with the implementation
-- cutover after their SQL bodies have been reviewed against deployed roles.
drop function if exists public.meta_token_insert(uuid, uuid, uuid, text, text, text, text, text, text, text, text[], jsonb, timestamptz, timestamptz);
create or replace function public.meta_token_insert(
  p_id uuid, p_business_id uuid, p_authorized_by uuid, p_subject_id text,
  p_token_kind text, p_ciphertext text, p_nonce text, p_auth_tag text,
  p_key_id text, p_format_version text, p_granted_scopes text[],
  p_granted_assets jsonb, p_expires_at timestamptz, p_validated_at timestamptz,
  p_data_access_expires_at timestamptz default null
)
returns uuid language plpgsql security definer set search_path = private, public
as $$ begin
  insert into private.meta_tokens
    (id, business_id, authorized_by, subject_id, token_kind, ciphertext, nonce,
     auth_tag, key_id, format_version, granted_scopes, granted_assets, expires_at,
    validated_at, data_access_expires_at)
  values (p_id, p_business_id, p_authorized_by, p_subject_id, p_token_kind,
    p_ciphertext::bytea, p_nonce::bytea, p_auth_tag::bytea, p_key_id,
    p_format_version, p_granted_scopes, p_granted_assets, p_expires_at,
    p_validated_at, p_data_access_expires_at);
  return p_id;
end; $$;

drop function if exists public.meta_token_get(uuid, uuid);
create or replace function public.meta_token_get(p_token_id uuid, p_business_id uuid)
returns table (id uuid, business_id uuid, ciphertext bytea, nonce bytea,
  auth_tag bytea, key_id text, format_version text, expires_at timestamptz,
  revoked_at timestamptz, granted_scopes text[], data_access_expires_at timestamptz)
language sql security definer set search_path = private, public
as $$ select id, business_id, ciphertext, nonce, auth_tag, key_id, format_version,
  expires_at, revoked_at, granted_scopes, data_access_expires_at from private.meta_tokens
  where id = p_token_id and business_id = p_business_id; $$;

create or replace function public.meta_token_delete(p_token_id uuid, p_business_id uuid)
returns boolean language sql security definer set search_path = private, public
as $$ with deleted as (
  delete from private.meta_tokens where id = p_token_id and business_id = p_business_id
  returning 1
) select exists(select 1 from deleted); $$;

create or replace function public.meta_attempt_create(
  p_id uuid, p_business_id uuid, p_user_id uuid, p_state_hash text,
  p_browser_binding_hash text, p_status text, p_intent jsonb,
  p_expected_generation bigint, p_expires_at timestamptz
)
returns uuid language plpgsql security definer set search_path = private, public
as $$ begin
  insert into private.meta_connection_attempts
    (id, business_id, user_id, state_hash, browser_binding_hash, status, intent,
     expected_generation, expires_at)
  values (p_id, p_business_id, p_user_id, p_state_hash, p_browser_binding_hash,
    p_status, p_intent, p_expected_generation, p_expires_at);
  return p_id;
end; $$;

create or replace function public.meta_attempt_claim(
  p_state_hash text, p_user_id uuid, p_browser_binding_hash text
)
returns table(attempt_id uuid, business_id uuid, user_id uuid, status text)
language sql security definer set search_path = private, public
as $$ with claimed as (
  update private.meta_connection_attempts set claimed_at = now()
  where state_hash = p_state_hash and user_id = p_user_id
    and browser_binding_hash = p_browser_binding_hash and expires_at > now()
    and claimed_at is null
  returning id, business_id, user_id, status
) select id, business_id, user_id, status from claimed; $$;

create or replace function public.meta_attempt_get(p_attempt_id uuid, p_user_id uuid)
returns table(id uuid, business_id uuid, user_id uuid, token_id uuid, intent jsonb,
  status text, revision bigint, discovered_assets jsonb, discovery_complete boolean,
  error_code text, expires_at timestamptz)
language sql security definer set search_path = private, public
as $$ select id, business_id, user_id, token_id, intent, status, revision,
  discovered_assets, discovery_complete, error_code, expires_at
  from private.meta_connection_attempts where id = p_attempt_id and user_id = p_user_id; $$;

create or replace function public.meta_attempt_set_discovering(
  p_attempt_id uuid, p_retry boolean default false
)
returns boolean language sql security definer set search_path = private, public
as $$ with updated as (
  update private.meta_connection_attempts
  set status = 'discovering', revision = revision + 1, error_code = null
  where id = p_attempt_id and ((p_retry and status in ('failed', 'action_required'))
    or (not p_retry and status = 'authorizing')) returning 1
) select exists(select 1 from updated); $$;

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
as $$ with updated as (
  update private.meta_connection_attempts set token_id = p_token_id
  where id = p_attempt_id and status = 'discovering' and token_id is null returning 1
) select exists(select 1 from updated); $$;

create or replace function public.meta_attempt_action_required(
  p_attempt_id uuid, p_discovered_assets jsonb
)
returns boolean language sql security definer set search_path = private, public
as $$ with updated as (
  update private.meta_connection_attempts set status = 'action_required',
    revision = revision + 1, discovered_assets = p_discovered_assets,
    discovery_complete = coalesce(p_discovered_assets->'complete' = 'true'::jsonb, false), error_code = 'SETUP_REQUIRED'
  where id = p_attempt_id and status = 'discovering' returning 1
) select exists(select 1 from updated); $$;

create or replace function public.meta_attempt_failed(p_attempt_id uuid, p_error_code text)
returns boolean language sql security definer set search_path = private, public
as $$ with updated as (
  update private.meta_connection_attempts set status = 'failed',
    revision = revision + 1, error_code = p_error_code
  where id = p_attempt_id and status <> 'connected' returning 1
) select exists(select 1 from updated); $$;

create or replace function public.meta_attempt_cancelled(p_attempt_id uuid)
returns boolean language sql security definer set search_path = private, public
as $$ with updated as (
  update private.meta_connection_attempts set status = 'cancelled', revision = revision + 1
  where id = p_attempt_id and status = 'authorizing' returning 1
) select exists(select 1 from updated); $$;

create or replace function public.meta_attempt_commit_selection(
  p_attempt_id uuid, p_user_id uuid, p_pair_id text, p_revision bigint,
  p_confirm_replacement boolean
)
returns boolean language plpgsql security definer set search_path = private, public
as $$
declare attempt_row private.meta_connection_attempts%rowtype; candidate jsonb;
  assets jsonb; changed integer;
begin
  select * into attempt_row from private.meta_connection_attempts
  where id = p_attempt_id and user_id = p_user_id for update;
  if not found or attempt_row.revision <> p_revision or not attempt_row.discovery_complete
    or attempt_row.expires_at <= now()
    or attempt_row.token_id is null or attempt_row.status not in ('selection_required', 'action_required') then
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
  select value into candidate from jsonb_array_elements(case when jsonb_typeof(attempt_row.discovered_assets) = 'array'
    then attempt_row.discovered_assets else coalesce(attempt_row.discovered_assets->'candidates', '[]'::jsonb) end) value
  where value->>'pairId' = p_pair_id and value->>'eligible' = 'true' limit 1;
  if candidate is null or (attempt_row.status = 'action_required' and not p_confirm_replacement) then return false; end if;
  assets := candidate->'assets'; if assets is null then return false; end if;
  insert into public.meta_connections
    (business_id, token_id, meta_business_id, ad_account_id, page_id, account_name,
     page_name, currency, timezone_name, authorization_status, capabilities,
     selection_reason, generation, last_checked_at)
  values (attempt_row.business_id, attempt_row.token_id, assets->>'metaBusinessId',
    assets->>'adAccountId', assets->>'pageId', assets->>'accountName', assets->>'pageName',
    assets->>'currency', assets->>'timezoneName', 'connected',
    '{"canReadInsights":{"state":"unknown","blockers":[]},"canReadLeads":{"state":"unknown","blockers":[]},"canCreatePaused":{"state":"unknown","blockers":[]},"canActivate":{"state":"unknown","blockers":[]}}'::jsonb,
    'explicit_selection', attempt_row.expected_generation + 1, now())
  on conflict (business_id) do update set token_id = excluded.token_id,
    meta_business_id = excluded.meta_business_id, ad_account_id = excluded.ad_account_id,
    page_id = excluded.page_id, account_name = excluded.account_name,
    page_name = excluded.page_name, currency = excluded.currency,
    timezone_name = excluded.timezone_name, authorization_status = 'connected',
    capabilities = excluded.capabilities, selection_reason = excluded.selection_reason,
    generation = excluded.generation,
    last_checked_at = excluded.last_checked_at, updated_at = now()
  where meta_connections.generation = attempt_row.expected_generation;
  get diagnostics changed = row_count;
  if changed <> 1 then return false; end if;
  update private.meta_connection_attempts set status = 'connected',
    revision = revision + 1, error_code = null
  where id = p_attempt_id and user_id = p_user_id and revision = p_revision;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Meta connection attempt changed during selection'; end if;
  return true;
end; $$;

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
as $$ declare affected_count integer; begin
  with affected as (select distinct business_id from private.meta_tokens where subject_id = p_subject_id),
  revoked as (update private.meta_tokens set revoked_at = coalesce(revoked_at, now())
    where subject_id = p_subject_id returning business_id)
  update public.meta_connections connection set token_id = null, ad_account_id = null,
    page_id = null, authorization_status = 'revoked',
    generation = connection.generation + 1, updated_at = now()
  where connection.business_id in (select business_id from affected);
  get diagnostics affected_count = row_count; return affected_count;
end; $$;

do $$ declare fn record; begin
  for fn in select p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    and p.proname in ('meta_token_insert', 'meta_token_get', 'meta_token_delete',
      'meta_attempt_create', 'meta_attempt_claim', 'meta_attempt_get',
      'meta_attempt_set_discovering', 'meta_attempt_attach_token',
      'meta_attempt_action_required', 'meta_attempt_failed',
      'meta_attempt_cancelled', 'meta_attempt_discovery_result',
      'meta_attempt_commit_selection', 'meta_revoke_subject') loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn.signature);
    execute format('grant execute on function %s to service_role', fn.signature);
  end loop;
end $$;