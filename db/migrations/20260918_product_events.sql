create table if not exists public.product_events (
  event_id uuid primary key,
  request_id uuid not null,
  version smallint not null check (version = 1),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  kind text not null check (kind in ('request', 'action', 'workflow', 'system', 'client')),
  name text not null check (length(name) between 1 and 160),
  outcome text not null check (outcome in ('success', 'rejected', 'failed', 'partial', 'started')),
  duration_ms integer check (duration_ms between 0 and 86400000),
  attributes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(attributes) = 'object' and octet_length(attributes::text) <= 4096)
);

create index if not exists product_events_time_idx on public.product_events(created_at);
create index if not exists product_events_user_time_idx on public.product_events(user_id, created_at desc);
create index if not exists product_events_business_time_idx on public.product_events(business_id, created_at desc);
create index if not exists product_events_request_idx on public.product_events(request_id);
create index if not exists product_events_name_time_idx on public.product_events(name, created_at desc);

alter table public.product_events enable row level security;
revoke all on public.product_events from public, anon, authenticated;
grant select, insert, delete on public.product_events to service_role;

create or replace function public.prune_product_events()
returns integer language plpgsql security definer set search_path = public as $$
declare
  removed integer;
begin
  delete from public.product_events where event_id in (
    select event_id from public.product_events
    where created_at < now() - interval '90 days'
    order by created_at limit 10000 for update skip locked
  );
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.prune_product_events() from public, anon, authenticated;
grant execute on function public.prune_product_events() to service_role;