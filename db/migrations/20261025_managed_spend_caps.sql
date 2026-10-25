begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #522 (2-Tier, #518): one writer at a time per managed child ad account for its Meta spending
-- limit. A payment, refund or hold event marks the limit stale (`dirty`) and claims the writer
-- lease if it is free; the holder clears `dirty` at the start of each pass and, if another event
-- arrived during the pass, runs again with fresh figures before releasing. So the last limit
-- written always comes from the latest balance, and a stale, higher limit never lands last.
-- The last decision gates activation: none, or one without room, means no new delivery.
create table if not exists private.managed_spend_caps (
  ad_account_id text primary key check (ad_account_id ~ '^act_[0-9]{1,24}$'),
  business_id uuid not null references public.businesses(id) on delete restrict,
  dirty boolean not null default true,
  lease_token uuid,
  lease_until timestamptz,
  action text,
  cap_paise bigint check (cap_paise between 0 and 9007199254740991),
  room_paise bigint check (room_paise between 0 and 9007199254740991),
  decided_at timestamptz,
  check ((lease_token is null) = (lease_until is null)),
  check (
    (action is null and cap_paise is null and room_paise is null and decided_at is null)
    or (decided_at is not null and (
      (action in ('set', 'keep') and room_paise > 0 and cap_paise >= room_paise)
      or (action = 'freeze' and room_paise = 0 and cap_paise > 0)
      or (action = 'stop' and room_paise = 0))))
);
create index if not exists managed_spend_caps_business_idx on private.managed_spend_caps(business_id);
alter table private.managed_spend_caps enable row level security;
revoke all on private.managed_spend_caps from public, anon, authenticated, service_role;

create or replace function private.managed_spend_cap_owned(p_business_id uuid, p_ad_account_id text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.managed_meta_accounts
      where business_id = p_business_id and ad_account_id = p_ad_account_id) then
    raise exception 'Managed ad account not found' using errcode = '42501';
  end if;
end;
$$;

-- Marks the limit stale and claims the writer lease if it is free. True: the caller writes.
create or replace function public.managed_spend_cap_request(p_business_id uuid, p_ad_account_id text, p_token uuid, p_lease_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare claimed boolean;
begin
  if p_token is null or p_lease_seconds is null or p_lease_seconds not between 10 and 600 then
    raise exception 'Invalid spending limit lease' using errcode = '22023';
  end if;
  perform private.managed_spend_cap_owned(p_business_id, p_ad_account_id);
  insert into private.managed_spend_caps(ad_account_id, business_id) values (p_ad_account_id, p_business_id)
    on conflict (ad_account_id) do update set dirty = true;
  update private.managed_spend_caps
    set lease_token = p_token, lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds)
    where ad_account_id = p_ad_account_id and (lease_until is null or lease_until < clock_timestamp())
    returning true into claimed;
  return coalesce(claimed, false);
end;
$$;

