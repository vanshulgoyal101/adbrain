begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #2711 (#2595 phase 2, M2): website signups/sales through a Meta pixel.
-- businesses.meta_pixel_id is the Brand's chosen pixel; campaigns.meta_pixel_id is what a campaign was bought
-- with, like the other meta_* columns. campaign_results and ad_results gain Meta-attributed conversions
-- (safe-integer bounds like landing_page_views) and conversion_value (finite, non-negative; NULL = Meta sent no value, never 0; NaN refused).
-- campaigns.objective has no check constraint, so 'sales' needs no change. Additive only: nullable columns
-- and a constant default are metadata-only, existing rows read 0/NULL, no backfill, RLS and grants unchanged.
alter table public.campaign_results
  add column if not exists conversions bigint not null default 0,
  add column if not exists conversion_value numeric(14, 2);

alter table public.campaign_results drop constraint if exists campaign_results_conversions_safe;
alter table public.campaign_results add constraint campaign_results_conversions_safe
  check (conversions between 0 and 9007199254740991);

alter table public.campaign_results drop constraint if exists campaign_results_conversion_value_check;
alter table public.campaign_results add constraint campaign_results_conversion_value_check
  check (conversion_value >= 0 and conversion_value < 'Infinity'::numeric);

alter table public.ad_results
  add column if not exists conversions bigint not null default 0,
  add column if not exists conversion_value numeric(14, 2);

alter table public.ad_results drop constraint if exists ad_results_conversions_safe;
alter table public.ad_results add constraint ad_results_conversions_safe
  check (conversions between 0 and 9007199254740991);

alter table public.ad_results drop constraint if exists ad_results_conversion_value_check;
alter table public.ad_results add constraint ad_results_conversion_value_check
  check (conversion_value >= 0 and conversion_value < 'Infinity'::numeric);

-- Hot tables last, so their brief metadata-only locks are not held through the result-table CHECK scans.
alter table public.businesses
  add column if not exists meta_pixel_id text;

alter table public.campaigns
  add column if not exists meta_pixel_id text;

commit;
