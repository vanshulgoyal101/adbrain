begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #775: editing a launched ad's words (a new creative swapped onto the ad) uses the same envelope as
-- audience and budget edits, so one reader reconciles every edit. The ad and creative ids live in
-- before (ad_id, previous_creative_id), change (the new words) and result (new_creative_id).
alter table public.campaign_edit_operations drop constraint if exists campaign_edit_operations_kind_check;
alter table public.campaign_edit_operations add constraint campaign_edit_operations_kind_check
  check (kind in ('audience', 'budget', 'ad_creative'));

commit;
