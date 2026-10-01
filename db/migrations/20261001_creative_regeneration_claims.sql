begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create schema if not exists private;
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