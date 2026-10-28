-- #718 slice 2 (CEO, Oct 28): own-account businesses pay ₹999 a month through a Razorpay Payment Link, never
-- auto-debit. The first month is free from the first Go live (min(campaigns.launched_at)); it has no row. Each row
-- is one paid month: 'open' while its link waits, 'paid' once Razorpay confirms, 'expired' if the link lapsed.
-- A paid month starts at the later of the last paid-through time and the payment (late payers don't pay for paused
-- days) and lasts one calendar month. Service-only writes through the functions below; owners read their own rows.
begin;
set local lock_timeout = '5s';

create table if not exists public.plan_periods (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  state text not null default 'open' check (state in ('open', 'paid', 'expired')),
  amount_paise integer not null default 99900 check (amount_paise = 99900),
  payment_link_id text unique check (payment_link_id is null or payment_link_id ~ '^plink_[A-Za-z0-9]{1,100}$'),
  short_url text check (short_url is null or (length(short_url) <= 512 and short_url like 'https://%')),
  payment_id text unique check (payment_id is null or payment_id ~ '^pay_[A-Za-z0-9]{1,100}$'),
  starts_at timestamptz,
  ends_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  check ((state = 'paid') = (payment_id is not null and starts_at is not null and ends_at is not null and paid_at is not null)),
  check (ends_at is null or ends_at > starts_at)
);
create unique index if not exists plan_periods_one_open on public.plan_periods(business_id) where state = 'open';
create index if not exists plan_periods_business_ends on public.plan_periods(business_id, ends_at);

alter table public.plan_periods enable row level security;
revoke all on public.plan_periods from public, anon, authenticated, service_role;
grant select on public.plan_periods to authenticated, service_role;
drop policy if exists "plan periods: read own" on public.plan_periods;
create policy "plan periods: read own" on public.plan_periods
  for select to authenticated using (public.owns_business(business_id));

-- The business's one open month (created if none), with its link if it has one.
create or replace function public.plan_period_open(p_business_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare period public.plan_periods;
begin
  insert into public.plan_periods(business_id) values (p_business_id)
    on conflict (business_id) where state = 'open' do nothing;
  select * into strict period from public.plan_periods where business_id = p_business_id and state = 'open';
  return jsonb_build_object('periodId', period.id, 'linkId', period.payment_link_id, 'shortUrl', period.short_url);
end;
$$;

-- Attaches the Razorpay link to an open month once; false if the month already has one or isn't open.
create or replace function public.plan_period_set_link(p_period_id uuid, p_link_id text, p_short_url text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.plan_periods set payment_link_id = p_link_id, short_url = p_short_url
    where id = p_period_id and state = 'open' and payment_link_id is null;
  return found;
end;
$$;

-- Marks the month behind a paid link: 'paid', 'duplicate' (same payment again) or 'ignored' (unknown link,
-- another payment, or not open). Locks the business so two payments can't overlap their months.
create or replace function public.plan_period_paid(p_link_id text, p_payment_id text, p_paid_at timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare period public.plan_periods; paid_through timestamptz; starts timestamptz;
begin
  select * into period from public.plan_periods where payment_link_id = p_link_id;
  if not found then return 'ignored'; end if;
  perform 1 from public.businesses where id = period.business_id for update;
  select * into period from public.plan_periods where id = period.id for update;
  if period.state = 'paid' then return case when period.payment_id = p_payment_id then 'duplicate' else 'ignored' end; end if;
  if period.state <> 'open' then return 'ignored'; end if;
  select greatest(
      coalesce((select min(c.launched_at) from public.campaigns c where c.business_id = period.business_id) + interval '1 month', p_paid_at),
      coalesce((select max(p.ends_at) from public.plan_periods p where p.business_id = period.business_id and p.state = 'paid'), p_paid_at))
    into paid_through;
  starts := greatest(paid_through, p_paid_at);
  update public.plan_periods set state = 'paid', payment_id = p_payment_id, paid_at = p_paid_at,
      starts_at = starts, ends_at = starts + interval '1 month'
    where id = period.id;
  return 'paid';
end;
$$;

-- A link Razorpay expired or cancelled frees the business for a new open month.
create or replace function public.plan_period_expire(p_link_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.plan_periods set state = 'expired' where payment_link_id = p_link_id and state = 'open';
  return found;
end;
$$;

revoke all on function public.plan_period_open(uuid) from public, anon, authenticated;
revoke all on function public.plan_period_set_link(uuid, text, text) from public, anon, authenticated;
revoke all on function public.plan_period_paid(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.plan_period_expire(text) from public, anon, authenticated;
grant execute on function public.plan_period_open(uuid) to service_role;
grant execute on function public.plan_period_set_link(uuid, text, text) to service_role;
grant execute on function public.plan_period_paid(text, text, timestamptz) to service_role;
grant execute on function public.plan_period_expire(text) to service_role;

commit;
