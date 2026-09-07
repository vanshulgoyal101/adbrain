-- Worker 2 campaign persistence delta for Meta Instant Connect v1.
-- Worker 1 must consolidate this migration with the connection migration and
-- generated/manual database types before any runtime route is enabled.

create table if not exists public.campaign_drafts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  version bigint not null default 1 check (version >= 1),
  input jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists campaign_drafts_business_id_idx
  on public.campaign_drafts(business_id, id);

create index if not exists campaign_drafts_owner_idx
  on public.campaign_drafts(owner_id, business_id, updated_at desc);

alter table public.campaign_drafts enable row level security;
drop policy if exists "campaign drafts: own business" on public.campaign_drafts;
create policy "campaign drafts: own business"
  on public.campaign_drafts for all
  using (public.owns_business(business_id))
  with check (public.owns_business(business_id) and owner_id = auth.uid());

create table if not exists public.campaign_operations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  draft_id uuid not null references public.campaign_drafts(id) on delete restrict,
  campaign_id uuid references public.campaigns(id) on delete set null,
  draft_version bigint not null check (draft_version >= 1),
  connection_generation bigint not null check (connection_generation >= 0),
  kind text not null check (kind in ('campaign_create')),
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  request_hash text not null check (length(request_hash) = 64),
  state text not null check (state in ('pending', 'running', 'succeeded', 'failed', 'needs_reconciliation')),
  phase text not null check (phase in ('campaign', 'adset', 'creative', 'ad', 'reconcile', 'complete')),
  lease_until timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  payload jsonb not null default '{}',
  result jsonb,
  external_ids jsonb not null default '[]',
  sanitized_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, kind, idempotency_key),
  unique (business_id, id, draft_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'campaign_operations_draft_business_fk'
      and conrelid = 'public.campaign_operations'::regclass
  ) then
    alter table public.campaign_operations
      add constraint campaign_operations_draft_business_fk
      foreign key (business_id, draft_id)
      references public.campaign_drafts(business_id, id)
      on delete restrict;
  end if;
end
$$;

create index if not exists campaign_operations_lease_idx
  on public.campaign_operations(state, lease_until);
create index if not exists campaign_operations_owner_idx
  on public.campaign_operations(business_id, created_at desc);

alter table public.campaign_operations enable row level security;
drop policy if exists "campaign operations: own business" on public.campaign_operations;
create policy "campaign operations: own business"
  on public.campaign_operations for select to authenticated
  using (public.owns_business(business_id));
revoke all on public.campaign_operations from public, anon, authenticated;
grant select on public.campaign_operations to authenticated;
grant select, insert, update, delete on public.campaign_operations to service_role;

alter table public.campaigns add column if not exists meta_ad_account_id text;
alter table public.campaigns add column if not exists meta_page_id text;
alter table public.campaigns add column if not exists meta_connection_generation bigint;

create index if not exists campaigns_binding_idx
  on public.campaigns(business_id, meta_ad_account_id, meta_page_id);

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
  set input = p_input,
      version = version + 1,
      updated_at = p_now
  where id = p_draft_id
    and business_id = p_business_id
    and owner_id = p_owner_id
    and version = p_expected_version
    and expires_at > p_now
  returning *;
$$;

revoke execute on function public.update_campaign_draft_if_version(uuid, uuid, uuid, bigint, jsonb, timestamptz) from public;
grant execute on function public.update_campaign_draft_if_version(uuid, uuid, uuid, bigint, jsonb, timestamptz) to authenticated;

