-- #1838 slice 2 (Reviewer, CTO): when Meta throttles us, the scheduled jobs remember it, so the next runs skip that
-- ad account (or every account, for the app-wide limit) until Meta's own estimate says it's over, instead of each
-- call extending the block. Only crons read this; a person's pause or activation is always tried. Additive.
begin;
set local lock_timeout = '5s';

alter table public.meta_connections add column if not exists throttled_until timestamptz;
alter table public.meta_connections add column if not exists throttled_scope text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'meta_connections_throttled_scope_check' and conrelid = 'public.meta_connections'::regclass) then
    alter table public.meta_connections add constraint meta_connections_throttled_scope_check
      check (throttled_scope is null or throttled_scope in ('account', 'page'));
  end if;
end
$$;

-- The app-wide limit (Graph 4) isn't per business: one row per channel (carries over to channel_connections, ADR-001).
create table if not exists private.channel_throttle (
  channel text primary key check (channel = 'meta'),
  throttled_until timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table private.channel_throttle enable row level security;
revoke all on private.channel_throttle from public, anon, authenticated, service_role;

-- Service role: Meta throttled this business's account/Page, or the whole app, until about p_until. A wait is never
-- shortened by a later, smaller estimate, and never set more than a day ahead.
create or replace function public.meta_throttle_record(p_business_id uuid, p_scope text, p_until timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare until_at timestamptz;
begin
  if p_scope is null or p_scope not in ('app', 'account', 'page') or p_until is null then
    raise invalid_parameter_value using message = 'Invalid throttle';
  end if;
  until_at := least(p_until, now() + interval '1 day');
  if p_scope = 'app' then
    insert into private.channel_throttle(channel, throttled_until) values ('meta', until_at)
    on conflict (channel) do update
      set throttled_until = greatest(private.channel_throttle.throttled_until, excluded.throttled_until), updated_at = now();
  else
    update public.meta_connections
    set throttled_until = greatest(coalesce(throttled_until, now()), until_at), throttled_scope = p_scope
    where business_id = p_business_id;
  end if;
end;
$$;
revoke all on function public.meta_throttle_record(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.meta_throttle_record(uuid, text, timestamptz) to service_role;

-- Service role: until when the whole app is throttled, or null.
create or replace function public.meta_app_throttled_until()
returns timestamptz language sql stable security definer set search_path = '' as $$
  select t.throttled_until from private.channel_throttle t where t.channel = 'meta' and t.throttled_until > now();
$$;
revoke all on function public.meta_app_throttled_until() from public, anon, authenticated;
grant execute on function public.meta_app_throttled_until() to service_role;

commit;
