begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #524 v1 (CTO, Oct 25): a managed customer's WhatsApp is the number linked to their own Page, which
-- Meta verifies with the owner's OTP in Page settings. That gives a phone number, not Embedded
-- Signup's WABA and phone-number IDs (v2, once AdBrain is a Tech Provider, #517). So the ledger
-- records the Page-linked number, and `whatsapp_linked` accepts either. One active customer per
-- number (QA's #554 follow-up). Phone numbers only; never tokens.
alter table public.managed_meta_accounts
  add column if not exists whatsapp_number_e164 text check (whatsapp_number_e164 ~ '^\+[1-9][0-9]{6,14}$');

-- Replace only #519's "whatsapp_linked needs the Embedded Signup IDs" check (other checks also name
-- the state, so match on its WABA clause). Re-running drops and re-adds the named one.
do $$
declare constraint_name text;
begin
  for constraint_name in
    select conname from pg_constraint
    where conrelid = 'public.managed_meta_accounts'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%waba_id IS NOT NULL%'
  loop
    execute format('alter table public.managed_meta_accounts drop constraint %I', constraint_name);
  end loop;
end
$$;
alter table public.managed_meta_accounts add constraint managed_meta_accounts_whatsapp_linked_check
  check (state <> 'whatsapp_linked' or (waba_id is not null and phone_number_id is not null) or whatsapp_number_e164 is not null);

create unique index if not exists managed_meta_accounts_whatsapp_number_active
  on public.managed_meta_accounts(whatsapp_number_e164) where whatsapp_number_e164 is not null and state <> 'offboarded';

commit;
