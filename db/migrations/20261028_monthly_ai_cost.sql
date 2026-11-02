-- #1717: a business's AI spend this month (text and paid pictures), for the per-business monthly cost cap
-- (AI_MONTHLY_COST_LIMIT_USD). Same pattern as monthly_token_usage: security invoker, so RLS scopes it to the owner.
begin;
set local lock_timeout = '5s';

create or replace function public.monthly_ai_cost_usd(p_business_id uuid, p_since timestamptz)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(greatest(estimated_cost_usd, 0)), 0)::numeric
  from public.llm_usage_events
  where business_id = p_business_id and created_at >= p_since;
$$;
revoke all on function public.monthly_ai_cost_usd(uuid, timestamptz) from public, anon;
grant execute on function public.monthly_ai_cost_usd(uuid, timestamptz) to authenticated, service_role;

commit;
