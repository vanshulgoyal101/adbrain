-- #1568: a provider key parked after a 429 (or a credit refusal) is parked for every server instance, not only the
-- one that saw it, so a fresh serverless instance doesn't hit the limited model again. Server-only (service role).
begin;
set local lock_timeout = '5s';

create table if not exists public.llm_cooldowns (
  key text primary key check (length(key) between 1 and 200),
  until timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.llm_cooldowns enable row level security;
revoke all on table public.llm_cooldowns from public, anon, authenticated;
grant select on table public.llm_cooldowns to service_role;

-- Park a key until p_until (capped at 15 min ahead); a later park never shortens an earlier one.
create or replace function public.park_llm_key(p_key text, p_until timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.llm_cooldowns (key, until, updated_at)
  values (p_key, least(p_until, now() + interval '15 minutes'), now())
  on conflict (key) do update
    set until = greatest(public.llm_cooldowns.until, excluded.until), updated_at = now();
$$;
revoke all on function public.park_llm_key(text, timestamptz) from public, anon, authenticated;
grant execute on function public.park_llm_key(text, timestamptz) to service_role;

commit;
