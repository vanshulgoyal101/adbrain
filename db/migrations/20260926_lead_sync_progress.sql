create table if not exists public.lead_sync_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  generation bigint not null,
  ad_account_id text not null,
  page_id text not null,
  state text not null default 'partial' check (state in ('partial', 'complete')),
  version bigint not null default 0 check (version >= 0),
  progress jsonb not null default '{"formsDone":false,"formsAfter":null,"formsSeen":[],"formIds":[],"pending":[],"discover":true}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(progress) = 'object')
);
create index if not exists lead_sync_runs_business_idx on public.lead_sync_runs(business_id, created_at desc);
alter table public.lead_sync_runs enable row level security;
revoke all on public.lead_sync_runs from public, anon, authenticated;
grant select, insert, update on public.lead_sync_runs to service_role;

create or replace function public.lead_sync_start(
  p_business_id uuid, p_owner_id uuid, p_sync_id uuid,
  p_generation bigint, p_ad_account_id text, p_page_id text
) returns setof public.lead_sync_runs
language plpgsql security invoker set search_path = public
as $$
declare current_run public.lead_sync_runs;
begin
  perform 1 from public.businesses where id = p_business_id and owner_id = p_owner_id for update;
  if not found then raise exception 'Business unavailable' using errcode = '42501'; end if;
  perform 1 from public.meta_connections where business_id = p_business_id
    and generation = p_generation and ad_account_id = p_ad_account_id and page_id = p_page_id
    and authorization_status = 'connected' for share;
  if not found then raise exception 'Meta binding changed' using errcode = '40001'; end if;
  if p_sync_id is not null then
    select * into current_run from public.lead_sync_runs
      where id = p_sync_id and business_id = p_business_id and owner_id = p_owner_id for update;
    if not found then raise exception 'Sync unavailable' using errcode = 'P0002'; end if;
    if current_run.generation <> p_generation or current_run.ad_account_id <> p_ad_account_id or current_run.page_id <> p_page_id then
      raise exception 'Sync binding changed; start a fresh sync' using errcode = '40001';
    end if;
  else
    select * into current_run from public.lead_sync_runs
      where business_id = p_business_id and owner_id = p_owner_id and generation = p_generation
        and ad_account_id = p_ad_account_id and page_id = p_page_id and state = 'partial'
      order by created_at desc limit 1 for update;
    if not found then
      insert into public.lead_sync_runs(business_id, owner_id, generation, ad_account_id, page_id)
        values (p_business_id, p_owner_id, p_generation, p_ad_account_id, p_page_id) returning * into current_run;
    end if;
  end if;
  return next current_run;
end
$$;

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
  insert into public.leads(business_id, meta_lead_id, form_id, form_name, full_name, phone, email, city, field_data, created_time)
    select p_business_id, incoming.meta_lead_id, incoming.form_id, incoming.form_name,
      incoming.full_name, incoming.phone, incoming.email, incoming.city, coalesce(incoming.field_data, '{}'), incoming.created_time
    from jsonb_to_recordset(p_rows) as incoming(meta_lead_id text, form_id text, form_name text,
      full_name text, phone text, email text, city text, field_data jsonb, created_time timestamptz)
    on conflict (business_id, meta_lead_id) do nothing;
  get diagnostics inserted_count = row_count;
  update public.lead_sync_runs set progress = p_progress, version = version + 1, updated_at = now(),
    state = case when (p_progress->>'formsDone')::boolean and jsonb_array_length(p_progress->'pending') = 0 then 'complete' else 'partial' end
    where id = current_run.id returning * into current_run;
  return jsonb_build_object('run', to_jsonb(current_run), 'imported', inserted_count);
end
$$;

revoke all on function public.lead_sync_start(uuid, uuid, uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function public.lead_sync_checkpoint(uuid, uuid, uuid, bigint, text, text, bigint, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.lead_sync_start(uuid, uuid, uuid, bigint, text, text) to service_role;
grant execute on function public.lead_sync_checkpoint(uuid, uuid, uuid, bigint, text, text, bigint, jsonb, jsonb) to service_role;