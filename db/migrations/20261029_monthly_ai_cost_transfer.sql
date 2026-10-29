-- #1997: after a hand-over (#1670), the owner's monthly AI cost starts at the transfer, like monthly_token_usage:
-- the owner never pays for our sales prep. Needs 20261028_business_transfer.sql (transferred_at) and
-- 20261028_monthly_ai_cost.sql.
begin;
set local lock_timeout = '5s';

create or replace function public.monthly_ai_cost_usd(p_business_id uuid, p_since timestamptz)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(greatest(e.estimated_cost_usd, 0)), 0)::numeric
  from public.llm_usage_events e
  where e.business_id = p_business_id
    and e.created_at >= greatest(p_since, coalesce((select b.transferred_at from public.businesses b where b.id = p_business_id), p_since));
$$;
revoke all on function public.monthly_ai_cost_usd(uuid, timestamptz) from public, anon;
grant execute on function public.monthly_ai_cost_usd(uuid, timestamptz) to authenticated, service_role;

commit;
