begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #680: link each synced Meta lead to the AdBrain campaign it came from, so a run's form leads
-- (the lead-form arm of the WhatsApp vs form A/B) can be counted. The sync now sends Meta's
-- campaign id per lead; it is matched to this business's campaign. A re-sync fills the link on
-- leads stored before this change (only when it is still empty). `imported` counts new leads only.
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
      select p_business_id, campaign.id, incoming.meta_lead_id, incoming.form_id, incoming.form_name,
        incoming.full_name, incoming.phone, incoming.email, incoming.city, coalesce(incoming.field_data, '{}'), incoming.created_time
      from jsonb_to_recordset(p_rows) as incoming(meta_lead_id text, meta_campaign_id text, form_id text, form_name text,
        full_name text, phone text, email text, city text, field_data jsonb, created_time timestamptz)
      left join public.campaigns campaign
        on campaign.business_id = p_business_id and campaign.meta_campaign_id = incoming.meta_campaign_id
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
