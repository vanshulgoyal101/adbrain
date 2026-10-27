begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #765 slice (b): a running WhatsApp or interest-based ad set can't be edited in place, so the edit builds a
-- PAUSED copy with the new audience and parks as awaiting_switch while the old ad set keeps running. The
-- owner then switches (pause old, activate copy) or cancels (delete copy). Copy and switch are their own
-- phases; the copy's ids live in result.
alter table public.campaign_edit_operations drop constraint if exists campaign_edit_operations_state_check;
alter table public.campaign_edit_operations add constraint campaign_edit_operations_state_check
  check (state in ('pending', 'running', 'succeeded', 'failed', 'needs_reconciliation', 'awaiting_switch', 'cancelled'));
alter table public.campaign_edit_operations drop constraint if exists campaign_edit_operations_phase_check;
alter table public.campaign_edit_operations add constraint campaign_edit_operations_phase_check
  check (phase in ('validate', 'edit', 'mirror', 'complete', 'copy', 'switch'));

-- One waiting copy per campaign: a second edit can't build a second copy beside the first.
create unique index if not exists campaign_edit_operations_one_switch
  on public.campaign_edit_operations (campaign_id) where state = 'awaiting_switch';

commit;
