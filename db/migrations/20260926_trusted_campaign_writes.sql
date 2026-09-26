revoke all on public.campaigns, public.campaign_results, public.audit_log from public, anon, authenticated;
grant select on public.campaigns, public.campaign_results, public.audit_log to authenticated;
revoke delete, truncate on public.businesses from public, anon, authenticated;
revoke all on public.audit_log from service_role;
grant select on public.audit_log to service_role;

alter table public.audit_log add column authority text not null default 'legacy_unverified'
  check (authority in ('legacy_unverified', 'server'));

create or replace function public.append_verified_audit_event(
  p_business_id uuid, p_actor_id uuid, p_action text, p_entity_type text,
  p_entity_id text default null, p_meta_object_id text default null,
  p_reason text default null, p_details jsonb default '{}', p_system_actor text default null
)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  actor_label text;
  event_id uuid;
begin
  if p_actor_id is not null then
    perform 1 from public.businesses where id = p_business_id and owner_id = p_actor_id for share;
    if not found or p_system_actor is not null then
      raise exception 'Audit owner mismatch' using errcode = '42501';
    end if;
    select coalesce(email, 'owner') into actor_label from auth.users where id = p_actor_id;
  else
    if p_system_actor is null or p_system_actor not in ('cron', 'worker') then
      raise exception 'Explicit system identity required' using errcode = '23514';
    end if;
    actor_label := p_system_actor;
  end if;
  insert into public.audit_log(business_id, actor_id, actor_label, action, entity_type,
    entity_id, meta_object_id, reason, details, authority, created_at)
  values (p_business_id, p_actor_id, actor_label, p_action, p_entity_type,
    p_entity_id, p_meta_object_id, p_reason, p_details, 'server', now()) returning id into event_id;
  return event_id;
end;
$$;
revoke all on function public.append_verified_audit_event(uuid, uuid, text, text, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.append_verified_audit_event(uuid, uuid, text, text, text, text, text, jsonb, text) to service_role;