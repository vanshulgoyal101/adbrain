begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #221: a paused or ended funded run no longer blocks the customer's next run until an operator
-- finalizes it. While it settles, only that run's unused reserve stays held; the rest of the
-- balance stays usable. AdBrain records final Meta evidence itself only after Meta confirms the
-- stop (checked by the caller) and two equal lifetime-spend reads at least 30 minutes apart, the
-- later one at least 3 hours after the pause. Refunds, allocations and clearing a hold stay with
-- the financial operator.
create index if not exists customer_ad_cost_evidence_campaign_idx
  on private.customer_ad_cost_evidence(campaign_id,created_at);

create or replace function public.customer_ad_settle_costs(p_business_id uuid,p_user_id uuid,p_account_id text,
  p_campaign_id uuid,p_ad_account_id text,p_connection_generation bigint,p_reservation_id uuid,p_media_paise bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare previous private.customer_ad_costs; reservation private.customer_ad_reservations; rate integer; media bigint; tax bigint;
  observed timestamptz; last_differ timestamptz; first_equal timestamptz; settled boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:'||p_account_id,0));
  if not ((p_media_paise between 0 and 9007199254740991
    and exists(select 1 from public.businesses where id=p_business_id and owner_id=p_user_id)
    and exists(select 1 from public.campaigns where id=p_campaign_id and business_id=p_business_id and status='paused'
      and meta_campaign_id is not null and meta_campaign_id<>''
      and meta_ad_account_id=p_ad_account_id and meta_connection_generation=p_connection_generation)
    and exists(select 1 from public.meta_connections where business_id=p_business_id and authorization_status='connected'
      and ad_account_id=p_ad_account_id and generation=p_connection_generation)
    and exists(select 1 from private.production_payment_orders where business_id=p_business_id and user_id=p_user_id
      and account_id=p_account_id and environment='live')) is true) then
    raise exception 'Invalid settled cost evidence' using errcode='23514';
  end if;
  select * into reservation from private.customer_ad_reservations where campaign_id=p_campaign_id for update;
  if not found or reservation.id<>p_reservation_id or reservation.business_id<>p_business_id or reservation.account_id<>p_account_id
    or reservation.ad_account_id<>p_ad_account_id or reservation.connection_generation<>p_connection_generation
    or reservation.state<>'paused' or reservation.activation_in_flight then
    raise exception 'A paused reservation is required' using errcode='23514';
  end if;
  select * into previous from private.customer_ad_costs where campaign_id=p_campaign_id for update;
  if not found or previous.business_id<>p_business_id or previous.account_id<>p_account_id or previous.ad_account_id<>p_ad_account_id
    or previous.connection_generation<>p_connection_generation then raise exception 'Cost account changed' using errcode='23514'; end if;
  observed := clock_timestamp();
  select max(evidence.created_at) into last_differ from private.customer_ad_cost_evidence evidence
    where evidence.campaign_id=p_campaign_id and evidence.input->>'settleRead'='true' and evidence.input->>'reservation'=p_reservation_id::text
      and (evidence.input->>'metaMedia')::bigint<>p_media_paise;
  select min(evidence.created_at) into first_equal from private.customer_ad_cost_evidence evidence
    where evidence.campaign_id=p_campaign_id and evidence.input->>'settleRead'='true' and evidence.input->>'reservation'=p_reservation_id::text
      and (evidence.input->>'metaMedia')::bigint=p_media_paise and evidence.created_at>=reservation.updated_at
      and evidence.created_at>coalesce(last_differ,'-infinity'::timestamptz);
  settled := not previous.held and first_equal is not null
    and first_equal<=observed-interval '30 minutes' and observed>=reservation.updated_at+interval '3 hours';
  rate := previous.tax_rate_bps;
  media := greatest(previous.media_paise,p_media_paise);
  tax := greatest(previous.tax_paise,ceil(media::numeric*rate/10000)::bigint);
  insert into private.customer_ad_cost_evidence(reference,actor_id,campaign_id,input,created_at)
    values(gen_random_uuid(),null,p_campaign_id,jsonb_build_object('source','meta','settleRead',true,'reservation',p_reservation_id,
      'business',p_business_id,'merchant',p_account_id,'account',p_ad_account_id,'generation',p_connection_generation,
      'metaMedia',p_media_paise,'media',media,'tax',tax,'taxRateBps',rate,'observedAt',observed,'final',settled),observed);
  update private.customer_ad_costs set media_paise=media,tax_paise=tax,observed_at=greatest(observed_at,observed),
    finalized=finalized or settled where campaign_id=p_campaign_id;
  if settled then
    update private.customer_ad_reservations set state='closed',updated_at=observed where campaign_id=p_campaign_id;
  end if;
  return jsonb_build_object('finalized',settled,'mediaPaise',media,'taxPaise',tax,'observedAt',observed);
end;
$$;

-- Businesses with a paused run still holding its reserve, for the scheduled settle sweep.
create or replace function public.customer_ad_settling_businesses()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct reservation.business_id from private.customer_ad_reservations reservation
  where reservation.state='paused' and not reservation.activation_in_flight;
$$;

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
  -- #221: a settling run (paused reservation, campaign not active) keeps its unused reserve in
  -- `reserved` but its stale non-final evidence no longer holds the whole balance.
  select coalesce(sum(cost.media_paise),0),coalesce(sum(cost.tax_paise),0),
    coalesce(bool_or(cost.held or (not cost.finalized and cost.observed_at<clock_timestamp()-interval '15 minutes'
      and exists(select 1 from private.customer_ad_reservations reservation
        where reservation.campaign_id=cost.campaign_id and reservation.state<>'closed'
          and not (reservation.account_id=p_account_id and coalesce(reservation.bounded_media_paise>=cost.media_paise,false))
          and not (reservation.account_id=p_account_id and reservation.state='paused' and not reservation.activation_in_flight
            and exists(select 1 from public.campaigns campaign where campaign.id=reservation.campaign_id and campaign.status<>'active'))))),false)
    into media,tax,cost_held from private.customer_ad_costs cost where cost.business_id=p_business_id and cost.account_id=p_account_id;
  select coalesce(sum(greatest(reservation.ceiling_paise-coalesce(cost.media_paise,0)-coalesce(cost.tax_paise,0),0)),0)
    into reserved from private.customer_ad_reservations reservation
    left join private.customer_ad_costs cost on cost.campaign_id=reservation.campaign_id
    where reservation.business_id=p_business_id and reservation.account_id=p_account_id and reservation.state<>'closed';
  held := held or cost_held or media+tax+reserved>advertising-ad_refunded
    or exists(select 1 from private.customer_ad_reservations reservation
      left join private.customer_ad_costs cost on cost.campaign_id=reservation.campaign_id
      where reservation.business_id=p_business_id and reservation.account_id=p_account_id and reservation.state<>'closed'
        and (cost.campaign_id is null or case
          when reservation.state='paused' and not reservation.activation_in_flight
            and exists(select 1 from public.campaigns campaign where campaign.id=reservation.campaign_id and campaign.status<>'active')
          then cost.media_paise+cost.tax_paise>reservation.ceiling_paise
          when reservation.bounded_media_paise is not null
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

revoke all on function public.customer_ad_settle_costs(uuid,uuid,text,uuid,text,bigint,uuid,bigint),
  public.customer_ad_settling_businesses(),
  public.customer_ad_balance(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.customer_ad_settle_costs(uuid,uuid,text,uuid,text,bigint,uuid,bigint),
  public.customer_ad_settling_businesses(),
  public.customer_ad_balance(uuid,uuid,text) to service_role;
commit;
