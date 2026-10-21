begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #138: a settled partial run (every angle finished and its usage recorded) keeps only the
-- tokens it used plus the image floor of the creatives it saved, instead of the full admission
-- hold. Runs with unknown usage stay unresolved and keep their hold for an operator.
create or replace function public.creative_generation_progress(
  p_business_id uuid,p_user_id uuid,p_generation_id uuid,p_accounted_tokens bigint default 0,
  p_complete boolean default false,p_uncertain boolean default false,p_failed boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare intent private.creative_generation_intents; saved_count integer; settled boolean;
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
  settled := intent.state<>'unresolved' and not p_uncertain and p_complete;
  update private.creative_generation_intents set
    accounted_tokens=accounted_tokens+p_accounted_tokens,
    reserved_tokens=case when settled and saved_count>=intent.expected_count
      then accounted_tokens+p_accounted_tokens+intent.image_floor_tokens
      when settled and p_failed and saved_count=0
      then accounted_tokens+p_accounted_tokens
      when settled and saved_count>0
      then accounted_tokens+p_accounted_tokens
        +(intent.image_floor_tokens*saved_count+intent.expected_count-1)/intent.expected_count
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

revoke all on function public.creative_generation_progress(uuid,uuid,uuid,bigint,boolean,boolean,boolean)
  from public, anon, authenticated;
grant execute on function public.creative_generation_progress(uuid,uuid,uuid,bigint,boolean,boolean,boolean)
  to service_role;
commit;
