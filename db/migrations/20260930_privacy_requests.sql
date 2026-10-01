create table if not exists public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  kind text not null check (kind in ('export', 'delete')),
  status text not null default 'received' check (status in ('received', 'in_review', 'completed', 'declined')),
  handled_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists privacy_requests_open_idx on public.privacy_requests(owner_id, kind)
  where status in ('received', 'in_review');
create index if not exists privacy_requests_queue_idx on public.privacy_requests(status, created_at);

alter table public.privacy_requests enable row level security;
revoke all on public.privacy_requests from public, anon, authenticated, service_role;
grant select on public.privacy_requests to authenticated;
grant insert(owner_id, kind) on public.privacy_requests to authenticated;
grant select on public.privacy_requests to service_role;
grant update(status, handled_by, updated_at) on public.privacy_requests to service_role;
drop policy if exists "privacy requests: read own" on public.privacy_requests;
create policy "privacy requests: read own" on public.privacy_requests for select to authenticated
  using (owner_id = auth.uid());
drop policy if exists "privacy requests: submit own" on public.privacy_requests;
create policy "privacy requests: submit own" on public.privacy_requests for insert to authenticated
  with check (owner_id = auth.uid() and status = 'received');

create table if not exists private.privacy_request_operators (
  user_id uuid primary key references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table private.privacy_request_operators enable row level security;
revoke all on private.privacy_request_operators from public, anon, authenticated, service_role;

create or replace function public.privacy_request_operator_allowed(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.privacy_request_operators
    where user_id = p_user_id and revoked_at is null);
$$;
revoke all on function public.privacy_request_operator_allowed(uuid) from public, anon, authenticated;
grant execute on function public.privacy_request_operator_allowed(uuid) to service_role;