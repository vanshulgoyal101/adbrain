begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #783 / #789: results per ad ("which ad worked"). Additive: two new tables, nothing existing changes.
--
-- campaign_ads: the ad -> creative link, written at Launch from its checkpoints (and backfilled by order for
-- older campaigns), so a result is never attributed by the order of campaigns.meta_ad_ids alone. The uploaded
-- media link (media_asset_id) arrives with #744 phase 1, when its table exists.
--
-- ad_results: each ad's lifetime-to-date numbers from Meta's level=ad insights, one row per (campaign, ad,
-- period; null period = lifetime to date); the refresh job upserts it. An ad Meta hasn't delivered has a row with delivered = false and zeros.
-- No lead personal data. Both tables: owners read their own rows; only the service role writes. business_id
-- must match the campaign's (composite FK), so a row can't be read through another tenant's business.
-- The composite FKs need campaigns (business_id, id) unique; 20260926_campaign_integrity.sql added it, this keeps
-- the migration self-contained (a no-op where it exists; id is the primary key, so it always holds).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_business_id_id_key' and conrelid = 'public.campaigns'::regclass) then
    alter table public.campaigns add constraint campaigns_business_id_id_key unique (business_id, id);
  end if;
end
$$;

create table if not exists public.campaign_ads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  campaign_id uuid not null,
  meta_ad_id text not null check (meta_ad_id ~ '^[0-9]{1,30}$'),
  meta_creative_id text check (meta_creative_id ~ '^[0-9]{1,30}$'),
  creative_id uuid references public.creatives(id) on delete set null,
  variant_index integer check (variant_index between 0 and 99),
  position integer check (position between 0 and 999),
  created_at timestamptz not null default now(),
  foreign key (business_id, campaign_id) references public.campaigns(business_id, id) on delete cascade,
  unique (campaign_id, meta_ad_id)
);
create index if not exists campaign_ads_business_campaign_idx on public.campaign_ads(business_id, campaign_id);
create index if not exists campaign_ads_creative_idx on public.campaign_ads(creative_id) where creative_id is not null;

create table if not exists public.ad_results (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  campaign_id uuid not null,
  meta_ad_id text not null check (meta_ad_id ~ '^[0-9]{1,30}$'),
  -- Meta's ad name and status, so an ad without a campaign_ads link (older campaigns) still reads by name,
  -- and an archived (rebuilt) ad shows as replaced.
  ad_name text check (char_length(ad_name) <= 400),
  effective_status text check (effective_status ~ '^[A-Z_]{1,40}$'),
  period_start date,
  period_end date,
  delivered boolean not null default false,
  impressions bigint not null default 0 check (impressions >= 0),
  link_clicks bigint not null default 0 check (link_clicks >= 0),
  conversations bigint not null default 0 check (conversations >= 0),
  leads bigint not null default 0 check (leads >= 0),
  spend_paise bigint not null default 0 check (spend_paise >= 0),
  synced_at timestamptz not null default now(),
  check (period_start is null or period_end is null or period_start <= period_end),
  foreign key (business_id, campaign_id) references public.campaigns(business_id, id) on delete cascade,
  unique nulls not distinct (campaign_id, meta_ad_id, period_start, period_end)
);
create index if not exists ad_results_business_campaign_idx on public.ad_results(business_id, campaign_id);

alter table public.campaign_ads enable row level security;
alter table public.ad_results enable row level security;
revoke all on public.campaign_ads, public.ad_results from public, anon, authenticated, service_role;
grant select on public.campaign_ads, public.ad_results to authenticated;
grant select, insert, update, delete on public.campaign_ads, public.ad_results to service_role;

drop policy if exists "campaign ads: read own" on public.campaign_ads;
create policy "campaign ads: read own" on public.campaign_ads
  for select to authenticated using (public.owns_business(business_id));
drop policy if exists "ad results: read own" on public.ad_results;
create policy "ad results: read own" on public.ad_results
  for select to authenticated using (public.owns_business(business_id));

commit;
