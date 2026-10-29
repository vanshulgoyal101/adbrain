begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #1799: Meta refuses a campaign spend_cap under the ad account's min_campaign_group_spend_cap (₹5,000 for INR).
-- An uncapped managed run sets its campaign spend_cap to the reservation's media limit, so the reservation itself
-- takes Meta's live minimum and refuses atomically, before anything is held. Capped runs (a Meta lifetime budget,
-- no campaign spend_cap) ignore it. Callers that omit the new argument behave exactly as before.
drop function if exists public.customer_ad_reserve(uuid,uuid,text,uuid,text,bigint,bigint,text,boolean,bigint);
create or replace function public.customer_ad_reserve(p_business_id uuid,p_user_id uuid,p_account_id text,
  p_campaign_id uuid,p_ad_account_id text,p_connection_generation bigint,p_daily_budget_paise bigint,p_request_key text,p_review_only boolean default false,
  p_lifetime_cap_paise bigint default null,p_min_media_limit_paise bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  campaign public.campaigns;
  cost private.customer_ad_costs;
  reservation private.customer_ad_reservations;
  balance jsonb;
  available bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:'||p_account_id,0));
  balance := public.customer_ad_balance(p_business_id,p_user_id,p_account_id);
  select * into campaign from public.campaigns where id=p_campaign_id and business_id=p_business_id for update;
  if not found or not ((campaign.meta_campaign_id is not null and campaign.meta_campaign_id<>''
    and campaign.meta_ad_account_id=p_ad_account_id and campaign.meta_connection_generation=p_connection_generation
    and campaign.daily_budget*100=p_daily_budget_paise and p_daily_budget_paise>0 and p_request_key ~ '^[a-f0-9]{64}$'
    and (p_lifetime_cap_paise is null or p_lifetime_cap_paise between 1 and 9007199254740991)
    and (p_min_media_limit_paise is null or p_min_media_limit_paise between 1 and 9007199254740991)
    and exists(select 1 from public.meta_connections where business_id=p_business_id and authorization_status='connected'
      and ad_account_id=p_ad_account_id and generation=p_connection_generation)) is true) then
    raise exception 'Campaign customer binding changed' using errcode='23514';
  end if;
  select * into cost from private.customer_ad_costs where campaign_id=p_campaign_id;
  if not found or not ((cost.business_id=p_business_id and cost.account_id=p_account_id and cost.ad_account_id=p_ad_account_id
    and cost.connection_generation=p_connection_generation and not cost.held
    and cost.observed_at>=clock_timestamp()-interval '15 minutes' and not (balance->>'held')::boolean) is true) then
    raise exception 'Current attributed media and tax evidence required' using errcode='23514';
  end if;
  select * into reservation from private.customer_ad_reservations where campaign_id=p_campaign_id;
  if found and reservation.state not in ('paused','closed') then
    raise exception 'Existing activation must be reconciled before another attempt' using errcode='23514';
  end if;
  available := (balance->>'remainingPaise')::bigint;
  if reservation.state='paused' then available:=available+greatest(reservation.ceiling_paise-cost.media_paise-cost.tax_paise,0); end if;
  if available<ceil(coalesce(p_lifetime_cap_paise,p_daily_budget_paise*7)::numeric*(10000+cost.tax_rate_bps)/10000) then
    raise exception 'Insufficient customer advertising allowance' using errcode='23514';
  end if;
  -- #1799: an uncapped run's campaign spend_cap is this media limit, and Meta refuses one under the account's minimum.
  -- Refuse here, before the insert, so a refused activation never leaves an in-flight reservation holding the balance.
  if p_lifetime_cap_paise is null and p_min_media_limit_paise is not null
    and cost.media_paise+floor(available::numeric*10000/(10000+cost.tax_rate_bps))<p_min_media_limit_paise then
    raise exception 'Below the Meta campaign spend cap minimum' using errcode='23514';
  end if;
  if p_review_only then return jsonb_build_object('reservationId',p_campaign_id,'mediaLimitPaise',cost.media_paise+floor(available::numeric*10000/(10000+cost.tax_rate_bps)),'balance',balance); end if;
  insert into private.customer_ad_reservations(campaign_id,business_id,account_id,ad_account_id,connection_generation,meta_campaign_id,request_key,ceiling_paise,daily_budget_paise,media_limit_paise,state,bounded_media_paise)
    values(p_campaign_id,p_business_id,p_account_id,p_ad_account_id,p_connection_generation,campaign.meta_campaign_id,p_request_key,available+cost.media_paise+cost.tax_paise,p_daily_budget_paise,
      cost.media_paise+floor(available::numeric*10000/(10000+cost.tax_rate_bps)),'uncertain',cost.media_paise+p_lifetime_cap_paise)
    on conflict(campaign_id) do update set id=gen_random_uuid(),request_key=excluded.request_key,ceiling_paise=excluded.ceiling_paise,
      daily_budget_paise=excluded.daily_budget_paise,media_limit_paise=excluded.media_limit_paise,state='uncertain',activation_in_flight=true,
      bounded_media_paise=excluded.bounded_media_paise,updated_at=clock_timestamp()
    returning * into reservation;
  update private.customer_ad_costs set finalized=false where campaign_id=p_campaign_id;
  return jsonb_build_object('reservationId',reservation.id,'mediaLimitPaise',reservation.media_limit_paise,'balance',public.customer_ad_balance(p_business_id,p_user_id,p_account_id));
end;
$$;

revoke all on function public.customer_ad_reserve(uuid,uuid,text,uuid,text,bigint,bigint,text,boolean,bigint,bigint) from public,anon,authenticated;
grant execute on function public.customer_ad_reserve(uuid,uuid,text,uuid,text,bigint,bigint,text,boolean,bigint,bigint) to service_role;
commit;
