begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #1734 (Meta data-deletion request): one service-role call deletes what AdBrain holds from one Meta user,
-- in one transaction. Scope = the businesses that user's tokens were on (CTO, #1734): their tokens and
-- connection attempts go, revoked connections lose their Meta names, and Meta-synced leads, campaign_results
-- and ad_results are deleted. Manual enquiries (no meta_lead_id), billing, brand, creatives and campaigns stay.
-- A business now connected through another person's live token keeps its synced data (that person's consent)
-- and is listed in `kept_businesses`. Re-running it is a no-op.
create or replace function public.meta_subject_purge(p_subject_id text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  scope uuid[]; kept uuid[]; purge uuid[]; token_ids uuid[];
  n_attempts integer; n_connections integer; n_leads integer; n_campaign_results integer;
  n_ad_results integer; n_tokens integer;
begin
  if p_subject_id is null or pg_catalog.btrim(p_subject_id) = '' then
    raise exception 'meta_subject_purge: subject id required' using errcode = '22023';
  end if;
  select coalesce(pg_catalog.array_agg(distinct business_id), '{}'), coalesce(pg_catalog.array_agg(id), '{}')
    into scope, token_ids from private.meta_tokens where subject_id = p_subject_id;
  -- Same lock order as meta_disconnect, so a reconnect can't commit in between.
  perform 1 from public.businesses where id = any(scope) order by id for update;
  perform public.meta_revoke_subject(p_subject_id);

  select coalesce(pg_catalog.array_agg(c.business_id), '{}') into kept
    from public.meta_connections c join private.meta_tokens t on t.id = c.token_id and t.business_id = c.business_id
    where c.business_id = any(scope) and t.revoked_at is null and t.subject_id is distinct from p_subject_id;
  select coalesce(pg_catalog.array_agg(b), '{}') into purge from pg_catalog.unnest(scope) b where b <> all(kept);

  delete from private.meta_connection_attempts
    where token_id = any(token_ids)
       or (business_id = any(purge) and token_id is null and discovered_assets is not null);
  get diagnostics n_attempts = row_count;
  update public.meta_connections
    set token_id = null, ad_account_id = null, page_id = null, meta_business_id = null, account_name = null,
        page_name = null, currency = null, timezone_name = null, selection_reason = null, capabilities = '{}',
        authorization_status = 'revoked', generation = generation + 1, updated_at = pg_catalog.now()
    where business_id = any(purge) and token_id is null
      and (meta_business_id is not null or account_name is not null or page_name is not null
        or ad_account_id is not null or page_id is not null or currency is not null or timezone_name is not null
        or selection_reason is not null or capabilities <> '{}'::jsonb);
  get diagnostics n_connections = row_count;
  delete from public.leads where business_id = any(purge) and meta_lead_id is not null;
  get diagnostics n_leads = row_count;
  delete from public.campaign_results r using public.campaigns c
    where c.id = r.campaign_id and c.business_id = any(purge);
  get diagnostics n_campaign_results = row_count;
  delete from public.ad_results where business_id = any(purge);
  get diagnostics n_ad_results = row_count;
  -- managed_meta_accounts.manager_token_id is set null by its foreign key.
  delete from private.meta_tokens where subject_id = p_subject_id;
  get diagnostics n_tokens = row_count;

  return pg_catalog.jsonb_build_object(
    'businesses', pg_catalog.cardinality(scope), 'tokens', n_tokens, 'attempts', n_attempts,
    'connections', n_connections, 'leads', n_leads, 'campaign_results', n_campaign_results,
    'ad_results', n_ad_results, 'kept_businesses', pg_catalog.to_jsonb(kept));
end;
$$;
revoke all on function public.meta_subject_purge(text) from public, anon, authenticated;
grant execute on function public.meta_subject_purge(text) to service_role;

commit;
