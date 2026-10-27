-- #701 slice 1: an owner opts in to WhatsApp alerts (each new enquiry, one daily results line).
-- Nothing is sent from here. `owner_alert_prefs` holds the two switches, the language and the
-- owner's WhatsApp number once they confirm it by sending "START <code>" to AdBrain's number;
-- `owner_alert_consent_events` is the append-only consent log (time + method). Owners read their
-- own rows and change them only through the owner-checked functions; the START/STOP handlers use
-- the service-only ones. Additive: no existing table changes.
begin;
set local lock_timeout = '5s';

create table if not exists public.owner_alert_prefs (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  lead_alerts boolean not null default false,
  daily_results boolean not null default false,
  language text not null default 'en' check (language in ('en', 'hi')),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  verified_at timestamptz,
  -- Whoever sends this code gets the business's enquiries, so it is long, random and short-lived.
  verify_code text check (verify_code ~ '^[A-F0-9]{10}$'),
  verify_expires_at timestamptz,
  opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_alert_prefs_verified_phone check (verified_at is null or phone_e164 is not null),
  constraint owner_alert_prefs_code_expiry check ((verify_code is null) = (verify_expires_at is null))
);
create unique index if not exists owner_alert_prefs_code_idx on public.owner_alert_prefs(verify_code) where verify_code is not null;
create index if not exists owner_alert_prefs_phone_idx on public.owner_alert_prefs(phone_e164) where phone_e164 is not null;
create index if not exists owner_alert_prefs_owner_idx on public.owner_alert_prefs(owner_id);

create table if not exists public.owner_alert_consent_events (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  event text not null check (event in ('preferences', 'verified', 'opted_out')),
  method text not null check (method in ('settings', 'whatsapp_start', 'whatsapp_stop')),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 1024),
  occurred_at timestamptz not null default now()
);
create index if not exists owner_alert_consent_events_business_idx on public.owner_alert_consent_events(business_id, occurred_at desc);

alter table public.owner_alert_prefs enable row level security;
alter table public.owner_alert_consent_events enable row level security;
revoke all on public.owner_alert_prefs from public, anon, authenticated, service_role;
revoke all on public.owner_alert_consent_events from public, anon, authenticated, service_role;
grant select on public.owner_alert_prefs to authenticated;
grant select on public.owner_alert_consent_events to authenticated;
grant select, insert, update on public.owner_alert_prefs to service_role;
grant select, insert on public.owner_alert_consent_events to service_role;

drop policy if exists "owner alert prefs: read own" on public.owner_alert_prefs;
create policy "owner alert prefs: read own" on public.owner_alert_prefs
  for select to authenticated using (public.owns_business(business_id));
drop policy if exists "owner alert consent: read own" on public.owner_alert_consent_events;
create policy "owner alert consent: read own" on public.owner_alert_consent_events
  for select to authenticated using (public.owns_business(business_id));

-- The owner's switches and language (logged). They never lift a STOP: only the number's holder can,
-- with a fresh START <code> (owner_alert_confirm). The sender also needs verified_at and no opted_out_at.
create or replace function public.owner_alert_prefs_set(p_business_id uuid, p_lead_alerts boolean, p_daily_results boolean, p_language text)
returns public.owner_alert_prefs language plpgsql security definer set search_path = '' as $$
declare saved public.owner_alert_prefs;
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then
    raise insufficient_privilege using message = 'Business access denied';
  end if;
  if p_lead_alerts is null or p_daily_results is null or coalesce(p_language, '') not in ('en', 'hi') then
    raise invalid_parameter_value using message = 'Invalid alert settings';
  end if;
  insert into public.owner_alert_prefs as prefs(business_id, owner_id, lead_alerts, daily_results, language)
  values (p_business_id, auth.uid(), p_lead_alerts, p_daily_results, p_language)
  on conflict (business_id) do update set lead_alerts = excluded.lead_alerts, daily_results = excluded.daily_results,
    language = excluded.language, owner_id = excluded.owner_id, updated_at = now()
  returning * into saved;
  insert into public.owner_alert_consent_events(business_id, event, method, detail)
  values (p_business_id, 'preferences', 'settings', jsonb_build_object('lead_alerts', p_lead_alerts, 'daily_results', p_daily_results, 'language', p_language));
  return saved;
end;
$$;

-- A fresh code for "START <code>"; the previous one stops working.
create or replace function public.owner_alert_start_verification(p_business_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare code text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then
    raise insufficient_privilege using message = 'Business access denied';
  end if;
  insert into public.owner_alert_prefs as prefs(business_id, owner_id, verify_code, verify_expires_at)
  values (p_business_id, auth.uid(), code, now() + interval '15 minutes')
  on conflict (business_id) do update set verify_code = excluded.verify_code, verify_expires_at = excluded.verify_expires_at,
    owner_id = excluded.owner_id, updated_at = now();
  return code;
end;
$$;

-- Service only: a "START <code>" message from p_phone. Returns the business, or null for an unknown or expired code.
create or replace function public.owner_alert_confirm(p_code text, p_phone text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare confirmed uuid;
begin
  if coalesce(p_phone, '') !~ '^\+[1-9][0-9]{6,14}$' or coalesce(p_code, '') !~ '^[A-F0-9]{10}$' then
    return null;
  end if;
  update public.owner_alert_prefs set phone_e164 = p_phone, verified_at = now(), verify_code = null, verify_expires_at = null,
    opted_out_at = null, updated_at = now()
  where verify_code = p_code and verify_expires_at > now()
  returning business_id into confirmed;
  if confirmed is not null then
    insert into public.owner_alert_consent_events(business_id, event, method, detail)
    values (confirmed, 'verified', 'whatsapp_start', jsonb_build_object('phone_last4', right(p_phone, 4)));
  end if;
  return confirmed;
end;
$$;

-- Service only: "STOP" (or बंद) from p_phone turns off both alerts for every business on that number.
create or replace function public.owner_alert_stop(p_phone text)
returns integer language plpgsql security definer set search_path = '' as $$
declare stopped integer;
begin
  if coalesce(p_phone, '') !~ '^\+[1-9][0-9]{6,14}$' then return 0; end if;
  with updated as (
    update public.owner_alert_prefs set lead_alerts = false, daily_results = false, opted_out_at = now(), updated_at = now()
    where phone_e164 = p_phone and opted_out_at is null
    returning business_id
  ), logged as (
    insert into public.owner_alert_consent_events(business_id, event, method, detail)
    select business_id, 'opted_out', 'whatsapp_stop', jsonb_build_object('phone_last4', right(p_phone, 4)) from updated
    returning 1
  )
  select count(*)::integer into stopped from logged;
  return stopped;
end;
$$;

revoke all on function public.owner_alert_prefs_set(uuid, boolean, boolean, text) from public, anon;
revoke all on function public.owner_alert_start_verification(uuid) from public, anon;
grant execute on function public.owner_alert_prefs_set(uuid, boolean, boolean, text) to authenticated;
grant execute on function public.owner_alert_start_verification(uuid) to authenticated;
revoke all on function public.owner_alert_confirm(text, text) from public, anon, authenticated;
revoke all on function public.owner_alert_stop(text) from public, anon, authenticated;
grant execute on function public.owner_alert_confirm(text, text) to service_role;
grant execute on function public.owner_alert_stop(text) to service_role;

commit;
