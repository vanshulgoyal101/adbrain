begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #245: the operator funds some businesses directly on Meta (prepaid funds and a capped ad set).
-- Those activate with no customer allowance or reservation; every other business keeps the
-- allowance rules. Only a payment operator sets or clears the mark, and each change is audited.
-- It is not a businesses column because owners can update their own row through RLS.
create table if not exists private.operator_funded_businesses (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default clock_timestamp(),
  reason text not null check (length(btrim(reason)) between 3 and 500)
);
create table if not exists private.operator_funding_audit (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  enabled boolean not null,
  reason text not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.operator_funded_businesses enable row level security;
alter table private.operator_funding_audit enable row level security;
revoke all on private.operator_funded_businesses,private.operator_funding_audit from public,anon,authenticated,service_role;

create or replace function public.operator_funded(p_business_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.operator_funded_businesses where business_id=p_business_id);
$$;

create or replace function public.operator_funding_set(p_business_id uuid,p_actor_id uuid,p_enabled boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.production_payment_operator_allowed(p_actor_id,false) then
    raise exception 'Payment operator not authorized' using errcode='42501';
  end if;
  if p_enabled is null or length(btrim(coalesce(p_reason,''))) not between 3 and 500
    or not exists(select 1 from public.businesses where id=p_business_id) then
    raise exception 'Invalid operator funding change' using errcode='23514';
  end if;
  if p_enabled then
    insert into private.operator_funded_businesses(business_id,approved_by,reason) values(p_business_id,p_actor_id,btrim(p_reason))
      on conflict(business_id) do update set approved_by=excluded.approved_by,approved_at=clock_timestamp(),reason=excluded.reason;
  else
    delete from private.operator_funded_businesses where business_id=p_business_id;
  end if;
  insert into private.operator_funding_audit(business_id,actor_id,enabled,reason) values(p_business_id,p_actor_id,p_enabled,btrim(p_reason));
  return jsonb_build_object('businessId',p_business_id,'operatorFunded',p_enabled);
end;
$$;

-- Same as 20261023_capped_reservation_bound.sql, plus the operator-funded exemption.
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
  if exists(select 1 from private.operator_funded_businesses where business_id=new.business_id) then return new; end if;
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

revoke all on function public.operator_funded(uuid),public.operator_funding_set(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.operator_funded(uuid),public.operator_funding_set(uuid,uuid,boolean,text) to service_role;
commit;
