begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #2595 phase 1: website (traffic) campaigns. 'website' joins the destination checks on campaigns and
-- campaign_results, and campaign_results gains landing_page_views (Meta's landing_page_view action)
-- with the same safe-integer bounds as clicks; ad_results gains the per-ad count (checked like leads) so a
-- website ad's views never land in leads (#2601). Additive only: the constant defaults make the new
-- columns metadata-only, existing rows read 0, and RLS is unchanged.
alter table public.campaigns drop constraint if exists campaigns_destination_check;
alter table public.campaigns add constraint campaigns_destination_check
  check (destination in ('instant_form', 'whatsapp', 'call', 'website', 'mixed', 'unknown'));

alter table public.campaign_results drop constraint if exists campaign_results_destination_check;
alter table public.campaign_results add constraint campaign_results_destination_check
  check (destination in ('instant_form', 'whatsapp', 'call', 'website', 'mixed', 'unknown'));

alter table public.campaign_results
  add column if not exists landing_page_views bigint not null default 0;

alter table public.campaign_results drop constraint if exists campaign_results_landing_page_views_safe;
alter table public.campaign_results add constraint campaign_results_landing_page_views_safe
  check (landing_page_views between 0 and 9007199254740991);

alter table public.ad_results
  add column if not exists landing_page_views bigint not null default 0;

alter table public.ad_results drop constraint if exists ad_results_landing_page_views_check;
alter table public.ad_results add constraint ad_results_landing_page_views_check
  check (landing_page_views >= 0);

commit;
