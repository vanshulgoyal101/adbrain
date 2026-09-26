create table if not exists private.razorpay_test_orders (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  request_key uuid not null,
  account_id text not null check (account_id ~ '^acc_[A-Za-z0-9]{1,100}$'),
  key_id text not null check (key_id ~ '^rzp_test_[A-Za-z0-9]{1,100}$'),
  environment text not null default 'test' check (environment = 'test'),
  amount_paise bigint not null default 1000000 check (amount_paise = 1000000),
  currency text not null default 'INR' check (currency = 'INR'),
  state text not null default 'creating' check (state in ('creating','created','captured','needs_reconciliation')),
  provider_order_id text check (provider_order_id ~ '^order_[A-Za-z0-9]{1,100}$'),
  payment_id text check (payment_id ~ '^pay_[A-Za-z0-9]{1,100}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (business_id, request_key),
  unique (account_id, provider_order_id),
  unique (account_id, payment_id)
);
create table if not exists private.razorpay_test_events (
  account_id text not null,
  event_id text not null check (event_id ~ '^[A-Za-z0-9_:.-]{1,160}$'),
  order_id uuid not null references private.razorpay_test_orders(id) on delete restrict,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  outcome text not null check (outcome in ('pending','captured','needs_reconciliation')),
  received_at timestamptz not null default clock_timestamp(),
  primary key (account_id, event_id)
);
alter table private.razorpay_test_orders enable row level security;
alter table private.razorpay_test_events enable row level security;
revoke all on private.razorpay_test_orders, private.razorpay_test_events from public, anon, authenticated, service_role;

create or replace function public.razorpay_test_order_claim(
  p_business_id uuid, p_user_id uuid, p_request_key uuid, p_order_id uuid, p_account_id text, p_key_id text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved private.razorpay_test_orders;
  inserted boolean;
begin
  if not exists(select 1 from public.businesses where id = p_business_id and owner_id = p_user_id) then
    raise exception 'Invalid test order owner' using errcode = '23514';
  end if;
  insert into private.razorpay_test_orders(id,business_id,user_id,request_key,account_id,key_id)
    values(p_order_id,p_business_id,p_user_id,p_request_key,p_account_id,p_key_id)
    on conflict (business_id,request_key) do nothing returning * into saved;
  inserted := found;
  if not inserted then
    select * into saved from private.razorpay_test_orders where business_id = p_business_id and request_key = p_request_key;
  end if;
  if saved.account_id is distinct from p_account_id or saved.key_id is distinct from p_key_id or saved.user_id is distinct from p_user_id then
    raise exception 'Test order scope changed' using errcode = '23514';
  end if;
  return jsonb_build_object('claimed',inserted,'order',to_jsonb(saved));
end;
$$;

create or replace function public.razorpay_test_order_result(p_order_id uuid, p_provider_order_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.razorpay_test_orders;
begin
  select * into saved from private.razorpay_test_orders where id = p_order_id for update;
  if not found then raise exception 'Test order not found' using errcode = '23514'; end if;
  if saved.state = 'creating' then
    update private.razorpay_test_orders set provider_order_id = p_provider_order_id,
      state = case when p_provider_order_id is null then 'needs_reconciliation' else 'created' end
      where id = p_order_id returning * into saved;
  elsif p_provider_order_id is not null and saved.provider_order_id is distinct from p_provider_order_id then
    raise exception 'Test order result conflict' using errcode = '23514';
  end if;
  return to_jsonb(saved);
end;
$$;

create or replace function public.razorpay_test_order_get(p_order_id uuid, p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(test_order) from private.razorpay_test_orders test_order
    join public.businesses business on business.id = test_order.business_id
    where test_order.id = p_order_id and test_order.user_id = p_user_id and business.owner_id = p_user_id;
$$;

create or replace function public.razorpay_test_order_find(p_provider_order_id text, p_account_id text, p_key_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(test_order) from private.razorpay_test_orders test_order
    where provider_order_id = p_provider_order_id and account_id = p_account_id and key_id = p_key_id;
$$;

create or replace function public.razorpay_test_order_observe(
  p_order_id uuid, p_account_id text, p_key_id text, p_event_id text, p_payload_hash text, p_payment_id text, p_outcome text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved private.razorpay_test_orders;
  existing private.razorpay_test_events;
begin
  if not ((p_event_id ~ '^[A-Za-z0-9_:.-]{1,160}$' and p_payload_hash ~ '^[a-f0-9]{64}$'
    and p_payment_id ~ '^pay_[A-Za-z0-9]{1,100}$' and p_outcome in ('pending','captured','needs_reconciliation')) is true) then
    raise exception 'Invalid test observation' using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('razorpay-test:' || p_account_id,0));
  select * into saved from private.razorpay_test_orders
    where id = p_order_id and account_id = p_account_id and key_id = p_key_id for update;
  if not found or saved.provider_order_id is null then
    raise exception 'Test order is not ready for verification' using errcode = '23514';
  end if;
  select * into existing from private.razorpay_test_events where account_id = p_account_id and event_id = p_event_id;
  if found then
    if existing.order_id <> p_order_id or existing.payload_hash <> p_payload_hash then
      update private.razorpay_test_orders set state = 'needs_reconciliation' where id in (p_order_id,existing.order_id);
      saved.state := 'needs_reconciliation';
      return to_jsonb(saved);
    end if;
  else
    insert into private.razorpay_test_events(account_id,event_id,order_id,payload_hash,outcome)
      values(p_account_id,p_event_id,p_order_id,p_payload_hash,p_outcome);
  end if;
  if p_outcome = 'needs_reconciliation' or (saved.payment_id is not null and saved.payment_id <> p_payment_id and p_outcome = 'captured') then
    update private.razorpay_test_orders set state = 'needs_reconciliation' where id = p_order_id returning * into saved;
  elsif p_outcome = 'captured' and saved.state = 'created' then
    update private.razorpay_test_orders set state = 'captured', payment_id = p_payment_id where id = p_order_id returning * into saved;
  end if;
  return to_jsonb(saved);
end;
$$;

revoke all on function public.razorpay_test_order_claim(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.razorpay_test_order_result(uuid,text) from public,anon,authenticated;
revoke all on function public.razorpay_test_order_get(uuid,uuid) from public,anon,authenticated;
revoke all on function public.razorpay_test_order_find(text,text,text) from public,anon,authenticated;
revoke all on function public.razorpay_test_order_observe(uuid,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.razorpay_test_order_claim(uuid,uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.razorpay_test_order_result(uuid,text) to service_role;
grant execute on function public.razorpay_test_order_get(uuid,uuid) to service_role;
grant execute on function public.razorpay_test_order_find(text,text,text) to service_role;
grant execute on function public.razorpay_test_order_observe(uuid,text,text,text,text,text,text) to service_role;