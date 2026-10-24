begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #274: Supabase pg_cron + pg_net call the existing CRON_SECRET routes on time (GitHub's
-- 15-minute schedule fired every few hours). The secret lives only in Supabase Vault as
-- `adbrain_cron_secret`, loaded once by DevOps (docs/OPERATIONS.md#scheduled-jobs). Without
-- it every call is a no-op. Databases that do not preload pg_cron and pg_net (CI, local)
-- get the helper but no schedule.
create or replace function private.call_cron_route(p_path text)
returns bigint language plpgsql set search_path = '' as $fn$
declare
  v_secret text;
begin
  if p_path !~ '^/api/cron/[a-z-]+$' or to_regclass('vault.decrypted_secrets') is null then return null; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'adbrain_cron_secret';
  if v_secret is null then return null; end if;
  return net.http_get(
    url := 'https://adbrain.vanshul.com' || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 70000
  );
end;
$fn$;
revoke all on function private.call_cron_route(text) from public, anon, authenticated, service_role;

do $do$
declare
  v_preload text := coalesce(current_setting('shared_preload_libraries', true), '');
begin
  if v_preload !~ '\mpg_cron\M' or v_preload !~ '\mpg_net\M' then
    raise notice 'pg_cron or pg_net is not preloaded; scheduled jobs are not installed (#274).';
    return;
  end if;
  create extension if not exists pg_cron with schema pg_catalog;
  create extension if not exists pg_net with schema extensions;
  -- cron.schedule replaces a job with the same name, so reapplying is safe.
  perform cron.schedule('adbrain-enforce-spend', '*/15 * * * *', $job$select private.call_cron_route('/api/cron/enforce-spend')$job$);
  perform cron.schedule('adbrain-sync-leads', '5,20,35,50 * * * *', $job$select private.call_cron_route('/api/cron/sync-leads')$job$);
  perform cron.schedule('adbrain-refresh-results', '10 * * * *', $job$select private.call_cron_route('/api/cron/refresh-results')$job$);
  perform cron.schedule('adbrain-cron-history-cleanup', '40 3 * * *', $job$delete from cron.job_run_details where end_time < now() - interval '7 days'$job$);
end;
$do$;
commit;
