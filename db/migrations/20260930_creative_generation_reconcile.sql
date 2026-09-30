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