-- Starts a pass for the lease holder: clears the stale mark and the last decision, so nothing
-- activates on an old decision while the pass runs or after it dies unfinished. False: the lease was lost.
create or replace function public.managed_spend_cap_begin(p_ad_account_id text, p_token uuid, p_lease_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare ok boolean;
begin
  if p_lease_seconds is null or p_lease_seconds not between 10 and 600 then
    raise exception 'Invalid spending limit lease' using errcode = '22023';
  end if;
  update private.managed_spend_caps
    set dirty = false, lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
      action = null, cap_paise = null, room_paise = null, decided_at = null
    where ad_account_id = p_ad_account_id and lease_token = p_token and lease_until > clock_timestamp()
    returning true into ok;
  return coalesce(ok, false);
end;
$$;

-- Records the pass's decision. True: an event arrived during the pass, so the holder keeps the
-- lease and runs again; false: the lease is released.
create or replace function public.managed_spend_cap_finish(p_ad_account_id text, p_token uuid, p_action text,
  p_cap_paise bigint, p_room_paise bigint, p_lease_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare current private.managed_spend_caps;
begin
  if p_action is null or p_action not in ('set', 'keep', 'freeze', 'stop')
    or p_lease_seconds is null or p_lease_seconds not between 10 and 600 then
    raise exception 'Invalid spending limit decision' using errcode = '22023';
  end if;
  select * into current from private.managed_spend_caps where ad_account_id = p_ad_account_id for update;
  if not found or current.lease_token is distinct from p_token then
    raise exception 'Spending limit lease lost' using errcode = '55000';
  end if;
  update private.managed_spend_caps set
    action = p_action, cap_paise = p_cap_paise, room_paise = p_room_paise, decided_at = clock_timestamp(),
    lease_token = case when current.dirty then p_token end,
    lease_until = case when current.dirty then clock_timestamp() + make_interval(secs => p_lease_seconds) end
    where ad_account_id = p_ad_account_id;
  return current.dirty;
end;
$$;

-- A failed pass: release the lease, keep the limit stale for the next sweep, and drop the last
-- decision so nothing activates on it. A caller that no longer holds the lease changes nothing.
create or replace function public.managed_spend_cap_abandon(p_ad_account_id text, p_token uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update private.managed_spend_caps set dirty = true, lease_token = null, lease_until = null,
    action = null, cap_paise = null, room_paise = null, decided_at = null
    where ad_account_id = p_ad_account_id and lease_token = p_token;
end;
$$;

create or replace function public.managed_spend_cap_state(p_business_id uuid, p_ad_account_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare current private.managed_spend_caps;
begin
  perform private.managed_spend_cap_owned(p_business_id, p_ad_account_id);
  select * into current from private.managed_spend_caps where ad_account_id = p_ad_account_id;
  return jsonb_build_object('dirty', coalesce(current.dirty, true),
    'leased', coalesce(current.lease_until > clock_timestamp(), false), 'action', current.action,
    'capPaise', current.cap_paise, 'roomPaise', current.room_paise);
end;
$$;

-- A payment, refund or dispute changed a business's balance: mark its child account's limit stale
-- at once, before the event is processed (QA #560), so activation waits for a fresh limit and the
-- sweep visits it first. Returns the business and its owner when it has a managed child account.
create or replace function public.managed_spend_cap_mark_stale(p_business_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target jsonb;
begin
  select jsonb_build_object('businessId', business.id, 'userId', business.owner_id) into target
    from public.managed_meta_accounts managed join public.businesses business on business.id = managed.business_id
    where managed.business_id = p_business_id and managed.ad_account_id is not null and managed.state <> 'offboarded';
  if target is null then return null; end if;
  insert into private.managed_spend_caps(ad_account_id, business_id)
    select ad_account_id, business_id from public.managed_meta_accounts where business_id = p_business_id
    on conflict (ad_account_id) do update set dirty = true;
  return target;
end;
$$;

-- The same for a payment event, before AdBrain knows its order: matched by payment or provider order.
create or replace function public.managed_spend_cap_mark_payment_stale(p_account_id text, p_payment_id text, p_provider_order_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare business uuid;
begin
  select payment.business_id into business from private.production_payment_orders payment
    where payment.account_id = p_account_id
      and (payment.payment_id = p_payment_id or (p_provider_order_id is not null and payment.provider_order_id = p_provider_order_id))
    -- A payment or provider order belongs to one order, so to one business.
    order by payment.id limit 1;
  if business is null then return null; end if;
  return public.managed_spend_cap_mark_stale(business);
end;
$$;

-- The sweep's order: stale limits first, then the oldest decision, so a run cut short by its time
-- budget is picked up where it stopped.
create or replace function public.managed_spend_cap_due(p_limit integer)
returns table(business_id uuid) language sql stable security definer set search_path = '' as $$
  select managed.business_id from public.managed_meta_accounts managed
    left join private.managed_spend_caps cap on cap.ad_account_id = managed.ad_account_id
    where managed.ad_account_id is not null and managed.state <> 'offboarded'
    order by coalesce(cap.dirty, true) desc, cap.decided_at asc nulls first, managed.business_id
    limit least(greatest(coalesce(p_limit, 0), 0), 1000);
$$;

-- AdBrain's attributed media for this tenant under one payment account: on the child account,
-- and on any other ad account (it counts against the same prepaid ad share).
create or replace function public.managed_spend_cap_inputs(p_business_id uuid, p_ad_account_id text, p_account_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.managed_spend_cap_owned(p_business_id, p_ad_account_id);
  select jsonb_build_object(
      'mediaThisAccountPaise', coalesce(sum(cost.media_paise) filter (where cost.ad_account_id = p_ad_account_id), 0),
      'mediaOtherAccountsPaise', coalesce(sum(cost.media_paise) filter (where cost.ad_account_id <> p_ad_account_id), 0),
      'taxRateBps', coalesce(max(cost.tax_rate_bps), 0))
    into result
    from private.customer_ad_costs cost
    where cost.business_id = p_business_id and cost.account_id = p_account_id;
  return result;
end;
$$;

revoke all on function private.managed_spend_cap_owned(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.managed_spend_cap_request(uuid, text, uuid, integer),
  public.managed_spend_cap_begin(text, uuid, integer),
  public.managed_spend_cap_finish(text, uuid, text, bigint, bigint, integer),
  public.managed_spend_cap_abandon(text, uuid),
  public.managed_spend_cap_state(uuid, text),
  public.managed_spend_cap_inputs(uuid, text, text),
  public.managed_spend_cap_mark_stale(uuid),
  public.managed_spend_cap_mark_payment_stale(text, text, text),
  public.managed_spend_cap_due(integer) from public, anon, authenticated;
grant execute on function public.managed_spend_cap_request(uuid, text, uuid, integer),
  public.managed_spend_cap_begin(text, uuid, integer),
  public.managed_spend_cap_finish(text, uuid, text, bigint, bigint, integer),
  public.managed_spend_cap_abandon(text, uuid),
  public.managed_spend_cap_state(uuid, text),
  public.managed_spend_cap_inputs(uuid, text, text),
  public.managed_spend_cap_mark_stale(uuid),
  public.managed_spend_cap_mark_payment_stale(text, text, text),
  public.managed_spend_cap_due(integer) to service_role;

commit;
