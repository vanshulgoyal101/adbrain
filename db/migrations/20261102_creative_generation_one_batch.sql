-- #1402: a second device (or tab) that starts a Create batch while another is still running with no ad saved yet gets
-- that batch's id back ('running') and follows it, instead of paying for a second one. Once an ad is saved the page
-- already finds the batch (#1425); a batch silent for 5 minutes is stale. The check runs before the quota check (a tight
-- allowance must still follow the batch) under a per-business lock with no month in its key, so two simultaneous starts,
-- even across a UTC month change, cannot both pass it.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.creative_generation_admit(
  p_business_id uuid, p_user_id uuid, p_generation_id uuid, p_request_hash text,
  p_expected_count integer, p_reserved_tokens bigint, p_image_floor_tokens bigint, p_monthly_limit bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  intent private.creative_generation_intents;
  period_start date := date_trunc('month', timezone('UTC', clock_timestamp()))::date;
  used_tokens numeric;
  outstanding_tokens numeric;
  running private.creative_generation_intents;
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
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('creative-batch:'||p_business_id,0));
  select * into running from private.creative_generation_intents
    where business_id=p_business_id and state='processing' and updated_at >= clock_timestamp()-interval '5 minutes'
    order by created_at desc limit 1;
  if found then
    return jsonb_build_object('action','running','generationId',running.generation_id,'status',running.state,'expectedCount',running.expected_count);
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

revoke all on function public.creative_generation_admit(uuid,uuid,uuid,text,integer,bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.creative_generation_admit(uuid,uuid,uuid,text,integer,bigint,bigint,bigint) to service_role;
commit;
