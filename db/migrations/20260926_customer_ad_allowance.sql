create table if not exists private.customer_ad_costs (
  campaign_id uuid primary key references public.campaigns(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  account_id text not null,
  ad_account_id text not null,
  connection_generation bigint not null,
  media_paise bigint not null check (media_paise between 0 and 9007199254740991),
  tax_paise bigint not null check (tax_paise between 0 and 9007199254740991),
  tax_rate_bps integer not null check (tax_rate_bps between 0 and 10000),
  observed_at timestamptz not null check (isfinite(observed_at)),
  held boolean not null default false,
  finalized boolean not null default false
);
create table if not exists private.customer_ad_cost_evidence (
  reference uuid primary key,
  actor_id uuid not null references auth.users(id) on delete restrict,
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  input jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create table if not exists private.customer_ad_reservations (
  campaign_id uuid primary key references public.campaigns(id) on delete restrict,
  id uuid not null unique default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  account_id text not null,
  ad_account_id text not null,
  connection_generation bigint not null,
  request_key text not null check (request_key ~ '^[a-f0-9]{64}$'),
  ceiling_paise bigint not null check (ceiling_paise between 1 and 9007199254740991),
  daily_budget_paise bigint not null check (daily_budget_paise between 1 and 9007199254740991),
  media_limit_paise bigint not null check (media_limit_paise between 1 and 9007199254740991),
  state text not null check (state in ('uncertain','active','paused','closed')),
  activation_in_flight boolean not null default true,
  updated_at timestamptz not null default clock_timestamp()
);
create table if not exists private.customer_refund_allocations (
  order_id uuid primary key references private.production_payment_orders(id) on delete restrict,
  service_refunded_paise bigint not null check (service_refunded_paise between 0 and 200000),
  advertising_refunded_paise bigint not null check (advertising_refunded_paise between 0 and 800000),
  service_earned_paise bigint not null check (service_earned_paise in (0,200000)),
  evidence_reference uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  check (service_refunded_paise + service_earned_paise <= 200000)
);
create table if not exists private.customer_refund_allocation_evidence (
  reference uuid primary key,
  order_id uuid not null references private.production_payment_orders(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  input jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.customer_ad_costs enable row level security;
alter table private.customer_ad_cost_evidence enable row level security;
alter table private.customer_ad_reservations enable row level security;
alter table private.customer_refund_allocations enable row level security;
alter table private.customer_refund_allocation_evidence enable row level security;
revoke all on private.customer_ad_costs,private.customer_ad_cost_evidence,private.customer_ad_reservations,private.customer_refund_allocations,private.customer_refund_allocation_evidence from public,anon,authenticated,service_role;

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
      or (payment.refunded_paise>0 and payment.refunded_paise<payment.amount_paise
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
    coalesce(bool_or(cost.held or (not cost.finalized and cost.observed_at<clock_timestamp()-interval '15 minutes')),false)
    into media,tax,cost_held from private.customer_ad_costs cost where cost.business_id=p_business_id and cost.account_id=p_account_id;
  select coalesce(sum(greatest(reservation.ceiling_paise-coalesce(cost.media_paise,0)-coalesce(cost.tax_paise,0),0)),0)
    into reserved from private.customer_ad_reservations reservation
    left join private.customer_ad_costs cost on cost.campaign_id=reservation.campaign_id
    where reservation.business_id=p_business_id and reservation.account_id=p_account_id and reservation.state<>'closed';
  held := held or cost_held or media+tax+reserved>advertising-ad_refunded
    or exists(select 1 from private.customer_ad_reservations reservation
      left join private.customer_ad_costs cost on cost.campaign_id=reservation.campaign_id
      where reservation.business_id=p_business_id and reservation.account_id=p_account_id and reservation.state<>'closed'
        and (cost.campaign_id is null or ceil(reservation.daily_budget_paise::numeric*7*(10000+cost.tax_rate_bps)/10000)
          >reservation.ceiling_paise-cost.media_paise-cost.tax_paise))
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

create or replace function public.customer_ad_reserve(p_business_id uuid,p_user_id uuid,p_account_id text,
  p_campaign_id uuid,p_ad_account_id text,p_connection_generation bigint,p_daily_budget_paise bigint,p_request_key text,p_review_only boolean default false)
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
  if not found or not ((campaign.meta_ad_account_id=p_ad_account_id and campaign.meta_connection_generation=p_connection_generation
    and campaign.daily_budget*100=p_daily_budget_paise and p_daily_budget_paise>0 and p_request_key ~ '^[a-f0-9]{64}$'
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
  if available<ceil(p_daily_budget_paise::numeric*7*(10000+cost.tax_rate_bps)/10000) then
    raise exception 'Insufficient customer advertising allowance' using errcode='23514';
  end if;
  if p_review_only then return jsonb_build_object('reservationId',p_campaign_id,'mediaLimitPaise',cost.media_paise+floor(available::numeric*10000/(10000+cost.tax_rate_bps)),'balance',balance); end if;
  insert into private.customer_ad_reservations(campaign_id,business_id,account_id,ad_account_id,connection_generation,request_key,ceiling_paise,daily_budget_paise,media_limit_paise,state)
    values(p_campaign_id,p_business_id,p_account_id,p_ad_account_id,p_connection_generation,p_request_key,available+cost.media_paise+cost.tax_paise,p_daily_budget_paise,
      cost.media_paise+floor(available::numeric*10000/(10000+cost.tax_rate_bps)),'uncertain')
    on conflict(campaign_id) do update set id=gen_random_uuid(),request_key=excluded.request_key,ceiling_paise=excluded.ceiling_paise,
      daily_budget_paise=excluded.daily_budget_paise,media_limit_paise=excluded.media_limit_paise,state='uncertain',activation_in_flight=true,updated_at=clock_timestamp()
    returning * into reservation;
  update private.customer_ad_costs set finalized=false where campaign_id=p_campaign_id;
  return jsonb_build_object('reservationId',reservation.id,'mediaLimitPaise',reservation.media_limit_paise,'balance',public.customer_ad_balance(p_business_id,p_user_id,p_account_id));
end;
$$;

create or replace function public.customer_ad_activation_result(p_business_id uuid,p_user_id uuid,p_account_id text,
  p_campaign_id uuid,p_reservation_id uuid,p_state text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:'||p_account_id,0));
  perform public.customer_ad_balance(p_business_id,p_user_id,p_account_id);
  if p_state is null or p_state not in ('active','paused','uncertain') then raise exception 'Invalid provider state' using errcode='23514'; end if;
  update private.customer_ad_reservations set
    state=case when p_state='paused' and activation_in_flight then 'uncertain' else p_state end,
    activation_in_flight=case when p_state in ('active','uncertain') then false else activation_in_flight end,
    updated_at=clock_timestamp()
    where campaign_id=p_campaign_id and business_id=p_business_id and account_id=p_account_id and id=p_reservation_id and state<>'closed';
  if not found then raise exception 'Reservation changed' using errcode='23514'; end if;
end;
$$;

create or replace function public.customer_ad_reconcile_costs(p_business_id uuid,p_actor_id uuid,p_account_id text,
  p_campaign_id uuid,p_ad_account_id text,p_connection_generation bigint,p_media_paise bigint,p_tax_paise bigint,p_tax_rate_bps integer,
  p_observed_at timestamptz,p_evidence_reference uuid,p_final boolean,p_reservation_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  previous private.customer_ad_costs;
  reservation private.customer_ad_reservations;
  evidence jsonb;
  saved_evidence private.customer_ad_cost_evidence;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:'||p_account_id,0));
  if not public.production_payment_operator_allowed(p_actor_id,true) then raise exception 'Financial operator required' using errcode='42501'; end if;
  if not ((p_media_paise between 0 and 9007199254740991 and p_tax_paise between 0 and 9007199254740991
    and p_tax_rate_bps between 0 and 10000 and isfinite(p_observed_at) and p_observed_at<=clock_timestamp()
    and p_evidence_reference is not null and p_final is not null
    and exists(select 1 from public.campaigns where id=p_campaign_id and business_id=p_business_id
      and meta_ad_account_id=p_ad_account_id and meta_connection_generation=p_connection_generation)
    and exists(select 1 from private.production_payment_orders where business_id=p_business_id and account_id=p_account_id and environment='live')) is true) then
    raise exception 'Invalid attributed cost evidence' using errcode='23514';
  end if;
  evidence := jsonb_build_object('business',p_business_id,'merchant',p_account_id,'account',p_ad_account_id,'generation',p_connection_generation,
    'media',p_media_paise,'tax',p_tax_paise,'taxRateBps',p_tax_rate_bps,'observedAt',p_observed_at,'final',p_final,'reservation',p_reservation_id);
  select * into saved_evidence from private.customer_ad_cost_evidence where reference=p_evidence_reference;
  if found then
    if saved_evidence.actor_id<>p_actor_id or saved_evidence.campaign_id<>p_campaign_id or saved_evidence.input<>evidence then
      raise exception 'Cost evidence identity conflict' using errcode='23514';
    end if;
    return;
  end if;
  select * into previous from private.customer_ad_costs where campaign_id=p_campaign_id;
  if found and (previous.business_id<>p_business_id or previous.account_id<>p_account_id or previous.ad_account_id<>p_ad_account_id
    or previous.connection_generation<>p_connection_generation) then raise exception 'Cost account changed' using errcode='23514'; end if;
  select * into reservation from private.customer_ad_reservations where campaign_id=p_campaign_id;
  if p_final and ((reservation.id is not null and (reservation.id is distinct from p_reservation_id or reservation.state<>'paused'
      or reservation.activation_in_flight or p_observed_at<reservation.updated_at))
    or not exists(select 1 from public.campaigns where id=p_campaign_id and status='paused')
    or p_observed_at<clock_timestamp()-interval '15 minutes' or p_observed_at<previous.observed_at
    or p_media_paise<previous.media_paise or p_tax_paise<previous.tax_paise) then
    raise exception 'Paused delivery and final reconciled costs required' using errcode='23514';
  end if;
  insert into private.customer_ad_cost_evidence(reference,actor_id,campaign_id,input) values(p_evidence_reference,p_actor_id,p_campaign_id,evidence);
  insert into private.customer_ad_costs(campaign_id,business_id,account_id,ad_account_id,connection_generation,media_paise,tax_paise,tax_rate_bps,observed_at,finalized)
    values(p_campaign_id,p_business_id,p_account_id,p_ad_account_id,p_connection_generation,p_media_paise,p_tax_paise,p_tax_rate_bps,p_observed_at,p_final)
    on conflict(campaign_id) do update set media_paise=greatest(private.customer_ad_costs.media_paise,excluded.media_paise),
      tax_paise=greatest(private.customer_ad_costs.tax_paise,excluded.tax_paise),
      tax_rate_bps=case when excluded.observed_at>=private.customer_ad_costs.observed_at then excluded.tax_rate_bps else private.customer_ad_costs.tax_rate_bps end,
      held=private.customer_ad_costs.held or (excluded.observed_at>=private.customer_ad_costs.observed_at
        and (excluded.media_paise<private.customer_ad_costs.media_paise or excluded.tax_paise<private.customer_ad_costs.tax_paise)),
      observed_at=greatest(private.customer_ad_costs.observed_at,excluded.observed_at),
      finalized=case when excluded.observed_at>=private.customer_ad_costs.observed_at then excluded.finalized else private.customer_ad_costs.finalized end;
  if p_final then update private.customer_ad_reservations set state='closed',updated_at=clock_timestamp() where campaign_id=p_campaign_id and id=p_reservation_id; end if;
end;
$$;

create or replace function public.customer_ad_refund_allocation(p_business_id uuid,p_actor_id uuid,p_account_id text,p_order_id uuid,
  p_service_refunded_paise bigint,p_advertising_refunded_paise bigint,p_service_earned_paise bigint,p_evidence_reference uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare payment private.production_payment_orders; previous private.customer_refund_allocations;
  evidence jsonb; saved_evidence private.customer_refund_allocation_evidence;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:'||p_account_id,0));
  if not public.production_payment_operator_allowed(p_actor_id,true) then raise exception 'Financial operator required' using errcode='42501'; end if;
  select * into payment from private.production_payment_orders where id=p_order_id and business_id=p_business_id and account_id=p_account_id and environment='live';
  if not found or not ((payment.captured_paise=payment.amount_paise and p_service_refunded_paise between 0 and (payment.quote->>'serviceAllocationPaise')::bigint
    and p_advertising_refunded_paise between 0 and (payment.quote->>'metaAllocationPaise')::bigint
    and p_service_refunded_paise+p_advertising_refunded_paise=payment.refunded_paise and p_service_earned_paise in (0,200000)
    and p_service_earned_paise+p_service_refunded_paise<=200000 and p_evidence_reference is not null) is true) then
    raise exception 'Refund allocation must match verified payment and delivery evidence' using errcode='23514';
  end if;
  evidence:=jsonb_build_object('serviceRefunded',p_service_refunded_paise,'advertisingRefunded',p_advertising_refunded_paise,'serviceEarned',p_service_earned_paise);
  select * into saved_evidence from private.customer_refund_allocation_evidence where reference=p_evidence_reference;
  if found then
    if saved_evidence.order_id<>p_order_id or saved_evidence.actor_id<>p_actor_id or saved_evidence.input<>evidence then
      raise exception 'Refund allocation evidence conflict' using errcode='23514';
    end if;
    return;
  end if;
  select * into previous from private.customer_refund_allocations where order_id=p_order_id;
  if found and (p_service_refunded_paise<previous.service_refunded_paise or p_advertising_refunded_paise<previous.advertising_refunded_paise
    or p_service_earned_paise<previous.service_earned_paise) then raise exception 'Financial allocations cannot be silently reduced' using errcode='23514'; end if;
  insert into private.customer_refund_allocation_evidence(reference,order_id,actor_id,input) values(p_evidence_reference,p_order_id,p_actor_id,evidence);
  insert into private.customer_refund_allocations(order_id,service_refunded_paise,advertising_refunded_paise,service_earned_paise,evidence_reference,actor_id)
    values(p_order_id,p_service_refunded_paise,p_advertising_refunded_paise,p_service_earned_paise,p_evidence_reference,p_actor_id)
    on conflict(order_id) do update set service_refunded_paise=excluded.service_refunded_paise,advertising_refunded_paise=excluded.advertising_refunded_paise,
      service_earned_paise=excluded.service_earned_paise,evidence_reference=excluded.evidence_reference,actor_id=excluded.actor_id;
end;
$$;

create or replace function private.customer_ad_refund_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare payment private.production_payment_orders;
begin
  select * into payment from private.production_payment_orders where id=new.order_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:'||payment.account_id,0));
  if exists(select 1 from private.customer_ad_reservations where business_id=payment.business_id and account_id=payment.account_id and state<>'closed')
    or exists(select 1 from private.customer_ad_costs where business_id=payment.business_id and account_id=payment.account_id and (not finalized or held))
    or new.amount_paise>payment.captured_paise-greatest(payment.refunded_paise,payment.provider_refunded_paise)
      -coalesce((select sum(media_paise+tax_paise) from private.customer_ad_costs where business_id=payment.business_id and account_id=payment.account_id),0)
      -coalesce((select service_earned_paise from private.customer_refund_allocations where order_id=payment.id),0) then
    raise exception 'Customer costs and reservations must be reconciled before refund' using errcode='23514';
  end if;
  return new;
end;
$$;
drop trigger if exists customer_ad_refund_guard on private.production_payment_refunds;
create trigger customer_ad_refund_guard before insert on private.production_payment_refunds for each row execute function private.customer_ad_refund_guard();

create or replace function private.customer_ad_campaign_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare reservation private.customer_ad_reservations; cost private.customer_ad_costs; balance jsonb; owner_id uuid;
begin
  if new.status<>'active' then return new; end if;
  if tg_op='UPDATE' and old.status='active' and new.daily_budget is not distinct from old.daily_budget
    and new.business_id=old.business_id and new.meta_ad_account_id is not distinct from old.meta_ad_account_id
    and new.meta_connection_generation is not distinct from old.meta_connection_generation then return new; end if;
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
    and reservation.connection_generation=new.meta_connection_generation and new.daily_budget*100<=reservation.daily_budget_paise
    and not (balance->>'held')::boolean and cost.observed_at>=clock_timestamp()-interval '15 minutes'
    and ceil(new.daily_budget::numeric*100*7*(10000+cost.tax_rate_bps)/10000)<=reservation.ceiling_paise-cost.media_paise-cost.tax_paise) is true) then
    raise exception 'Customer advertising reservation is unavailable' using errcode='23514';
  end if;
  return new;
end;
$$;
drop trigger if exists customer_ad_campaign_guard on public.campaigns;
create trigger customer_ad_campaign_guard before insert or update on public.campaigns for each row execute function private.customer_ad_campaign_guard();

revoke all on function public.customer_ad_balance(uuid,uuid,text),public.customer_ad_reserve(uuid,uuid,text,uuid,text,bigint,bigint,text,boolean),
  public.customer_ad_activation_result(uuid,uuid,text,uuid,uuid,text),
  public.customer_ad_refund_allocation(uuid,uuid,text,uuid,bigint,bigint,bigint,uuid),
  public.customer_ad_reconcile_costs(uuid,uuid,text,uuid,text,bigint,bigint,bigint,integer,timestamptz,uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.customer_ad_balance(uuid,uuid,text),public.customer_ad_reserve(uuid,uuid,text,uuid,text,bigint,bigint,text,boolean),
  public.customer_ad_activation_result(uuid,uuid,text,uuid,uuid,text),
  public.customer_ad_refund_allocation(uuid,uuid,text,uuid,bigint,bigint,bigint,uuid),
  public.customer_ad_reconcile_costs(uuid,uuid,text,uuid,text,bigint,bigint,bigint,integer,timestamptz,uuid,boolean,uuid) to service_role;
revoke all on function private.customer_ad_refund_guard(),private.customer_ad_campaign_guard() from public,anon,authenticated,service_role;