-- #1670 (CTO design 18:55Z, Reviewer's 7 points 19:06Z, transport 19:56Z): a rep hands a `+prospect` business to its
-- owner without DevOps. No link is sent: the owner signs in on their own phone the normal way (email link or Google,
-- both confirmed), which proves the address, and Home asks "Make {business} yours?". One definer function then moves
-- the business to them in one transaction, after re-checking the #1486 runbook's pre-checks under lock. The owner's
-- login is their own (nothing of the staff login carries over); staff keep their account and lose access because they
-- no longer own the business. Additive: one table, one column, functions.
begin;
set local lock_timeout = '5s';

-- When the business became its owner's; usage before it was our sales prep (CTO, point 6).
alter table public.businesses add column if not exists transferred_at timestamptz;

create table if not exists private.business_transfers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  target_email text not null check (target_email = lower(btrim(target_email)) and target_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  state text not null default 'pending' check (state in ('pending', 'claimed', 'cancelled', 'declined')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  cancelled_at timestamptz
);
-- One pending hand-over per business: a new one (a corrected email) replaces the old.
create unique index if not exists business_transfers_one_pending on private.business_transfers(business_id) where state = 'pending';
create index if not exists business_transfers_target_pending on private.business_transfers(target_email) where state = 'pending';

alter table private.business_transfers enable row level security;
revoke all on private.business_transfers from public, anon, authenticated, service_role;

-- The #1486 runbook's pre-checks: what would make the business something other than prepared ads and a Brand. Returns
-- the first blocking relation, or null. Tables added by later migrations are looked up by name, so an older chain works.
create or replace function private.business_transfer_blocker(p_business_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  rel text;
  found_row boolean;
begin
  if exists (select 1 from public.meta_connections c where c.business_id = p_business_id
      and (c.authorization_status not in ('disconnected', 'revoked') or c.token_id is not null)) then
    return 'public.meta_connections';
  end if;
  foreach rel in array array['public.campaigns', 'private.meta_tokens', 'private.meta_connection_attempts',
      'public.managed_meta_accounts', 'public.owner_alert_prefs', 'private.production_payment_orders', 'private.razorpay_test_orders'] loop
    if to_regclass(rel) is not null then
      execute format('select exists (select 1 from %s where business_id = $1)', rel) into found_row using p_business_id;
      if found_row then return rel; end if;
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function private.business_transfer_blocker(uuid) from public, anon, authenticated, service_role;

-- Keep in step with src/lib/internal-accounts.json `domains`.
create or replace function private.is_team_email(p_email text)
returns boolean language sql immutable set search_path = '' as $$
  select split_part(lower(coalesce(p_email, '')), '@', 2) in ('adbrain.vanshul.com', 'adbrain.local');
$$;
revoke all on function private.is_team_email(text) from public, anon, authenticated, service_role;

-- Service role only (the route checks the staff session first): the starter must own the business with a confirmed
-- `+prospect` team address, and the pre-checks must pass. Returns the transfer id; 30 minutes to claim.
create or replace function public.business_transfer_start(p_business_id uuid, p_from_user_id uuid, p_target_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  staff_email text;
  target text := lower(btrim(coalesce(p_target_email, '')));
  blocker text;
  transfer_id uuid;
begin
  select lower(u.email) into staff_email
  from public.businesses b join auth.users u on u.id = b.owner_id
  where b.id = p_business_id and b.owner_id = p_from_user_id and u.email_confirmed_at is not null
  for update of b;
  if staff_email is null or not private.is_team_email(staff_email) or split_part(staff_email, '@', 1) !~ '\+prospect(-|$)' then
    raise insufficient_privilege using message = 'Only a sales prospect account can hand its business over';
  end if;
  if target !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise invalid_parameter_value using message = 'Invalid hand-over';
  end if;
  if private.is_team_email(target) then
    raise invalid_parameter_value using message = 'Hand the business to the owner''s own email, not a team address';
  end if;
  blocker := private.business_transfer_blocker(p_business_id);
  if blocker is not null then
    raise check_violation using message = 'This business can''t be handed over yet', detail = blocker;
  end if;
  update private.business_transfers set state = 'cancelled', cancelled_at = now()
  where business_id = p_business_id and state = 'pending';
  insert into private.business_transfers(business_id, from_user_id, target_email, expires_at)
  values (p_business_id, p_from_user_id, target, now() + interval '30 minutes')
  returning id into transfer_id;
  return transfer_id;
end;
$$;
revoke all on function public.business_transfer_start(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.business_transfer_start(uuid, uuid, text) to service_role;

-- Service role only: what the rep's sheet shows before starting: the first pre-check that blocks, or null.
create or replace function public.business_transfer_check(p_business_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select private.business_transfer_blocker(p_business_id);
$$;
revoke all on function public.business_transfer_check(uuid) from public, anon, authenticated;
grant execute on function public.business_transfer_check(uuid) to service_role;

-- Service role only: the rep cancels the pending hand-over of a business they still own.
create or replace function public.business_transfer_cancel(p_business_id uuid, p_from_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare cancelled int;
begin
  update private.business_transfers t set state = 'cancelled', cancelled_at = now()
  from public.businesses b
  where t.business_id = p_business_id and t.state = 'pending' and b.id = t.business_id and b.owner_id = p_from_user_id;
  get diagnostics cancelled = row_count;
  return cancelled > 0;
end;
$$;
revoke all on function public.business_transfer_cancel(uuid, uuid) from public, anon, authenticated;
grant execute on function public.business_transfer_cancel(uuid, uuid) to service_role;

-- Service role only: the business's latest hand-over for the rep's Settings (waiting, declined, expired or cancelled).
create or replace function public.business_transfer_status(p_business_id uuid)
returns table (target_email text, state text, expires_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.target_email,
    case when t.state = 'pending' and t.expires_at <= now() then 'expired' else t.state end,
    t.expires_at, coalesce(t.claimed_at, t.cancelled_at, t.created_at)
  from private.business_transfers t where t.business_id = p_business_id
  order by t.created_at desc limit 1;
$$;
revoke all on function public.business_transfer_status(uuid) from public, anon, authenticated;
grant execute on function public.business_transfer_status(uuid) to service_role;

-- The signed-in owner's own pending hand-over: the one waiting for their confirmed address. Only what Home's question
-- needs (the business's name, how many ads are ready and up to 3 of their pictures); nothing for an unconfirmed address.
create or replace function public.business_transfer_mine()
returns table (transfer_id uuid, business_name text, ads integer, images text[], expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
  select t.id, b.name,
    (select count(*)::integer from public.creatives c where c.business_id = b.id and c.status = 'approved'),
    array(select c.image_url from public.creatives c where c.business_id = b.id and c.status = 'approved' and c.image_url is not null
      order by c.created_at desc limit 3),
    t.expires_at
  from auth.users u
  join private.business_transfers t on t.target_email = lower(u.email) and t.state = 'pending' and t.expires_at > now()
  join public.businesses b on b.id = t.business_id and b.owner_id = t.from_user_id
  where u.id = auth.uid() and u.email_confirmed_at is not null
  order by t.created_at desc limit 1;
end;
$$;
revoke all on function public.business_transfer_mine() from public, anon;
grant execute on function public.business_transfer_mine() to authenticated;

-- "This isn't my business": the owner turns it down; the rep's Settings says so.
create or replace function public.business_transfer_decline(p_transfer_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare declined int;
begin
  if auth.uid() is null then raise insufficient_privilege using message = 'Sign in first'; end if;
  update private.business_transfers t set state = 'declined', cancelled_at = now()
  from auth.users u
  where t.id = p_transfer_id and t.state = 'pending' and u.id = auth.uid() and u.email_confirmed_at is not null
    and t.target_email = lower(u.email);
  get diagnostics declined = row_count;
  return declined > 0;
end;
$$;
revoke all on function public.business_transfer_decline(uuid) from public, anon;
grant execute on function public.business_transfer_decline(uuid) to authenticated;

-- The move, for the signed-in owner. Everything is re-checked after the locks: the transfer is pending and unexpired,
-- this user's confirmed address (from auth.users, not the JWT) is the target, the staff still own the business, the
-- owner owns no business yet (one per account), and the pre-checks still pass. Then every owner_id that gates the
-- owner's own use moves; actors in history (audit, usage, events) stay as they were.
create or replace function private.business_transfer_complete(p_transfer_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  my_email text;
  t private.business_transfers;
  blocker text;
begin
  if me is null then raise insufficient_privilege using message = 'Sign in to take over this business'; end if;
  select * into t from private.business_transfers where id = p_transfer_id for update;
  if not found or t.state <> 'pending' or t.expires_at <= now() then
    raise invalid_parameter_value using message = 'This hand-over has expired or was already used';
  end if;
  -- One business per recipient across different transfers (Reviewer, #1783): every claim for this user waits here, so
  -- the count below sees a claim that committed meanwhile. Lock order: transfer row, recipient, business row.
  perform pg_advisory_xact_lock(hashtextextended('business_transfer_recipient:' || me::text, 0));
  select lower(u.email) into my_email from auth.users u where u.id = me and u.email_confirmed_at is not null;
  if my_email is null or my_email <> t.target_email then
    raise insufficient_privilege using message = 'This hand-over is for another email address';
  end if;
  perform 1 from public.businesses b where b.id = t.business_id and b.owner_id = t.from_user_id for update;
  if not found then raise invalid_parameter_value using message = 'This hand-over has expired or was already used'; end if;
  if exists (select 1 from public.businesses b where b.owner_id = me) then
    raise unique_violation using message = 'This email already has an AdBrain business; use another email or ask AdBrain';
  end if;
  blocker := private.business_transfer_blocker(t.business_id);
  if blocker is not null then
    raise check_violation using message = 'This business can''t be handed over yet', detail = blocker;
  end if;

  update public.businesses set owner_id = me, transferred_at = now() where id = t.business_id;
  update public.campaign_drafts set owner_id = me where business_id = t.business_id and owner_id = t.from_user_id;
  -- declared_preferences' FK to preference_settings(business_id, owner_id) has no ON UPDATE: new parent, move the
  -- children, then drop the old parent (QA, #1700).
  insert into public.preference_settings(business_id, owner_id, enabled, epoch, updated_at)
  select business_id, me, enabled, epoch, now() from public.preference_settings
  where business_id = t.business_id and owner_id = t.from_user_id
  on conflict (business_id, owner_id) do nothing;
  update public.declared_preferences set owner_id = me where business_id = t.business_id and owner_id = t.from_user_id;
  delete from public.preference_settings where business_id = t.business_id and owner_id = t.from_user_id;
  -- Sales notes typed while preparing aren't the owner's instructions (#1486).
  if to_regclass('public.ad_instructions') is not null then
    execute 'delete from public.ad_instructions where business_id = $1' using t.business_id;
  end if;

  update private.business_transfers set state = 'claimed', claimed_by = me, claimed_at = now() where id = t.id;
  insert into public.audit_log(business_id, actor_id, actor_label, action, entity_type, entity_id, reason, details, authority)
  values (t.business_id, me, 'owner', 'business.transfer', 'business', t.business_id::text, 'Prepared by AdBrain, handed to its owner',
    jsonb_build_object('from_user_id', t.from_user_id, 'to_user_id', me, 'transfer_id', t.id), 'server');
  return t.business_id;
end;
$$;
revoke all on function private.business_transfer_complete(uuid) from public, anon, authenticated, service_role;

-- The signed-in owner says yes ("Make it mine").
create or replace function public.business_transfer_claim(p_transfer_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise insufficient_privilege using message = 'Sign in to take over this business'; end if;
  return private.business_transfer_complete(p_transfer_id);
end;
$$;
revoke all on function public.business_transfer_claim(uuid) from public, anon;
grant execute on function public.business_transfer_claim(uuid) to authenticated;

-- CTO, point 6: the owner's monthly allowance never counts our preparation before the hand-over.
create or replace function public.monthly_token_usage(p_business_id uuid, p_since timestamptz)
returns bigint language sql stable security invoker set search_path = public
as $$
  select coalesce(sum(greatest(e.total_tokens, 0)), 0)::bigint
  from public.llm_usage_events e
  where e.business_id = p_business_id
    and e.created_at >= greatest(p_since, coalesce((select b.transferred_at from public.businesses b where b.id = p_business_id), p_since));
$$;
revoke all on function public.monthly_token_usage(uuid, timestamptz) from public, anon;
grant execute on function public.monthly_token_usage(uuid, timestamptz) to authenticated, service_role;

commit;
