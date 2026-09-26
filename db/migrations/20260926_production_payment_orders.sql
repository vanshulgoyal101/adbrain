create schema if not exists private;

create table if not exists private.production_payment_orders (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  request_key uuid not null,
  environment text not null default 'live' check (environment = 'live'),
  account_id text not null check (account_id ~ '^acc_[A-Za-z0-9]{1,100}$'),
  key_id text not null check (key_id ~ '^rzp_live_[A-Za-z0-9]{1,100}$'),
  amount_paise bigint not null default 1000000 check (amount_paise = 1000000),
  currency text not null default 'INR' check (currency = 'INR'),
  quote jsonb not null check (quote = '{"version":"inr-annual-total-v1","merchantDisplay":"Vanshul Goyal","currency":"INR","totalPaise":1000000,"serviceAllocationPaise":200000,"metaAllocationPaise":800000,"additionalCustomerTaxPaise":0,"metaTaxTreatment":"included-in-meta-allocation","gatewayFees":"absorbed-by-adbrain","automaticRenewal":false}'::jsonb),
  terms jsonb not null check (jsonb_typeof(terms) = 'object' and octet_length(terms::text) <= 32768),
  terms_hash text not null check (terms_hash ~ '^[a-f0-9]{64}$'),
  funding_evidence_id uuid not null references public.meta_funding_evidence(id) on delete restrict,
  accepted_at timestamptz not null default clock_timestamp(),
  provider_order_id text check (provider_order_id ~ '^order_[A-Za-z0-9]{1,100}$'),
  payment_id text check (payment_id ~ '^pay_[A-Za-z0-9]{1,100}$'),
  captured_paise bigint not null default 0 check (captured_paise in (0,1000000)),
  refunded_paise bigint not null default 0 check (refunded_paise between 0 and 1000000),
  provider_refunded_paise bigint not null default 0 check (provider_refunded_paise between 0 and 1000000),
  review_required boolean not null default false,
  refund_hold boolean not null default false,
  creation_uncertain boolean not null default false,
  state text generated always as (case
    when review_required then 'review_required'
    when refunded_paise = 1000000 then 'refunded'
    when refunded_paise > 0 then 'partially_refunded'
    when refund_hold then 'refund_pending'
    when captured_paise = 1000000 then 'captured'
    when creation_uncertain then 'needs_reconciliation'
    when provider_order_id is not null then 'created'
    else 'creating' end) stored,
  updated_at timestamptz not null default clock_timestamp(),
  unique (business_id,request_key),
  unique (account_id,provider_order_id),
  unique (account_id,payment_id)
);
create unique index if not exists production_payment_orders_active_business_idx
  on private.production_payment_orders(business_id) where refunded_paise < amount_paise or review_required;

create table if not exists private.production_payment_events (
  account_id text not null check (account_id ~ '^acc_[A-Za-z0-9]{1,100}$'),
  event_id text not null check (event_id ~ '^[A-Za-z0-9_:.-]{1,160}$'),
  key_id text not null check (key_id ~ '^rzp_live_[A-Za-z0-9]{1,100}$'),
  webhook_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  payment_id text not null check (payment_id ~ '^pay_[A-Za-z0-9]{1,100}$'),
  provider_order_id text check (provider_order_id ~ '^order_[A-Za-z0-9]{1,100}$'),
  refund_id text check (refund_id ~ '^rfnd_[A-Za-z0-9]{1,100}$'),
  kind text not null check (kind in ('capture','pending','refund','dispute')),
  conflicted boolean not null default false,
  processed_at timestamptz,
  received_at timestamptz not null default clock_timestamp(),
  primary key (account_id,event_id)
);
create index if not exists production_payment_events_pending_idx
  on private.production_payment_events(account_id,received_at) where processed_at is null;
create index if not exists production_payment_events_payment_idx
  on private.production_payment_events(account_id,payment_id);

create table if not exists private.production_payment_event_conflicts (
  account_id text not null,
  event_id text not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  payment_id text not null check (payment_id ~ '^pay_[A-Za-z0-9]{1,100}$'),
  provider_order_id text check (provider_order_id ~ '^order_[A-Za-z0-9]{1,100}$'),
  received_at timestamptz not null default clock_timestamp(),
  primary key(account_id,event_id,payload_hash),
  foreign key(account_id,event_id) references private.production_payment_events(account_id,event_id) on delete restrict
);
create index if not exists production_payment_event_conflicts_payment_idx
  on private.production_payment_event_conflicts(account_id,payment_id);
