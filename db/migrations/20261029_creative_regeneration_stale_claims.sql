begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #2219: a Regenerate or Change background killed past maxDuration (300 s) or by a deploy never settles its claim,
-- and the ad answered "already being changed" forever. A `processing` claim untouched for 15 minutes (300 s plus a
-- 10-minute margin) belongs to a dead request, so a new attempt takes it over. Its old attempt id no longer matches,
-- so a late finish from it gets 'missing'. `unresolved` claims (an unknown paid charge) are never taken over.
create or replace function public.creative_regeneration_claim(
  p_creative_id uuid, p_business_id uuid, p_user_id uuid, p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare previous_state text; previous_at timestamptz;
begin
  if p_creative_id is null or p_business_id is null or p_user_id is null or p_attempt_id is null then
    raise exception 'Invalid regeneration claim' using errcode='22023';
  end if;
  if not exists(select 1 from public.creatives c join public.businesses b on b.id=c.business_id
    where c.id=p_creative_id and c.business_id=p_business_id and b.owner_id=p_user_id) then
    return jsonb_build_object('action','missing');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('creative-regenerate:'||p_creative_id,0));
  select state,updated_at into previous_state,previous_at from private.creative_regeneration_claims where creative_id=p_creative_id;
  if found then
    if previous_state='processing' and previous_at < pg_catalog.clock_timestamp() - interval '15 minutes' then
      update private.creative_regeneration_claims
        set business_id=p_business_id,user_id=p_user_id,attempt_id=p_attempt_id,
            created_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
        where creative_id=p_creative_id;
      return jsonb_build_object('action','start','tookOver',true);
    end if;
    return jsonb_build_object('action','busy','status',previous_state);
  end if;
  insert into private.creative_regeneration_claims(creative_id,business_id,user_id,attempt_id)
    values(p_creative_id,p_business_id,p_user_id,p_attempt_id);
  return jsonb_build_object('action','start');
end;
$$;

revoke all on function public.creative_regeneration_claim(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.creative_regeneration_claim(uuid,uuid,uuid,uuid) to service_role;
commit;
