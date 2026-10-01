create table if not exists public.product_event_daily (
  day date not null,
  environment text not null,
  release text not null,
  kind text not null,
  name text not null,
  outcome text not null,
  route text not null,
  action text not null,
  viewport text not null,
  provider text not null,
  model text not null,
  event_count bigint not null check(event_count > 0),
  timed_event_count bigint not null check(timed_event_count >= 0),
  duration_sum_ms bigint not null check(duration_sum_ms >= 0),
  duration_max_ms integer not null check(duration_max_ms >= 0),
  input_tokens numeric not null check(input_tokens >= 0),
  output_tokens numeric not null check(output_tokens >= 0),
  total_tokens numeric not null check(total_tokens >= 0),
  estimated_cost_usd numeric not null check(estimated_cost_usd >= 0),
  item_count numeric not null check(item_count >= 0),
  failed_item_count numeric not null check(failed_item_count >= 0),
  primary key(day,environment,release,kind,name,outcome,route,action,viewport,provider,model)
);

alter table public.product_event_daily enable row level security;
revoke all on public.product_event_daily from public,anon,authenticated,service_role;
grant select on public.product_event_daily to service_role;

create or replace function public.prune_product_events()
returns integer language plpgsql security definer set search_path = '' as $$
declare removed_count integer;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('adbrain:product-event-retention',0)) then return 0; end if;
  with expired as (
    select event_id from public.product_events
    where created_at < now() - interval '90 days'
    order by created_at,event_id limit 10000 for update skip locked
  ), removed as (
    delete from public.product_events event using expired
    where event.event_id=expired.event_id returning event.*
  ), rolled_up as (
    insert into public.product_event_daily as daily
      (day,environment,release,kind,name,outcome,route,action,viewport,provider,model,
       event_count,timed_event_count,duration_sum_ms,duration_max_ms,input_tokens,output_tokens,total_tokens,
       estimated_cost_usd,item_count,failed_item_count)
    select (created_at at time zone 'UTC')::date,
      coalesce(attributes->>'environment','unknown'),coalesce(attributes->>'release',''),kind,name,outcome,
      coalesce(attributes->>'route',''),coalesce(attributes->>'action',''),coalesce(attributes->>'viewport',''),
      coalesce(attributes->>'provider',''),coalesce(attributes->>'model',''),
      count(*),count(duration_ms),coalesce(sum(duration_ms),0),coalesce(max(duration_ms),0),
      sum(case when jsonb_typeof(attributes->'inputTokens')='number' then greatest((attributes->>'inputTokens')::numeric,0) else 0 end),
      sum(case when jsonb_typeof(attributes->'outputTokens')='number' then greatest((attributes->>'outputTokens')::numeric,0) else 0 end),
      sum(case when jsonb_typeof(attributes->'totalTokens')='number' then greatest((attributes->>'totalTokens')::numeric,0) else 0 end),
      sum(case when jsonb_typeof(attributes->'estimatedCostUsd')='number' then greatest((attributes->>'estimatedCostUsd')::numeric,0) else 0 end),
      sum(case when jsonb_typeof(attributes->'count')='number' then greatest((attributes->>'count')::numeric,0) else 0 end),
      sum(case when jsonb_typeof(attributes->'failedCount')='number' then greatest((attributes->>'failedCount')::numeric,0) else 0 end)
    from removed where (created_at at time zone 'UTC')::date >= (now() at time zone 'UTC')::date - 730
    group by 1,2,3,4,5,6,7,8,9,10,11
    on conflict(day,environment,release,kind,name,outcome,route,action,viewport,provider,model) do update set
      event_count=daily.event_count+excluded.event_count,
      timed_event_count=daily.timed_event_count+excluded.timed_event_count,
      duration_sum_ms=daily.duration_sum_ms+excluded.duration_sum_ms,
      duration_max_ms=greatest(daily.duration_max_ms,excluded.duration_max_ms),
      input_tokens=daily.input_tokens+excluded.input_tokens,
      output_tokens=daily.output_tokens+excluded.output_tokens,
      total_tokens=daily.total_tokens+excluded.total_tokens,
      estimated_cost_usd=daily.estimated_cost_usd+excluded.estimated_cost_usd,
      item_count=daily.item_count+excluded.item_count,
      failed_item_count=daily.failed_item_count+excluded.failed_item_count
    returning 1
  ) select count(*) into removed_count from removed;
  delete from public.product_event_daily where ctid in (
    select ctid from public.product_event_daily
    where day < (now() at time zone 'UTC')::date - 730
    order by day limit 10000 for update skip locked
  );
  return removed_count;
end;
$$;

revoke all on function public.prune_product_events() from public,anon,authenticated;
grant execute on function public.prune_product_events() to service_role;