alter table private.production_payment_event_conflicts enable row level security;
revoke all on private.production_payment_event_conflicts from public,anon,authenticated,service_role;

create table if not exists private.production_payment_effects (
  account_id text not null,
  kind text not null check (kind in ('capture','refund')),
  provider_id text not null,
  payment_id text not null check (payment_id ~ '^pay_[A-Za-z0-9]{1,100}$'),
  order_id uuid not null references private.production_payment_orders(id) on delete restrict,
  amount_paise bigint not null check (amount_paise between 1 and 1000000),
  snapshot_hash text not null check (snapshot_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (account_id,kind,provider_id),
  check ((kind = 'capture' and provider_id = payment_id and amount_paise = 1000000)
    or (kind = 'refund' and provider_id ~ '^rfnd_[A-Za-z0-9]{1,100}$'))
);

alter table private.production_payment_orders enable row level security;
alter table private.production_payment_events enable row level security;
alter table private.production_payment_effects enable row level security;
revoke all on private.production_payment_orders,private.production_payment_events,private.production_payment_effects from public,anon,authenticated,service_role;

create or replace function public.production_payment_order_claim(
  p_business_id uuid, p_user_id uuid, p_request_key uuid, p_order_id uuid,
  p_account_id text, p_key_id text, p_quote jsonb, p_terms text, p_terms_hash text, p_funding_evidence_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved private.production_payment_orders;
  policy jsonb;
  funding jsonb;
  inserted boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:' || p_account_id,0));
  perform 1 from public.businesses where id = p_business_id and owner_id = p_user_id for update;
  if not found then raise exception 'Payment owner not found' using errcode = '23514'; end if;
  select * into saved from private.production_payment_orders where business_id = p_business_id
    and (request_key = p_request_key or refunded_paise < amount_paise or review_required)
    order by (request_key = p_request_key) desc limit 1;
  if found then
    if saved.user_id is distinct from p_user_id or saved.account_id is distinct from p_account_id or saved.key_id is distinct from p_key_id
      or saved.terms_hash is distinct from p_terms_hash or saved.quote is distinct from p_quote then
      raise exception 'Payment request scope changed' using errcode = '23514';
    end if;
    return jsonb_build_object('claimed',false,'order',to_jsonb(saved));
  end if;
  if p_terms is null or octet_length(p_terms) > 32768 or p_terms_hash is distinct from encode(sha256(convert_to(p_terms,'UTF8')),'hex') then
    raise exception 'Payment terms digest mismatch' using errcode = '23514';
  end if;
  policy := p_terms::jsonb;
  if not ((jsonb_typeof(policy) = 'object'
    and policy - array['version','approvalReference','approvedAt','expiresAt','serviceScope','invoiceTerms','refundTerms','automaticFundingApprovalReference'] = '{}'::jsonb
    and (policy->>'version') ~ '^[a-z0-9][a-z0-9-]{0,63}$'
    and (policy->>'approvalReference')::uuid is not null
    and (policy->>'automaticFundingApprovalReference')::uuid is not null
    and length(trim(policy->>'serviceScope')) between 1 and 8000
    and length(trim(policy->>'invoiceTerms')) between 1 and 8000
    and length(trim(policy->>'refundTerms')) between 1 and 8000
    and isfinite((policy->>'approvedAt')::timestamptz) and (policy->>'approvedAt')::timestamptz <= clock_timestamp()
    and isfinite((policy->>'expiresAt')::timestamptz) and (policy->>'expiresAt')::timestamptz > clock_timestamp()) is true) then
    raise exception 'Payment policy is incomplete or expired' using errcode = '23514';
  end if;
  funding := public.meta_funding_latest_record(p_business_id,'live');
  if not ((funding->>'evidenceId' = p_funding_evidence_id::text
    and funding->>'environment' = 'live' and funding->'revokedAt' = 'null'::jsonb
    and (funding->>'verifiedAt')::timestamptz <= clock_timestamp()
    and (funding->>'expiresAt')::timestamptz > clock_timestamp()
    and funding#>>'{setup,accountActive}' = 'true'
    and funding#>>'{setup,currency}' = 'INR' and funding#>>'{setup,country}' = 'IN'
    and funding#>>'{setup,paymentMethod}' = 'verified' and funding#>>'{setup,recurringAuthorisation}' = 'verified'
    and funding#>>'{setup,spendControls}' = 'verified' and funding#>>'{setup,ownerAcceptedMetaInitiatedPayments}' = 'true'
    and ((funding#>>'{setup,method}' = 'upi_auto_reload' and funding#>>'{setup,billingMode}' = 'available_funds')
      or (funding#>>'{setup,method}' = 'recurring_card' and funding#>>'{setup,billingMode}' in ('automatic','hybrid')))
    and exists(select 1 from public.meta_connections connection where connection.business_id = p_business_id
      and connection.authorization_status = 'connected' and connection.ad_account_id = funding#>>'{setup,accountId}'
      and connection.generation::text = funding->>'connectionGeneration')) is true) then
    raise exception 'Live automatic funding evidence unavailable' using errcode = '23514';
  end if;
  insert into private.production_payment_orders(id,business_id,user_id,request_key,account_id,key_id,quote,terms,terms_hash,funding_evidence_id)
    values(p_order_id,p_business_id,p_user_id,p_request_key,p_account_id,p_key_id,p_quote,policy,p_terms_hash,p_funding_evidence_id)
    returning * into saved;
  inserted := found;
  return jsonb_build_object('claimed',inserted,'order',to_jsonb(saved));
end;
$$;

create or replace function public.production_payment_order_get(p_order_id uuid, p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(payment_order) from private.production_payment_orders payment_order
    join public.businesses business on business.id = payment_order.business_id
    where payment_order.id = p_order_id and payment_order.user_id = p_user_id and business.owner_id = p_user_id;
$$;

create or replace function public.production_payment_order_result(p_order_id uuid, p_account_id text, p_key_id text, p_provider_order_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.production_payment_orders;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:' || p_account_id,0));
  select * into saved from private.production_payment_orders where id = p_order_id and account_id = p_account_id and key_id = p_key_id for update;
  if not found then raise exception 'Payment order not found' using errcode = '23514'; end if;
  if p_provider_order_id is null then
    update private.production_payment_orders set creation_uncertain = provider_order_id is null, updated_at = clock_timestamp() where id = p_order_id returning * into saved;
  elsif saved.provider_order_id is not null and saved.provider_order_id <> p_provider_order_id then
    update private.production_payment_orders set review_required = true, updated_at = clock_timestamp() where id = p_order_id returning * into saved;
  else
    update private.production_payment_orders set provider_order_id = p_provider_order_id, creation_uncertain = false,
      review_required = review_required or exists(select 1 from private.production_payment_events where account_id = p_account_id
        and provider_order_id = p_provider_order_id and (conflicted or kind = 'dispute'))
        or exists(select 1 from private.production_payment_event_conflicts where account_id = p_account_id and provider_order_id = p_provider_order_id),
      refund_hold = refund_hold or exists(select 1 from private.production_payment_events where account_id = p_account_id
        and provider_order_id = p_provider_order_id and kind = 'refund'), updated_at = clock_timestamp()
      where id = p_order_id returning * into saved;
  end if;
  return to_jsonb(saved);
end;
$$;

create or replace function public.production_payment_event_receive(
  p_account_id text,p_key_id text,p_webhook_id uuid,p_event_id text,p_payload_hash text,
  p_payment_id text,p_provider_order_id text,p_refund_id text,p_kind text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.production_payment_events;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:' || p_account_id,0));
  insert into private.production_payment_events(account_id,key_id,webhook_id,event_id,payload_hash,payment_id,provider_order_id,refund_id,kind)
    values(p_account_id,p_key_id,p_webhook_id,p_event_id,p_payload_hash,p_payment_id,p_provider_order_id,p_refund_id,p_kind)
    on conflict (account_id,event_id) do nothing;
  select * into saved from private.production_payment_events where account_id = p_account_id and event_id = p_event_id;
  if saved.payload_hash is distinct from p_payload_hash or saved.payment_id is distinct from p_payment_id
    or saved.provider_order_id is distinct from p_provider_order_id or saved.refund_id is distinct from p_refund_id or saved.kind is distinct from p_kind then
    update private.production_payment_events set conflicted = true, processed_at = null
      where account_id = p_account_id and event_id = p_event_id returning * into saved;
    insert into private.production_payment_event_conflicts(account_id,event_id,payload_hash,payment_id,provider_order_id)
      values(p_account_id,p_event_id,p_payload_hash,p_payment_id,p_provider_order_id) on conflict do nothing;
  end if;
  update private.production_payment_orders set
    review_required = review_required or saved.conflicted or p_kind = 'dispute' or saved.kind = 'dispute',
    refund_hold = refund_hold or p_kind = 'refund' or saved.kind = 'refund', updated_at = clock_timestamp()
    where account_id = p_account_id and (payment_id in (p_payment_id,saved.payment_id)
      or provider_order_id in (p_provider_order_id,saved.provider_order_id));
  return to_jsonb(saved);
end;
$$;

create or replace function public.production_payment_observe(
  p_order_id uuid,p_account_id text,p_key_id text,p_payment_id text,p_capture_verified boolean,
  p_provider_refunded_paise bigint,p_review_required boolean,p_snapshot_hash text,
  p_refund_id text default null,p_refund_amount_paise bigint default null,p_refund_status text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved private.production_payment_orders;
  existing private.production_payment_effects;
  refund_total bigint;
begin
  if not ((p_payment_id ~ '^pay_[A-Za-z0-9]{1,100}$' and p_capture_verified is not null and p_review_required is not null
    and p_provider_refunded_paise between 0 and 1000000 and p_snapshot_hash ~ '^[a-f0-9]{64}$'
    and ((p_refund_id is null and p_refund_amount_paise is null and p_refund_status is null)
      or (p_refund_id ~ '^rfnd_[A-Za-z0-9]{1,100}$' and p_refund_amount_paise between 1 and 1000000 and p_refund_status in ('pending','processed','failed')))) is true) then
    raise exception 'Invalid payment observation' using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:' || p_account_id,0));
  select * into saved from private.production_payment_orders where id = p_order_id and account_id = p_account_id and key_id = p_key_id for update;
  if not found or saved.provider_order_id is null then raise exception 'Payment order not ready' using errcode = '23514'; end if;
  update private.production_payment_orders set
    review_required = review_required or p_review_required
      or (payment_id is not null and payment_id <> p_payment_id and (p_capture_verified or p_refund_id is not null or p_provider_refunded_paise > 0))
      or exists(select 1 from private.production_payment_effects where order_id = p_order_id and payment_id <> p_payment_id)
      or exists(select 1 from private.production_payment_events where account_id = p_account_id
        and (payment_id = p_payment_id or provider_order_id = saved.provider_order_id) and (conflicted or kind = 'dispute'))
      or exists(select 1 from private.production_payment_event_conflicts where account_id = p_account_id
        and (payment_id = p_payment_id or provider_order_id = saved.provider_order_id)),
    refund_hold = refund_hold or p_refund_id is not null or p_provider_refunded_paise > 0
      or exists(select 1 from private.production_payment_events where account_id = p_account_id
        and (payment_id = p_payment_id or provider_order_id = saved.provider_order_id) and kind = 'refund'),
    provider_refunded_paise = greatest(provider_refunded_paise,p_provider_refunded_paise), updated_at = clock_timestamp()
    where id = p_order_id returning * into saved;
  if p_capture_verified then
    select * into existing from private.production_payment_effects where account_id = p_account_id and kind = 'capture' and provider_id = p_payment_id;
    if (found and existing.order_id <> p_order_id) or (saved.payment_id is not null and saved.payment_id <> p_payment_id) then
      update private.production_payment_orders set review_required = true where id in (p_order_id,existing.order_id);
    else
      insert into private.production_payment_effects(account_id,kind,provider_id,payment_id,order_id,amount_paise,snapshot_hash)
        values(p_account_id,'capture',p_payment_id,p_payment_id,p_order_id,1000000,p_snapshot_hash) on conflict do nothing;
      update private.production_payment_orders set captured_paise = 1000000,payment_id = p_payment_id where id = p_order_id;
    end if;
  end if;
  if p_refund_id is not null and (saved.payment_id is null or saved.payment_id = p_payment_id) then
    select * into existing from private.production_payment_effects where account_id = p_account_id and kind = 'refund' and provider_id = p_refund_id;
    if found and (existing.order_id <> p_order_id or existing.payment_id <> p_payment_id or existing.amount_paise <> p_refund_amount_paise or p_refund_status = 'failed') then
      update private.production_payment_orders set review_required = true where id in (p_order_id,existing.order_id);
    elsif p_refund_status = 'processed' then
      select coalesce(sum(amount_paise),0) into refund_total from private.production_payment_effects where order_id = p_order_id and kind = 'refund' and provider_id <> p_refund_id;
      if refund_total + p_refund_amount_paise > 1000000 then
        update private.production_payment_orders set review_required = true where id = p_order_id;
      else
        insert into private.production_payment_effects(account_id,kind,provider_id,payment_id,order_id,amount_paise,snapshot_hash)
          values(p_account_id,'refund',p_refund_id,p_payment_id,p_order_id,p_refund_amount_paise,p_snapshot_hash) on conflict do nothing;
        update private.production_payment_orders set refunded_paise = refund_total + p_refund_amount_paise where id = p_order_id;
      end if;
    end if;
  end if;
  select * into saved from private.production_payment_orders where id = p_order_id;
  return to_jsonb(saved);
end;
$$;

revoke all on function public.production_payment_order_claim(uuid,uuid,uuid,uuid,text,text,jsonb,text,text,uuid) from public,anon,authenticated;
revoke all on function public.production_payment_order_get(uuid,uuid) from public,anon,authenticated;
revoke all on function public.production_payment_order_result(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.production_payment_event_receive(text,text,uuid,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.production_payment_observe(uuid,text,text,text,boolean,bigint,boolean,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.production_payment_order_claim(uuid,uuid,uuid,uuid,text,text,jsonb,text,text,uuid) to service_role;
grant execute on function public.production_payment_order_get(uuid,uuid) to service_role;
grant execute on function public.production_payment_order_result(uuid,text,text,text) to service_role;
grant execute on function public.production_payment_event_receive(text,text,uuid,text,text,text,text,text,text) to service_role;
grant execute on function public.production_payment_observe(uuid,text,text,text,boolean,bigint,boolean,text,text,bigint,text) to service_role;

create table if not exists private.production_payment_operators (
  user_id uuid primary key references auth.users(id) on delete restrict,
  approval_reference uuid not null,
  can_refund boolean not null default false,
  expires_at timestamptz not null check (isfinite(expires_at)),
  revoked_at timestamptz
);
create table if not exists private.production_payment_refunds (
  id uuid primary key,
  order_id uuid not null references private.production_payment_orders(id) on delete restrict,
  request_key uuid not null,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approval_reference uuid not null,
  terms_hash text not null check (terms_hash ~ '^[a-f0-9]{64}$'),
  reason text not null check (length(trim(reason)) between 1 and 1000),
  amount_paise bigint not null check (amount_paise between 100 and 1000000),
  state text not null default 'creating' check (state in ('creating','submitted','needs_reconciliation','processed','failed')),
  provider_refund_id text check (provider_refund_id ~ '^rfnd_[A-Za-z0-9]{1,100}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique(order_id,request_key),
  unique(order_id,provider_refund_id)
);
alter table private.production_payment_operators enable row level security;
alter table private.production_payment_refunds enable row level security;
revoke all on private.production_payment_operators,private.production_payment_refunds from public,anon,authenticated,service_role;

create or replace function public.production_payment_operator_allowed(p_user_id uuid,p_refund boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.production_payment_operators where user_id = p_user_id and revoked_at is null
    and expires_at > clock_timestamp() and (not p_refund or can_refund));
$$;

create or replace function public.production_payment_refund_claim(
  p_order_id uuid,p_account_id text,p_key_id text,p_actor_id uuid,p_request_key uuid,p_refund_id uuid,
  p_amount_paise bigint,p_terms_hash text,p_approval_reference uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved private.production_payment_orders;
  refund private.production_payment_refunds;
  outstanding bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:' || p_account_id,0));
  if not public.production_payment_operator_allowed(p_actor_id,true) then raise exception 'Refund operator not authorized' using errcode = '42501'; end if;
  select * into saved from private.production_payment_orders where id = p_order_id and account_id = p_account_id and key_id = p_key_id for update;
  if not found then raise exception 'Payment order not found' using errcode = '23514'; end if;
  select * into refund from private.production_payment_refunds where order_id = p_order_id and request_key = p_request_key;
  if found then
    if refund.approved_by is distinct from p_actor_id or refund.terms_hash is distinct from p_terms_hash
      or refund.approval_reference is distinct from p_approval_reference or refund.reason is distinct from p_reason
      or refund.amount_paise is distinct from p_amount_paise then raise exception 'Refund request conflict' using errcode = '23514'; end if;
    return jsonb_build_object('claimed',false,'refund',to_jsonb(refund));
  end if;
  select coalesce(sum(amount_paise),0) into outstanding from private.production_payment_refunds
    where order_id = p_order_id and state in ('creating','submitted','needs_reconciliation');
  if saved.review_required or saved.captured_paise <> saved.amount_paise or saved.payment_id is null or outstanding > 0
    or p_terms_hash is distinct from saved.terms_hash or p_amount_paise is null
    or p_amount_paise > saved.captured_paise - greatest(saved.refunded_paise,saved.provider_refunded_paise)
    or exists(select 1 from private.production_payment_events where account_id = p_account_id
      and (payment_id = saved.payment_id or provider_order_id = saved.provider_order_id) and processed_at is null and kind in ('refund','dispute')) then
    raise exception 'Refund needs reconciliation or approved policy' using errcode = '23514';
  end if;
  insert into private.production_payment_refunds(id,order_id,request_key,approved_by,approval_reference,terms_hash,reason,amount_paise)
    values(p_refund_id,p_order_id,p_request_key,p_actor_id,p_approval_reference,p_terms_hash,p_reason,p_amount_paise) returning * into refund;
  update private.production_payment_orders set refund_hold = true, updated_at = clock_timestamp() where id = p_order_id;
  return jsonb_build_object('claimed',true,'refund',to_jsonb(refund));
end;
$$;

create or replace function public.production_payment_refund_result(p_refund_id uuid,p_account_id text,p_key_id text,p_provider_refund_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare refund private.production_payment_refunds;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:' || p_account_id,0));
  select operation.* into refund from private.production_payment_refunds operation
    join private.production_payment_orders payment_order on payment_order.id = operation.order_id
    where operation.id = p_refund_id and payment_order.account_id = p_account_id and payment_order.key_id = p_key_id for update of operation;
  if not found then raise exception 'Refund not found' using errcode = '23514'; end if;
  if p_provider_refund_id is null then
    update private.production_payment_refunds set state = case when provider_refund_id is null then 'needs_reconciliation' else state end
      where id = p_refund_id returning * into refund;
  elsif refund.provider_refund_id is not null and refund.provider_refund_id <> p_provider_refund_id then
    update private.production_payment_orders set review_required = true where id = refund.order_id;
  else
    update private.production_payment_refunds set provider_refund_id = p_provider_refund_id,
      state = case when state in ('processed','failed') then state else 'submitted' end where id = p_refund_id returning * into refund;
  end if;
  return to_jsonb(refund);
end;
$$;

create or replace function public.production_payment_refund_observed(
  p_refund_id uuid,p_account_id text,p_provider_refund_id text,p_amount_paise bigint,p_status text
) returns void language plpgsql security definer set search_path = '' as $$
declare refund private.production_payment_refunds;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('production-payments:' || p_account_id,0));
  select operation.* into refund from private.production_payment_refunds operation
    join private.production_payment_orders payment_order on payment_order.id = operation.order_id
    where operation.id = p_refund_id and payment_order.account_id = p_account_id for update of operation;
  if not found then raise exception 'Refund not found' using errcode = '23514'; end if;
  if refund.provider_refund_id is distinct from p_provider_refund_id or refund.amount_paise is distinct from p_amount_paise
    or p_status is null or p_status not in ('pending','processed','failed')
    or (refund.state in ('processed','failed') and p_status in ('processed','failed') and refund.state <> p_status) then
    update private.production_payment_orders set review_required = true where id = refund.order_id;
  elsif p_status = 'processed' then
    if exists(select 1 from private.production_payment_effects where order_id = refund.order_id and kind = 'refund'
      and provider_id = p_provider_refund_id and amount_paise = p_amount_paise) then
      update private.production_payment_refunds set state = 'processed' where id = p_refund_id;
    else raise exception 'Refund effect not recorded' using errcode = '23514'; end if;
  elsif p_status = 'failed' then
    update private.production_payment_refunds set state = 'failed' where id = p_refund_id;
  end if;
end;
$$;

create or replace function public.production_payment_orders_list(p_business_id uuid,p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(owned_order)),'[]'::jsonb) from (
    select payment_order.* from private.production_payment_orders payment_order
      join public.businesses business on business.id = payment_order.business_id
      where payment_order.business_id = p_business_id and payment_order.user_id = p_user_id and business.owner_id = p_user_id
      order by payment_order.accepted_at desc limit 20
  ) owned_order;
$$;

create or replace function public.production_payment_recovery(
  p_account_id text,p_key_id text,p_order_id uuid default null,p_provider_order_id text default null
) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('order',to_jsonb(payment_order),'refunds',coalesce((select jsonb_agg(to_jsonb(refund))
    from private.production_payment_refunds refund where order_id = payment_order.id),'[]'::jsonb),
    'refundIds',coalesce((select jsonb_agg(provider_id) from private.production_payment_effects where order_id = payment_order.id and kind = 'refund'),'[]'::jsonb))
  from private.production_payment_orders payment_order where account_id = p_account_id and key_id = p_key_id
    and ((p_order_id is not null and p_provider_order_id is null and id = p_order_id)
      or (p_order_id is null and p_provider_order_id is not null and provider_order_id = p_provider_order_id));
$$;

create or replace function public.production_payment_events_pending(p_account_id text,p_key_id text,p_order_id uuid default null,p_after_event_id text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(pending)),'[]'::jsonb) from (
    select event.* from private.production_payment_events event where account_id = p_account_id and key_id = p_key_id and processed_at is null
      and (p_after_event_id is null or (event.received_at,event.event_id) > (select cursor_event.received_at,cursor_event.event_id
        from private.production_payment_events cursor_event where cursor_event.account_id = p_account_id and cursor_event.event_id = p_after_event_id))
      and (p_order_id is null or exists(select 1 from private.production_payment_orders where id = p_order_id and account_id = p_account_id
        and (provider_order_id = event.provider_order_id or payment_id = event.payment_id)))
      order by received_at,event_id limit 25
  ) pending;
$$;

create or replace function public.production_payment_event_processed(p_account_id text,p_event_id text,p_payload_hash text)
returns void language sql security definer set search_path = '' as $$
  update private.production_payment_events set processed_at = clock_timestamp()
    where account_id = p_account_id and event_id = p_event_id and payload_hash = p_payload_hash and not conflicted;
$$;

revoke all on function public.production_payment_operator_allowed(uuid,boolean) from public,anon,authenticated;
revoke all on function public.production_payment_refund_claim(uuid,text,text,uuid,uuid,uuid,bigint,text,uuid,text) from public,anon,authenticated;
revoke all on function public.production_payment_refund_result(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.production_payment_refund_observed(uuid,text,text,bigint,text) from public,anon,authenticated;
revoke all on function public.production_payment_orders_list(uuid,uuid) from public,anon,authenticated;
revoke all on function public.production_payment_recovery(text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.production_payment_events_pending(text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.production_payment_event_processed(text,text,text) from public,anon,authenticated;
grant execute on function public.production_payment_operator_allowed(uuid,boolean) to service_role;
grant execute on function public.production_payment_refund_claim(uuid,text,text,uuid,uuid,uuid,bigint,text,uuid,text) to service_role;
grant execute on function public.production_payment_refund_result(uuid,text,text,text) to service_role;
grant execute on function public.production_payment_refund_observed(uuid,text,text,bigint,text) to service_role;
grant execute on function public.production_payment_orders_list(uuid,uuid) to service_role;
grant execute on function public.production_payment_recovery(text,text,uuid,text) to service_role;
grant execute on function public.production_payment_events_pending(text,text,uuid,text) to service_role;
grant execute on function public.production_payment_event_processed(text,text,text) to service_role;

create or replace function public.production_payment_event_get(p_account_id text,p_key_id text,p_event_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(event) from private.production_payment_events event
    where account_id = p_account_id and key_id = p_key_id and event_id = p_event_id;
$$;
create or replace function public.production_payment_order_review(p_order_id uuid,p_account_id text,p_key_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.production_payment_orders;
begin
  update private.production_payment_orders set review_required = true,updated_at = clock_timestamp()
    where id = p_order_id and account_id = p_account_id and key_id = p_key_id returning * into saved;
  if not found then raise exception 'Payment order not found' using errcode = '23514'; end if;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.production_payment_event_get(text,text,text) from public,anon,authenticated;
revoke all on function public.production_payment_order_review(uuid,text,text) from public,anon,authenticated;
grant execute on function public.production_payment_event_get(text,text,text) to service_role;
grant execute on function public.production_payment_order_review(uuid,text,text) to service_role;