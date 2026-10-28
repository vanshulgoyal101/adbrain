begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #1775 (Reviewer): the sync reads every lead form on the connected Page. When that Page is also bound to another
-- AdBrain business, a lead is imported only if it came from one of *this* business's campaigns; otherwise every
-- business on the Page got every lead (one live Meta lead sat in three workspaces). A business that alone has its
-- Page keeps importing all of its Page's leads, its own boosts and test leads included, as before (#680).
-- Function body only: no table, column or index change. Rollback: re-apply 20261026_lead_campaign_link.sql.
create or replace function public.lead_sync_checkpoint(
  p_business_id uuid, p_owner_id uuid, p_sync_id uuid,
  p_generation bigint, p_ad_account_id text, p_page_id text,
  p_version bigint, p_rows jsonb, p_progress jsonb
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare current_run public.lead_sync_runs; inserted_count integer; shared_page boolean;
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
  -- #1775: a Page bound to another business too is shared, so only leads from this business's own campaigns are its.
  shared_page := exists (select 1 from public.meta_connections other
    where other.page_id = p_page_id and other.business_id <> p_business_id);
  with upserted as (
    insert into public.leads(business_id, campaign_id, meta_lead_id, form_id, form_name, full_name, phone, email, city, field_data, created_time)
      -- One row per lead: a batch may repeat a lead, and DO UPDATE can't touch a row twice.
      select distinct on (incoming.meta_lead_id) p_business_id, campaign.id, incoming.meta_lead_id, incoming.form_id, incoming.form_name,
        incoming.full_name, incoming.phone, incoming.email, incoming.city, coalesce(incoming.field_data, '{}'), incoming.created_time
      from jsonb_to_recordset(p_rows) as incoming(meta_lead_id text, meta_campaign_id text, form_id text, form_name text,
        full_name text, phone text, email text, city text, field_data jsonb, created_time timestamptz)
      left join public.campaigns campaign
        on campaign.business_id = p_business_id and campaign.meta_campaign_id = incoming.meta_campaign_id
      where not shared_page or campaign.id is not null
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
