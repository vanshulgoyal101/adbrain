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