begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #493: people who opened WhatsApp from a click-to-WhatsApp ad (Meta's link_click), stored beside
-- conversations (who then sent a message) so Campaigns can show the drop-off. Nullable, no default:
-- a metadata-only change; older rows and lead-form campaigns stay null. RLS is unchanged.
alter table public.campaign_results
  add column if not exists whatsapp_opens integer;

alter table public.campaign_results drop constraint if exists campaign_results_whatsapp_opens_check;
alter table public.campaign_results add constraint campaign_results_whatsapp_opens_check
  check (whatsapp_opens is null or whatsapp_opens >= 0);

commit;
