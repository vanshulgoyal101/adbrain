begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #2593: GitHub drops scheduled workflow runs for hours (none 03:45-11:00Z on Nov 2), and the Mac
-- that backfills scheduled-jobs.yml sleeps on battery (#766). pg_cron calls dispatch-workflows every
-- 15 minutes through the #274 helper; the route dispatches an allowlisted workflow only when its last
-- run is overdue, so a slot GitHub does fire is never doubled. The GitHub token stays in Vercel, never here.
do $do$
declare
  v_preload text := coalesce(current_setting('shared_preload_libraries', true), '');
begin
  if v_preload !~ '\mpg_cron\M' or v_preload !~ '\mpg_net\M' then
    raise notice 'pg_cron or pg_net is not preloaded; dispatch-workflows is not scheduled (#2593).';
    return;
  end if;
  -- cron.schedule replaces a job with the same name, so reapplying is safe.
  perform cron.schedule('adbrain-dispatch-workflows', '12,27,42,57 * * * *', $job$select private.call_cron_route('/api/cron/dispatch-workflows')$job$);
end;
$do$;
commit;