create or replace function public.claim_campaign_operation(
  p_operation_id uuid,
  p_business_id uuid,
  p_draft_id uuid,
  p_draft_version bigint,
  p_connection_generation bigint,
  p_kind text,
  p_idempotency_key text,
  p_request_hash text,
  p_lease_until timestamptz,
  p_payload jsonb default '{}'::jsonb,
  p_now timestamptz default now()
)
returns setof public.campaign_operations
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_operation public.campaign_operations;
begin
  perform pg_advisory_xact_lock(hashtextextended(json_build_array(p_business_id, p_kind, p_idempotency_key)::text, 0));
  perform 1 from public.meta_connections
  where business_id = p_business_id and generation = p_connection_generation
    and authorization_status = 'connected' for share;
  if not found or p_lease_until <= now() then return; end if;
  select * into current_operation
  from public.campaign_operations
  where business_id = p_business_id
    and kind = p_kind
    and idempotency_key = p_idempotency_key
  for update;

  if not found then
    insert into public.campaign_operations (
      id,
      business_id,
      draft_id,
      draft_version,
      connection_generation,
      kind,
      idempotency_key,
      request_hash,
      state,
      phase,
      lease_until,
      attempt_count,
      payload
    ) values (
      p_operation_id,
      p_business_id,
      p_draft_id,
      p_draft_version,
      p_connection_generation,
      p_kind,
      p_idempotency_key,
      p_request_hash,
      'running',
      'campaign',
      p_lease_until,
      1,
      p_payload
    )
    returning * into current_operation;
  elsif current_operation.request_hash = p_request_hash
    and current_operation.connection_generation = p_connection_generation
    and current_operation.state in ('pending', 'running')
    and (current_operation.lease_until is null or current_operation.lease_until <= now()) then
    update public.campaign_operations
    set state = 'needs_reconciliation',
        phase = 'reconcile',
        lease_until = null,
        sanitized_error = 'Operation expired with an unverified external outcome.',
        updated_at = now()
    where id = current_operation.id
    returning * into current_operation;
  elsif current_operation.state in ('pending', 'running') then
    return;
  end if;

  return next current_operation;
end
$$;

create or replace function public.checkpoint_campaign_operation(
  p_operation_id uuid,
  p_business_id uuid,
  p_connection_generation bigint,
  p_phase text,
  p_lease_until timestamptz,
  p_external_ids jsonb,
  p_campaign_id uuid default null,
  p_now timestamptz default now()
)
returns setof public.campaign_operations
language sql
security invoker
set search_path = public
as $$
  update public.campaign_operations
  set phase = p_phase,
      lease_until = p_lease_until,
      external_ids = p_external_ids,
      campaign_id = coalesce(p_campaign_id, campaign_id),
      updated_at = p_now
  where id = p_operation_id
    and business_id = p_business_id
    and connection_generation = p_connection_generation
    and state = 'running'
    and lease_until > now()
    and exists (select 1 from public.meta_connections connection
      where connection.business_id = p_business_id and connection.generation = p_connection_generation
        and connection.authorization_status = 'connected')
  returning *;
$$;

create or replace function public.finish_campaign_operation(
  p_operation_id uuid,
  p_business_id uuid,
  p_connection_generation bigint,
  p_campaign_id uuid,
  p_result jsonb,
  p_now timestamptz default now()
)
returns setof public.campaign_operations
language sql
security invoker
set search_path = public
as $$
  update public.campaign_operations
  set state = 'succeeded',
      phase = 'complete',
      lease_until = null,
      campaign_id = p_campaign_id,
      result = p_result,
      sanitized_error = null,
      updated_at = p_now
  where id = p_operation_id
    and business_id = p_business_id
    and connection_generation = p_connection_generation
    and state = 'running'
    and lease_until > now()
    and exists (select 1 from public.meta_connections connection
      where connection.business_id = p_business_id and connection.generation = p_connection_generation
        and connection.authorization_status = 'connected')
  returning *;
$$;

revoke execute on function public.claim_campaign_operation(uuid, uuid, uuid, bigint, bigint, text, text, text, timestamptz, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.checkpoint_campaign_operation(uuid, uuid, bigint, text, timestamptz, jsonb, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.finish_campaign_operation(uuid, uuid, bigint, uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_campaign_operation(uuid, uuid, uuid, bigint, bigint, text, text, text, timestamptz, jsonb, timestamptz) to service_role;
grant execute on function public.checkpoint_campaign_operation(uuid, uuid, bigint, text, timestamptz, jsonb, uuid, timestamptz) to service_role;
grant execute on function public.finish_campaign_operation(uuid, uuid, bigint, uuid, jsonb, timestamptz) to service_role;