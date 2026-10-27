-- #1049: when the owner first replied to an enquiry (a tap on "WhatsApp them" or "Call" on its card),
-- so Home can show the median time to first reply. Set once by the app (null until then); owners
-- update their own leads under the existing "leads: all own" policy. Additive only.
begin;
set local lock_timeout = '5s';

alter table public.leads add column if not exists first_contacted_at timestamptz;
create index if not exists leads_business_first_contacted_idx
  on public.leads (business_id, first_contacted_at desc) where first_contacted_at is not null;

commit;
