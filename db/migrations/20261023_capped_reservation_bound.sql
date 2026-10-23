begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #208: a capped run's Meta lifetime budget bounds its spend. A capped reservation needs the cap
-- plus GST instead of seven daily budgets, and stores attributed media plus the cap as its bound.
-- While it is open, stale non-final cost evidence within the bound does not hold the balance and
-- headroom is checked against the bound. Evidence above the bound, explicit cost holds and every
-- payment hold still apply; uncapped reservations are unchanged.
alter table private.customer_ad_reservations
  add column if not exists bounded_media_paise bigint check (bounded_media_paise between 1 and 9007199254740991);

create or replace function public.customer_ad_balance(p_business_id uuid,p_user_id uuid,p_account_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  captured bigint; refunded bigint; service_allocation bigint; advertising bigint; ad_refunded bigint;
  media bigint; tax bigint; reserved bigint; held boolean; cost_held boolean;
begin
  if not exists(select 1 from public.businesses where id=p_business_id and owner_id=p_user_id) then
    raise exception 'Customer owner not found' using errcode='42501';
  end if;
  select coalesce(sum(payment.captured_paise),0),coalesce(sum(payment.refunded_paise),0),
    coalesce(sum(case when payment.captured_paise=payment.amount_paise then (payment.quote->>'serviceAllocationPaise')::bigint else 0 end),0),
    coalesce(sum(case when payment.captured_paise=payment.amount_paise then (payment.quote->>'metaAllocationPaise')::bigint else 0 end),0),
    coalesce(sum(case when payment.refunded_paise=payment.amount_paise then (payment.quote->>'metaAllocationPaise')::bigint else coalesce(allocation.advertising_refunded_paise,0) end),0),
    coalesce(bool_or(payment.review_required or payment.provider_refunded_paise<>payment.refunded_paise
      or (payment.purpose<>'verification' and payment.refunded_paise>0 and payment.refunded_paise<payment.amount_paise
        and coalesce(allocation.service_refunded_paise+allocation.advertising_refunded_paise,-1)<>payment.refunded_paise)
      or (payment.refund_hold and payment.refunded_paise=0)
      or exists(select 1 from private.production_payment_refunds refund where refund.order_id=payment.id and refund.state in ('creating','submitted','needs_reconciliation'))
      or exists(select 1 from private.production_payment_events event where event.account_id=p_account_id
        and (event.payment_id=payment.payment_id or event.provider_order_id=payment.provider_order_id)
        and event.processed_at is null and event.kind in ('refund','dispute'))
      or (payment.captured_paise>0 and not exists(select 1 from private.production_payment_effects effect
        where effect.account_id=p_account_id and effect.order_id=payment.id and effect.kind='capture'
          and effect.payment_id=payment.payment_id and effect.amount_paise=payment.captured_paise))),false)
    into captured,refunded,service_allocation,advertising,ad_refunded,held
    from private.production_payment_orders payment
    left join private.customer_refund_allocations allocation on allocation.order_id=payment.id
    where payment.business_id=p_business_id and payment.user_id=p_user_id and payment.account_id=p_account_id and payment.environment='live';
  select coalesce(sum(cost.media_paise),0),coalesce(sum(cost.tax_paise),0),
    coalesce(bool_or(cost.held or (not cost.finalized and cost.observed_at<clock_timestamp()-interval '15 minutes'
      and not exists(select 1 from private.customer_ad_reservations reservation
        where reservation.campaign_id=cost.campaign_id and reservation.account_id=p_account_id
          and reservation.state<>'closed' and reservation.bounded_media_paise>=cost.media_paise))),false)
    into media,tax,cost_held from private.customer_ad_costs cost where cost.business_id=p_business_id and cost.account_id=p_account_id;
  select coalesce(sum(greatest(reservation.ceiling_paise-coalesce(cost.media_paise,0)-coalesce(cost.tax_paise,0),0)),0)
    into reserved from private.customer_ad_reservations reservation
    left join private.customer_ad_costs cost on cost.campaign_id=reservation.campaign_id
    where reservation.business_id=p_business_id and reservation.account_id=p_account_id and reservation.state<>'closed';
  held := held or cost_held or media+tax+reserved>advertising-ad_refunded
    or exists(select 1 from private.customer_ad_reservations reservation
      left join private.customer_ad_costs cost on cost.campaign_id=reservation.campaign_id
      where reservation.business_id=p_business_id and reservation.account_id=p_account_id and reservation.state<>'closed'
        and (cost.campaign_id is null or case when reservation.bounded_media_paise is not null
          then cost.media_paise>reservation.bounded_media_paise
            or ceil((reservation.bounded_media_paise-cost.media_paise)::numeric*(10000+cost.tax_rate_bps)/10000)
              >reservation.ceiling_paise-cost.media_paise-cost.tax_paise
          else ceil(reservation.daily_budget_paise::numeric*7*(10000+cost.tax_rate_bps)/10000)
            >reservation.ceiling_paise-cost.media_paise-cost.tax_paise end))
    or exists(select 1 from public.campaigns campaign where campaign.business_id=p_business_id and campaign.status='active'
      and not exists(select 1 from private.customer_ad_reservations reservation where reservation.campaign_id=campaign.id
        and reservation.account_id=p_account_id and reservation.state<>'closed'));
  return jsonb_build_object('businessId',p_business_id,'currency','INR','capturedPaise',captured,'refundedPaise',refunded,
    'serviceAllocationPaise',service_allocation,'advertisingAllocationPaise',advertising,'advertisingRefundedPaise',ad_refunded,
    'serviceEarnedPaise',coalesce((select sum(allocation.service_earned_paise) from private.customer_refund_allocations allocation
      join private.production_payment_orders payment on payment.id=allocation.order_id where payment.business_id=p_business_id and payment.account_id=p_account_id),0),
    'mediaCostPaise',media,'taxCostPaise',tax,'reservedPaise',reserved,
    'remainingPaise',case when held then 0 else greatest(advertising-ad_refunded-media-tax-reserved,0) end,
    'held',held,'reason',case when held then 'Payment, refund or cost reconciliation is required.' else null end,
    'reservations',coalesce((select jsonb_agg(jsonb_build_object('campaignId',campaign_id,'reservationId',id,'state',state))
      from private.customer_ad_reservations where business_id=p_business_id and account_id=p_account_id),'[]'::jsonb));
end;
$$;

drop function if exists public.customer_ad_reserve(uuid,uuid,text,uuid,text,bigint,bigint,text,boolean);
create or replace function public.customer_ad_reserve(p_business_id uuid,p_user_id uuid,p_account_id text,
  p_campaign_id uuid,p_ad_account_id text,p_connection_generation bigint,p_daily_budget_paise bigint,p_request_key text,p_review_only boolean default false,
  p_lifetime_cap_paise bigint default null)
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

create or replace function private.customer_ad_campaign_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare reservation private.customer_ad_reservations; cost private.customer_ad_costs; balance jsonb; owner_id uuid;
begin
  if tg_op='UPDATE' and new.meta_campaign_id is distinct from old.meta_campaign_id
    and (exists(select 1 from private.customer_ad_reservations where campaign_id=new.id)
      or exists(select 1 from private.customer_ad_costs where campaign_id=new.id)) then
    raise exception 'Financially attributed Meta campaign cannot be rebound' using errcode='23514';
  end if;
  if new.status<>'active' then return new; end if;
  if tg_op='UPDATE' and old.status='active' and new.daily_budget is not distinct from old.daily_budget
    and new.business_id=old.business_id and new.meta_ad_account_id is not distinct from old.meta_ad_account_id
    and new.meta_connection_generation is not distinct from old.meta_connection_generation
    and new.meta_campaign_id is not distinct from old.meta_campaign_id then return new; end if;
  select * into reservation from private.customer_ad_reservations where campaign_id=new.id;
  if not found then raise exception 'Customer reservation required before activation or budget change' using errcode='23514'; end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:'||reservation.account_id,0)) then
    raise exception 'Customer accounting is busy; retry after reconciliation' using errcode='55P03';
  end if;
  select * into reservation from private.customer_ad_reservations where campaign_id=new.id;
  select * into cost from private.customer_ad_costs where campaign_id=new.id;
  select business.owner_id into owner_id from public.businesses business where id=new.business_id;
  balance:=public.customer_ad_balance(new.business_id,owner_id,reservation.account_id);
  if not ((reservation.state in ('uncertain','active') and reservation.business_id=new.business_id and reservation.ad_account_id=new.meta_ad_account_id
    and reservation.meta_campaign_id=new.meta_campaign_id
    and reservation.connection_generation=new.meta_connection_generation and new.daily_budget*100<=reservation.daily_budget_paise
    and not (balance->>'held')::boolean and cost.observed_at>=clock_timestamp()-interval '15 minutes'
    and ceil(coalesce(reservation.bounded_media_paise-cost.media_paise,new.daily_budget::numeric*100*7)*(10000+cost.tax_rate_bps)/10000)
      <=reservation.ceiling_paise-cost.media_paise-cost.tax_paise) is true) then
    raise exception 'Customer advertising reservation is unavailable' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.customer_ad_campaign_guard() from public,anon,authenticated,service_role;

revoke all on function public.customer_ad_balance(uuid,uuid,text),
  public.customer_ad_reserve(uuid,uuid,text,uuid,text,bigint,bigint,text,boolean,bigint) from public,anon,authenticated;
grant execute on function public.customer_ad_balance(uuid,uuid,text),
  public.customer_ad_reserve(uuid,uuid,text,uuid,text,bigint,bigint,text,boolean,bigint) to service_role;
commit;
