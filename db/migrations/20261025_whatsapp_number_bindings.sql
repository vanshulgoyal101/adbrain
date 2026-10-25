begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #253: the WhatsApp numbers each AdBrain business may send its click-to-WhatsApp ads to. Several
-- AdBrain businesses can share one Meta business (and under 2-Tier every managed customer sits
-- under Solaride's), so a number being on a WABA that business owns doesn't make it theirs. A
-- number other than the Page's own must be bound here: by the owner picking it from their own
-- connection (`owner_pick`, never for a managed account) or verified by Meta (`embedded_signup`,
-- `page_link`). Phone numbers and Meta IDs only; never tokens. Owners read their own rows; only
-- the service role writes.
create table if not exists public.whatsapp_number_bindings (
  business_id uuid not null references public.businesses(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  source text not null check (source in ('owner_pick', 'embedded_signup', 'page_link')),
  waba_id text check (waba_id ~ '^[0-9]{1,24}$'),
  phone_number_id text check (phone_number_id ~ '^[0-9]{1,24}$'),
  created_at timestamptz not null default now(),
  primary key (business_id, phone_e164)
);

alter table public.whatsapp_number_bindings enable row level security;
revoke all on public.whatsapp_number_bindings from public, anon, authenticated, service_role;
grant select on public.whatsapp_number_bindings to authenticated;
grant select, insert, delete on public.whatsapp_number_bindings to service_role;

drop policy if exists "whatsapp number bindings: read own" on public.whatsapp_number_bindings;
create policy "whatsapp number bindings: read own" on public.whatsapp_number_bindings
  for select to authenticated using (public.owns_business(business_id));

commit;
