begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

drop policy if exists "llm_usage_events: insert own business" on public.llm_usage_events;
revoke all on public.llm_usage_events from public, anon, authenticated;
grant select on public.llm_usage_events to authenticated;
grant select, insert on public.llm_usage_events to service_role;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'llm_usage_nonnegative'
    and conrelid = 'public.llm_usage_events'::regclass) then
    alter table public.llm_usage_events add constraint llm_usage_nonnegative
      check (prompt_tokens >= 0 and completion_tokens >= 0 and total_tokens >= 0
        and estimated_cost_usd >= 0) not valid;
  end if;
end $$;

create or replace function public.monthly_token_usage(p_business_id uuid, p_since timestamptz)
returns bigint language sql stable security invoker set search_path = public
as $$
  select coalesce(sum(greatest(total_tokens, 0)), 0)::bigint
  from public.llm_usage_events
  where business_id = p_business_id and created_at >= p_since;
$$;
revoke all on function public.monthly_token_usage(uuid, timestamptz) from public, anon;
grant execute on function public.monthly_token_usage(uuid, timestamptz) to authenticated, service_role;

create or replace function public.check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_ms integer
)
returns table(allowed boolean, retry_after_ms integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window interval;
  v_count integer;
  v_oldest timestamptz;
  v_now timestamptz;
begin
  if p_key is null or length(p_key) not between 1 and 512
    or p_limit is null or p_limit not between 1 and 10000
    or p_window_ms is null or p_window_ms not between 1 and 3600000 then
    raise exception 'Invalid rate limit parameters' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_key, 0));
  v_now := clock_timestamp();
  v_window := make_interval(secs => p_window_ms / 1000.0);
  delete from public.rate_limit_hits where hit_at < v_now - interval '1 hour';
  select count(*), min(hit_at) into v_count, v_oldest
    from public.rate_limit_hits
    where key = p_key and hit_at > v_now - v_window;
  if v_count >= p_limit then
    return query select false,
      greatest(1, ceil(extract(epoch from (v_oldest + v_window - v_now)) * 1000))::integer;
  else
    insert into public.rate_limit_hits(key, hit_at) values (p_key, v_now);
    return query select true, 0;
  end if;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
commit;