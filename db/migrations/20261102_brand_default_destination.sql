begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- The constant default is metadata-only: existing businesses keep WhatsApp without an UPDATE.
alter table public.businesses
  add column if not exists default_destination text not null default 'whatsapp';

alter table public.businesses drop constraint if exists businesses_default_destination_check;
alter table public.businesses add constraint businesses_default_destination_check
  check (default_destination in ('whatsapp', 'website'));

commit;
