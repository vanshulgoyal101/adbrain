-- #701 slice 2: the WhatsApp alert send log. One row per alert (a lead id, or a day for the
-- daily line), so a lead is never alerted twice; the monthly cap counts these rows. Three counted
-- failures in a row pause an owner's alerts until they confirm their number again. A template Meta
-- moves to MARKETING is blocked, so AdBrain stops sending it. Service-only writes through the
-- functions below; owners read their own sends. Additive: one column pair on owner_alert_prefs.
begin;
set local lock_timeout = '5s';

alter table public.owner_alert_prefs add column if not exists send_failures integer not null default 0 check (send_failures >= 0);
alter table public.owner_alert_prefs add column if not exists paused_at timestamptz;

create table if not exists public.owner_alert_sends (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null check (kind in ('lead', 'daily')),
  -- The lead id, or the IST date (YYYY-MM-DD) of a daily line.
  dedupe_key text not null check (length(dedupe_key) between 1 and 128),
  -- pending: claimed; sent: Meta accepted it; failed: refused; retry: may be claimed again;
  -- unknown: the request may have reached Meta, so it is never sent again.
  state text not null default 'pending' check (state in ('pending', 'sent', 'failed', 'retry', 'unknown')),
  attempts integer not null default 1 check (attempts >= 1),
  template text not null check (length(template) between 1 and 512),
  error_code text check (error_code is null or length(error_code) <= 32),
  wa_message_id text check (wa_message_id is null or length(wa_message_id) <= 256),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (business_id, kind, dedupe_key)
);
create index if not exists owner_alert_sends_month_idx on public.owner_alert_sends(business_id, created_at desc);

create table if not exists public.owner_alert_template_blocks (
  template text primary key check (length(template) between 1 and 512),
  category text not null check (length(category) between 1 and 32),
  blocked_at timestamptz not null default now()
);

alter table public.owner_alert_sends enable row level security;
alter table public.owner_alert_template_blocks enable row level security;
revoke all on public.owner_alert_sends from public, anon, authenticated, service_role;
revoke all on public.owner_alert_template_blocks from public, anon, authenticated, service_role;
grant select on public.owner_alert_sends to authenticated;
grant select on public.owner_alert_sends, public.owner_alert_template_blocks to service_role;

drop policy if exists "owner alert sends: read own" on public.owner_alert_sends;
create policy "owner alert sends: read own" on public.owner_alert_sends
  for select to authenticated using (public.owns_business(business_id));

-- Claims one alert, or says why not. Locks the owner's prefs row so the cap and the pause hold
-- under concurrent sends. Returns the number to send to only when the alert is claimed.
create or replace function public.owner_alert_claim(p_business_id uuid, p_kind text, p_key text, p_template text, p_month_cap integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  prefs public.owner_alert_prefs;
  used integer;
  claimed bigint;
begin
  if p_kind not in ('lead', 'daily') or coalesce(length(p_key), 0) not between 1 and 128
    or coalesce(length(p_template), 0) not between 1 and 512 or p_month_cap is null or p_month_cap < 0 then
    raise invalid_parameter_value using message = 'Invalid alert claim';
  end if;
  select * into prefs from public.owner_alert_prefs where business_id = p_business_id for update;
  if not found or prefs.verified_at is null or prefs.phone_e164 is null then return jsonb_build_object('claimed', false, 'reason', 'unverified'); end if;
  if prefs.opted_out_at is not null then return jsonb_build_object('claimed', false, 'reason', 'opted_out'); end if;
  if not (case p_kind when 'lead' then prefs.lead_alerts else prefs.daily_results end) then return jsonb_build_object('claimed', false, 'reason', 'off'); end if;
  if prefs.paused_at is not null then return jsonb_build_object('claimed', false, 'reason', 'paused'); end if;
  if exists (select 1 from public.owner_alert_template_blocks where template = p_template) then return jsonb_build_object('claimed', false, 'reason', 'template_blocked'); end if;
  select count(*) into used from public.owner_alert_sends
  where business_id = p_business_id and state in ('pending', 'sent', 'unknown')
    and created_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  if used >= p_month_cap then return jsonb_build_object('claimed', false, 'reason', 'cap'); end if;
  insert into public.owner_alert_sends as sends(business_id, kind, dedupe_key, template)
  values (p_business_id, p_kind, p_key, p_template)
  on conflict (business_id, kind, dedupe_key) do update set state = 'pending', attempts = sends.attempts + 1, template = excluded.template, error_code = null, settled_at = null
    where sends.state = 'retry'
  returning id into claimed;
  if claimed is null then return jsonb_build_object('claimed', false, 'reason', 'duplicate'); end if;
  return jsonb_build_object('claimed', true, 'sendId', claimed, 'phone', prefs.phone_e164, 'language', prefs.language);
end;
$$;

-- Records what Meta answered. A counted failure (the owner's number can't get it) adds to the
-- owner's run of failures and pauses alerts at 3; a send Meta accepts resets the run.
create or replace function public.owner_alert_settle(p_send_id bigint, p_state text, p_error_code text, p_wa_message_id text, p_counts boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  send public.owner_alert_sends;
begin
  if p_state not in ('sent', 'failed', 'retry', 'unknown') or coalesce(length(p_error_code), 0) > 32 or coalesce(length(p_wa_message_id), 0) > 256 then
    raise invalid_parameter_value using message = 'Invalid alert result';
  end if;
  update public.owner_alert_sends set state = p_state, error_code = p_error_code, wa_message_id = p_wa_message_id, settled_at = now()
  where id = p_send_id and state = 'pending' returning * into send;
  if not found then return; end if;
  if p_state = 'sent' then
    update public.owner_alert_prefs set send_failures = 0, updated_at = now() where business_id = send.business_id;
  elsif p_state = 'failed' and coalesce(p_counts, false) then
    update public.owner_alert_prefs set send_failures = send_failures + 1,
      paused_at = case when send_failures + 1 >= 3 then coalesce(paused_at, now()) else paused_at end, updated_at = now()
    where business_id = send.business_id;
  end if;
end;
$$;

-- Meta moved a template out of UTILITY (e.g. to MARKETING): stop sending it.
create or replace function public.owner_alert_template_block(p_template text, p_category text)
returns void language sql security definer set search_path = '' as $$
  insert into public.owner_alert_template_blocks(template, category) values (p_template, p_category)
  on conflict (template) do update set category = excluded.category, blocked_at = now();
$$;

-- A fresh START (owner_alert_confirm) also lifts a failure pause: the number works again.
create or replace function public.owner_alert_unpause_on_confirm() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.verified_at is distinct from old.verified_at and new.verified_at is not null then
    new.paused_at := null;
    new.send_failures := 0;
  end if;
  return new;
end;
$$;
drop trigger if exists owner_alert_prefs_unpause on public.owner_alert_prefs;
create trigger owner_alert_prefs_unpause before update on public.owner_alert_prefs
  for each row execute function public.owner_alert_unpause_on_confirm();

revoke all on function public.owner_alert_claim(uuid, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.owner_alert_settle(bigint, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.owner_alert_template_block(text, text) from public, anon, authenticated;
revoke all on function public.owner_alert_unpause_on_confirm() from public, anon, authenticated;
grant execute on function public.owner_alert_claim(uuid, text, text, text, integer) to service_role;
grant execute on function public.owner_alert_settle(bigint, text, text, text, boolean) to service_role;
grant execute on function public.owner_alert_template_block(text, text) to service_role;

commit;
