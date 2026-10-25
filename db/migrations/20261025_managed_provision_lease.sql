begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #521 (2-Tier): wiring provisioning (CTO decisions, Oct 25).
-- 1. Each child's own system user manages its ad account. Its ID, and a reference to its
--    encrypted token in private.meta_tokens (never the token), live on the ledger row. A composite
--    key ties that token to the same business, so A's row can never point at B's token.
-- 2. One provisioning run per business at a time: a lease claimed with database time, before any
--    Meta lookup, so two concurrent runs can't both create a child.
alter table public.managed_meta_accounts
  add column if not exists manager_user_id text check (manager_user_id ~ '^[0-9]{1,24}$'),
  add column if not exists manager_token_id uuid,
  add column if not exists provision_lease_id uuid,
  add column if not exists provision_lease_until timestamptz;

alter table public.managed_meta_accounts drop constraint if exists managed_meta_accounts_manager_token_fk;
alter table public.managed_meta_accounts add constraint managed_meta_accounts_manager_token_fk
  foreign key (business_id, manager_token_id) references private.meta_tokens(business_id, id)
  on delete set null (manager_token_id);

alter table public.managed_meta_accounts drop constraint if exists managed_meta_accounts_lease_check;
alter table public.managed_meta_accounts add constraint managed_meta_accounts_lease_check
  check ((provision_lease_id is null) = (provision_lease_until is null));

-- Claim the business's provisioning lease if free or expired; true when this caller holds it.
create or replace function public.managed_meta_account_claim(p_business_id uuid, p_lease_id uuid, p_seconds integer)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with claimed as (
    update public.managed_meta_accounts
    set provision_lease_id = p_lease_id,
        provision_lease_until = now() + make_interval(secs => least(greatest(p_seconds, 30), 900))
    where business_id = p_business_id
      and (provision_lease_until is null or provision_lease_until < now() or provision_lease_id = p_lease_id)
    returning 1
  )
  select exists (select 1 from claimed);
$$;

create or replace function public.managed_meta_account_release(p_business_id uuid, p_lease_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with released as (
    update public.managed_meta_accounts
    set provision_lease_id = null, provision_lease_until = null
    where business_id = p_business_id and provision_lease_id = p_lease_id
    returning 1
  )
  select exists (select 1 from released);
$$;

revoke all on function public.managed_meta_account_claim(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.managed_meta_account_release(uuid, uuid) from public, anon, authenticated;
grant execute on function public.managed_meta_account_claim(uuid, uuid, integer) to service_role;
grant execute on function public.managed_meta_account_release(uuid, uuid) to service_role;

commit;
