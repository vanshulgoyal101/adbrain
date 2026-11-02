begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #2635: link clicks are distinct from all clicks. NULL means not read; do not backfill zero.
-- Additive and metadata-only; existing RLS and grants stay unchanged.
alter table public.campaign_results
  add column if not exists link_clicks bigint;

alter table public.campaign_results drop constraint if exists campaign_results_link_clicks_safe;
alter table public.campaign_results add constraint campaign_results_link_clicks_safe
  check (link_clicks between 0 and 9007199254740991);

commit;
