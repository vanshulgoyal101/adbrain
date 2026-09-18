create index if not exists campaign_operations_worker_pending_idx
  on public.campaign_operations (created_at, id)
  where state = 'pending' and payload->>'execution' = 'worker';

create or replace function public.enqueue_campaign_operation(p_operation_id uuid, p_input jsonb, p_request_hash text)
returns setof public.campaign_operations
language plpgsql security invoker set search_path = public
as $$
declare claimed public.campaign_operations;
begin
  select * into claimed from public.claim_campaign_operation(
    p_operation_id, (p_input->>'businessId')::uuid, (p_input->>'draftId')::uuid,
    (p_input->>'draftVersion')::bigint, (p_input->>'connectionGeneration')::bigint,
    'campaign_create', p_input->>'idempotencyKey', p_request_hash, now() + interval '24 hours',
    jsonb_build_object('execution', 'worker', 'request', p_input), now());
  if not found then return; end if;
  if claimed.id = p_operation_id and claimed.state = 'running' then
    update public.campaign_operations set state = 'pending'
      where id = claimed.id returning * into claimed;
  end if;
  return next claimed;
end
$$;

create or replace function public.claim_next_campaign_job()
returns setof public.campaign_operations
language plpgsql security invoker set search_path = public
as $$
declare selected_id uuid;
begin
  update public.campaign_operations
    set state = case when state = 'pending' then 'failed' else 'needs_reconciliation' end,
        phase = case when state = 'pending' then 'complete' else 'reconcile' end,
        lease_until = null, updated_at = now(),
        sanitized_error = 'Worker deadline expired. Review operation status before retrying.'
    where payload->>'execution' = 'worker' and state in ('pending', 'running') and lease_until <= now();
  select id into selected_id from public.campaign_operations
    where state = 'pending' and payload->>'execution' = 'worker' and lease_until > now()
    order by created_at, id for update skip locked limit 1;
  if not found then return; end if;
  return query update public.campaign_operations
    set state = 'running', lease_until = now() + interval '10 minutes', updated_at = now()
    where id = selected_id and state = 'pending' returning *;
end
$$;

revoke all on function public.enqueue_campaign_operation(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.claim_next_campaign_job() from public, anon, authenticated;
grant execute on function public.enqueue_campaign_operation(uuid, jsonb, text) to service_role;
grant execute on function public.claim_next_campaign_job() to service_role;