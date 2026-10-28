begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #1761 (DPDP erasure, #1758): an owner can delete an enquiry, or all enquiries of a campaign. The lead row goes
-- (hard delete); a tombstone keeps only a hash of Meta's lead id, so lead sync never imports it again.
create or replace function public.lead_meta_hash(p_meta_lead_id text)
returns text language sql immutable set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_meta_lead_id, 'UTF8')), 'hex');
$$;

create table if not exists public.lead_tombstones (
  business_id uuid not null references public.businesses(id) on delete cascade,
  meta_lead_hash text not null check (meta_lead_hash ~ '^[0-9a-f]{64}$'),
  deleted_at timestamptz not null default now(),
  primary key (business_id, meta_lead_hash)
);
alter table public.lead_tombstones enable row level security;
revoke all on public.lead_tombstones from public, anon, authenticated;
grant select, insert on public.lead_tombstones to authenticated;
grant select, insert, delete on public.lead_tombstones to service_role;
drop policy if exists "lead_tombstones: read own" on public.lead_tombstones;
create policy "lead_tombstones: read own" on public.lead_tombstones for select using (public.owns_business(business_id));
drop policy if exists "lead_tombstones: add own" on public.lead_tombstones;
create policy "lead_tombstones: add own" on public.lead_tombstones for insert with check (public.owns_business(business_id));

-- Runs as the caller, so RLS keeps it to the owner's own leads. Exactly one of a lead or a campaign.
create or replace function public.leads_erase(p_business_id uuid, p_lead_id uuid default null, p_campaign_id uuid default null)
returns integer language plpgsql security invoker set search_path = '' as $$
declare erased integer;
begin
  if (p_lead_id is null) = (p_campaign_id is null) then
    raise exception 'Name one enquiry or one campaign' using errcode = '22023';
  end if;
  with deleted as (
    delete from public.leads
      where business_id = p_business_id
        and (id = p_lead_id or (p_campaign_id is not null and campaign_id = p_campaign_id))
      returning meta_lead_id
  ), buried as (
    insert into public.lead_tombstones(business_id, meta_lead_hash)
      select p_business_id, public.lead_meta_hash(meta_lead_id) from deleted where meta_lead_id is not null
      on conflict do nothing
  )
  select count(*) into erased from deleted;
  return erased;
end
$$;
revoke all on function public.leads_erase(uuid, uuid, uuid) from public, anon;
grant execute on function public.leads_erase(uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.lead_sync_checkpoint(
  p_business_id uuid, p_owner_id uuid, p_sync_id uuid,
  p_generation bigint, p_ad_account_id text, p_page_id text,
  p_version bigint, p_rows jsonb, p_progress jsonb
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare current_run public.lead_sync_runs; inserted_count integer;
begin
  select * into current_run from public.lead_sync_start(p_business_id, p_owner_id, p_sync_id, p_generation, p_ad_account_id, p_page_id);
  if current_run.version <> p_version or current_run.state <> 'partial' then
    raise exception 'Sync progress changed; reload and resume' using errcode = '40001';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200
    or p_progress is null or jsonb_typeof(p_progress) <> 'object'
    or jsonb_typeof(p_progress->'pending') is distinct from 'array'
    or jsonb_typeof(p_progress->'formsDone') is distinct from 'boolean' then
    raise exception 'Invalid sync checkpoint' using errcode = '22023';
  end if;
  with upserted as (
    insert into public.leads(business_id, campaign_id, meta_lead_id, form_id, form_name, full_name, phone, email, city, field_data, created_time)
      -- One row per lead: a batch may repeat a lead, and DO UPDATE can't touch a row twice.
      select distinct on (incoming.meta_lead_id) p_business_id, campaign.id, incoming.meta_lead_id, incoming.form_id, incoming.form_name,
        incoming.full_name, incoming.phone, incoming.email, incoming.city, coalesce(incoming.field_data, '{}'), incoming.created_time
      from jsonb_to_recordset(p_rows) as incoming(meta_lead_id text, meta_campaign_id text, form_id text, form_name text,
        full_name text, phone text, email text, city text, field_data jsonb, created_time timestamptz)
      left join public.campaigns campaign
        on campaign.business_id = p_business_id and campaign.meta_campaign_id = incoming.meta_campaign_id
      -- #1761: an enquiry the owner deleted is never imported again.
      where not exists (select 1 from public.lead_tombstones tombstone
        where tombstone.business_id = p_business_id and tombstone.meta_lead_hash = public.lead_meta_hash(incoming.meta_lead_id))
      order by incoming.meta_lead_id, campaign.id nulls last
      on conflict (business_id, meta_lead_id) do update set campaign_id = excluded.campaign_id
        where leads.campaign_id is null and excluded.campaign_id is not null
      returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted) into inserted_count from upserted;
  update public.lead_sync_runs set progress = p_progress, version = version + 1, updated_at = now(),
    state = case when (p_progress->>'formsDone')::boolean and jsonb_array_length(p_progress->'pending') = 0 then 'complete' else 'partial' end
    where id = current_run.id returning * into current_run;
  return jsonb_build_object('run', to_jsonb(current_run), 'imported', inserted_count);
end
$$;

revoke all on function public.lead_sync_checkpoint(uuid, uuid, uuid, bigint, text, text, bigint, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.lead_sync_checkpoint(uuid, uuid, uuid, bigint, text, text, bigint, jsonb, jsonb) to service_role;

commit;
