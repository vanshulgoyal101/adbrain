create table if not exists public.meta_billing_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.meta_billing_profiles(id) on delete restrict,
  source_event_id text not null,
  charge_id text not null,
  record jsonb not null,
  source text not null check (source in ('provider_verification', 'operator_review', 'test_fixture')),
  source_reference uuid not null,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  received_at timestamptz not null default clock_timestamp(),
  unique (profile_id, source_event_id)
);
create index if not exists meta_billing_events_charge_idx on public.meta_billing_events(profile_id, charge_id);
alter table public.meta_billing_events enable row level security;
revoke all on public.meta_billing_events from public, anon, authenticated, service_role;
grant select on public.meta_billing_events to service_role;

create table if not exists public.meta_billing_event_conflicts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.meta_billing_events(id) on delete restrict,
  incoming_record jsonb not null check (octet_length(incoming_record::text) <= 2048),
  source text not null check (source in ('provider_verification', 'operator_review', 'test_fixture')),
  source_reference uuid not null,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  received_at timestamptz not null default clock_timestamp(),
  unique (event_id, incoming_record)
);
alter table public.meta_billing_event_conflicts enable row level security;
revoke all on public.meta_billing_event_conflicts from public, anon, authenticated, service_role;
grant select on public.meta_billing_event_conflicts to service_role;

create or replace function public.meta_billing_event_record(
  p_business_id uuid, p_environment text, p_record jsonb,
  p_actor_id uuid, p_source text, p_source_reference uuid
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  profile public.meta_billing_profiles;
  existing public.meta_billing_events;
  occurred_at timestamptz;
begin
  if p_record is null or not ((
    jsonb_typeof(p_record) = 'object' and octet_length(p_record::text) <= 2048
    and p_record ?& array['version','businessId','environment','accountId','sourceEventId','chargeId',
      'status','amountPaise','taxPaise','currency','occurredAt','payloadHash']
    and p_record - array['version','businessId','environment','accountId','sourceEventId','chargeId',
      'status','amountPaise','taxPaise','currency','occurredAt','payloadHash'] = '{}'::jsonb
    and p_record->'version' = '1'::jsonb
    and p_record->>'businessId' = p_business_id::text and p_record->>'environment' = p_environment
    and p_record->>'accountId' ~ '^act_[0-9]{1,32}$'
    and jsonb_typeof(p_record->'sourceEventId') = 'string'
    and p_record->>'sourceEventId' ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    and jsonb_typeof(p_record->'chargeId') = 'string'
    and p_record->>'chargeId' ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    and p_record->>'status' in ('pending','succeeded','failed','reversed')
    and p_record->>'currency' = 'INR'
    and jsonb_typeof(p_record->'amountPaise') = 'number'
    and p_record->>'amountPaise' ~ '^[0-9]+$'
    and (p_record->>'amountPaise')::numeric between 1 and 9007199254740991
    and (p_record->'taxPaise' = 'null'::jsonb or (
      jsonb_typeof(p_record->'taxPaise') = 'number' and p_record->>'taxPaise' ~ '^[0-9]+$'
      and (p_record->>'taxPaise')::numeric between 0 and (p_record->>'amountPaise')::numeric))
    and jsonb_typeof(p_record->'payloadHash') = 'string'
    and p_record->>'payloadHash' ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(p_record->'occurredAt') = 'string'
    and p_record->>'occurredAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
    and p_source in ('provider_verification','operator_review','test_fixture')
    and (p_source <> 'test_fixture' or p_environment = 'test')
  ) is true) then
    raise exception 'Invalid Meta billing observation' using errcode = '23514';
  end if;
  occurred_at := (p_record->>'occurredAt')::timestamptz;
  if not isfinite(occurred_at) or occurred_at > clock_timestamp() then
    raise exception 'Invalid observation time' using errcode = '23514';
  end if;
  select * into profile from public.meta_billing_profiles
    where business_id = p_business_id and environment = p_environment for update;
  if not found or profile.ad_account_id is distinct from p_record->>'accountId' then
    raise exception 'Billing profile does not match observation' using errcode = '23514';
  end if;
  select * into existing from public.meta_billing_events
    where profile_id = profile.id and source_event_id = p_record->>'sourceEventId';
  if found then
    if existing.record = p_record then return 'duplicate'; end if;
    insert into public.meta_billing_event_conflicts(event_id,incoming_record,source,source_reference,recorded_by)
      values (existing.id,p_record,p_source,p_source_reference,p_actor_id) on conflict do nothing;
    return 'conflict';
  end if;
  insert into public.meta_billing_events(profile_id,source_event_id,charge_id,record,source,source_reference,recorded_by)
    values (profile.id,p_record->>'sourceEventId',p_record->>'chargeId',p_record,p_source,p_source_reference,p_actor_id);
  return 'recorded';
end;
$$;
revoke all on function public.meta_billing_event_record(uuid,text,jsonb,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.meta_billing_event_record(uuid,text,jsonb,uuid,text,uuid) to service_role;

create or replace function public.meta_billing_charge_observations(p_business_id uuid, p_environment text, p_charge_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'events', coalesce((select jsonb_agg(observation.record) from (
      select event.record from public.meta_billing_events event
      join public.meta_billing_profiles profile on profile.id = event.profile_id
      where profile.business_id = p_business_id and profile.environment = p_environment and event.charge_id = p_charge_id
      order by event.received_at, event.id limit 1001
    ) observation), '[]'::jsonb),
    'hasConflicts', exists (
      select 1 from public.meta_billing_event_conflicts conflict
      join public.meta_billing_events event on event.id = conflict.event_id
      join public.meta_billing_profiles profile on profile.id = event.profile_id
      where profile.business_id = p_business_id and profile.environment = p_environment
        and (event.charge_id = p_charge_id or conflict.incoming_record->>'chargeId' = p_charge_id)
    )
  );
$$;
revoke all on function public.meta_billing_charge_observations(uuid,text,text) from public, anon, authenticated;
grant execute on function public.meta_billing_charge_observations(uuid,text,text) to service_role;