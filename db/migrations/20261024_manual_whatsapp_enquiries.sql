begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #335: the owner logs real enquiries from a WhatsApp ad's chats. They have no Meta lead ID,
-- so meta_lead_id is null exactly for those rows; (business_id, meta_lead_id) stays unique for
-- Meta form leads because nulls are distinct. RLS is unchanged: "leads: all own".
alter table public.leads
  add column if not exists source text not null default 'meta_form';

alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('meta_form', 'whatsapp_manual'));

alter table public.leads alter column meta_lead_id drop not null;

alter table public.leads drop constraint if exists leads_source_meta_lead_id_check;
alter table public.leads add constraint leads_source_meta_lead_id_check
  check ((source = 'meta_form') = (meta_lead_id is not null));

commit;
