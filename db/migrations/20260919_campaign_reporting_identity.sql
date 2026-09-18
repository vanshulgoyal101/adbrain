alter table public.campaigns
  add column if not exists destination text not null default 'unknown'
    check (destination in ('instant_form', 'whatsapp', 'call', 'mixed', 'unknown'));

create index if not exists campaigns_business_created_id_idx
  on public.campaigns (business_id, created_at desc, id desc);

alter table public.campaign_results
  add column if not exists destination text not null default 'unknown'
    check (destination in ('instant_form', 'whatsapp', 'call', 'mixed', 'unknown')),
  add column if not exists period_start date,
  add column if not exists period_end date;

update public.campaigns
set destination = raw #>> '{metaResult,destination}'
where destination = 'unknown'
  and raw #>> '{metaResult,destination}' in ('instant_form', 'whatsapp', 'call');

update public.campaign_results
set destination = 'whatsapp'
where destination = 'unknown' and conversations is not null;