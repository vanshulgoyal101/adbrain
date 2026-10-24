begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #519 (2-Tier, #518): one row per AdBrain business whose Meta child business and ad account
-- AdBrain provisions under Solaride. Meta object IDs and state only: never tokens. Owners read
-- their own row; only the service role writes. A trigger enforces the state machine and keeps a
-- tenant's child business and ad account from ever being re-pointed. A business with a managed
-- account can't be deleted until it is offboarded (its ad account could still spend).
create table if not exists public.managed_meta_accounts (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  state text not null default 'requested' check (state in (
    'requested', 'page_linked', 'child_created', 'ad_account_created', 'funded',
    'whatsapp_linked', 'ready', 'failed', 'offboarding', 'offboarded')),
  page_id text check (page_id ~ '^[0-9]{1,24}$'),
  child_business_id text unique check (child_business_id ~ '^[0-9]{1,24}$'),
  ad_account_id text unique check (ad_account_id ~ '^act_[0-9]{1,24}$'),
  waba_id text check (waba_id ~ '^[0-9]{1,24}$'),
  phone_number_id text check (phone_number_id ~ '^[0-9]{1,24}$'),
  funding_state text not null default 'none' check (funding_state in ('none', 'card_attached', 'invoiced', 'failed')),
  -- One idempotency key per provisioning step, e.g. {"child_business": "..."}; never reused across tenants.
  step_keys jsonb not null default '{}'::jsonb check (jsonb_typeof(step_keys) = 'object' and octet_length(step_keys::text) <= 2048),
  last_error text check (last_error ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (state not in ('page_linked', 'child_created', 'ad_account_created', 'funded', 'whatsapp_linked', 'ready') or page_id is not null),
  check (state not in ('child_created', 'ad_account_created', 'funded', 'whatsapp_linked', 'ready') or child_business_id is not null),
  check (state not in ('ad_account_created', 'funded', 'whatsapp_linked', 'ready') or ad_account_id is not null),
  check (state not in ('funded', 'whatsapp_linked', 'ready') or funding_state in ('card_attached', 'invoiced')),
  check (state <> 'whatsapp_linked' or (waba_id is not null and phone_number_id is not null))
);

create or replace function public.managed_meta_account_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed text[];
begin
  if old.child_business_id is not null and new.child_business_id is distinct from old.child_business_id then
    raise exception 'managed account child business is fixed once set' using errcode = '23514';
  end if;
  if old.ad_account_id is not null and new.ad_account_id is distinct from old.ad_account_id then
    raise exception 'managed account ad account is fixed once set' using errcode = '23514';
  end if;
  if new.state <> old.state then
    allowed := case old.state
      when 'requested' then array['page_linked', 'failed', 'offboarding']
      when 'page_linked' then array['child_created', 'failed', 'offboarding']
      when 'child_created' then array['ad_account_created', 'failed', 'offboarding']
      when 'ad_account_created' then array['funded', 'failed', 'offboarding']
      when 'funded' then array['whatsapp_linked', 'ready', 'failed', 'offboarding']
      when 'whatsapp_linked' then array['ready', 'failed', 'offboarding']
      when 'ready' then array['whatsapp_linked', 'failed', 'offboarding']
      -- A failed step resumes where the stored IDs allow (the row checks above enforce that).
      when 'failed' then array['requested', 'page_linked', 'child_created', 'ad_account_created', 'funded', 'whatsapp_linked', 'ready', 'offboarding']
      when 'offboarding' then array['offboarded', 'failed']
      else array[]::text[]
    end;
    if not new.state = any(allowed) then
      raise exception 'managed account cannot move from % to %', old.state, new.state using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.managed_meta_account_guard() from public, anon, authenticated;

drop trigger if exists managed_meta_accounts_guard on public.managed_meta_accounts;
create trigger managed_meta_accounts_guard
  before update on public.managed_meta_accounts
  for each row execute function public.managed_meta_account_guard();

alter table public.managed_meta_accounts enable row level security;
revoke all on public.managed_meta_accounts from public, anon, authenticated, service_role;
grant select on public.managed_meta_accounts to authenticated;
grant select, insert, update on public.managed_meta_accounts to service_role;
drop policy if exists "managed meta accounts: read own" on public.managed_meta_accounts;
create policy "managed meta accounts: read own" on public.managed_meta_accounts
  for select to authenticated using (public.owns_business(business_id));

-- Append-only log of every provisioning step (request id, Meta object id, outcome).
create table if not exists public.managed_meta_account_events (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.managed_meta_accounts(business_id) on delete restrict,
  step text not null check (step in ('page', 'child_business', 'ad_account', 'funding', 'whatsapp', 'offboard')),
  outcome text not null check (outcome in ('started', 'succeeded', 'failed', 'reconciled')),
  request_id uuid,
  idempotency_key text check (length(idempotency_key) between 8 and 200),
  meta_object_id text check (meta_object_id ~ '^(act_)?[0-9]{1,24}$'),
  error_code text check (error_code ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  created_at timestamptz not null default now()
);
create index if not exists managed_meta_account_events_business_idx
  on public.managed_meta_account_events(business_id, created_at desc);

create or replace function public.managed_meta_account_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'managed account events are append-only' using errcode = '42501';
end;
$$;
revoke all on function public.managed_meta_account_events_append_only() from public, anon, authenticated;

drop trigger if exists managed_meta_account_events_append_only on public.managed_meta_account_events;
create trigger managed_meta_account_events_append_only
  before update or delete on public.managed_meta_account_events
  for each row execute function public.managed_meta_account_events_append_only();

alter table public.managed_meta_account_events enable row level security;
revoke all on public.managed_meta_account_events from public, anon, authenticated, service_role;
grant select on public.managed_meta_account_events to authenticated;
grant select, insert on public.managed_meta_account_events to service_role;
drop policy if exists "managed meta account events: read own" on public.managed_meta_account_events;
create policy "managed meta account events: read own" on public.managed_meta_account_events
  for select to authenticated using (public.owns_business(business_id));

commit;
