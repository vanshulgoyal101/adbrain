begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #229: queue one email per new instant-form enquiry. The queue row is created by a trigger on the
-- first insert of a lead, unique per lead, so a re-synced lead never queues again. Enquiries older
-- than 24 hours are skipped so a first sync never emails old leads.
create table if not exists private.lead_email_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  enabled boolean not null default true,
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists private.lead_notifications (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  state text not null default 'queued' check (state in ('queued','sending','sent','failed','skipped')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  skip_reason text check (skip_reason in ('stale','opted_out')),
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  claimed_at timestamptz,
  sent_at timestamptz
);
create index if not exists lead_notifications_open_idx on private.lead_notifications(created_at)
  where state in ('queued','sending');

alter table private.lead_email_settings enable row level security;
alter table private.lead_notifications enable row level security;
revoke all on private.lead_email_settings, private.lead_notifications from public, anon, authenticated, service_role;

create or replace function private.lead_notification_enqueue()
returns trigger language plpgsql security definer set search_path = '' as $$
declare stale boolean := coalesce(new.created_time, new.created_at) < clock_timestamp() - interval '24 hours';
begin
  insert into private.lead_notifications(lead_id, business_id, state, skip_reason)
    values (new.id, new.business_id, case when stale then 'skipped' else 'queued' end, case when stale then 'stale' end)
    on conflict (lead_id) do nothing;
  return new;
end;
$$;
revoke all on function private.lead_notification_enqueue() from public, anon, authenticated, service_role;

drop trigger if exists lead_notification_enqueue on public.leads;
create trigger lead_notification_enqueue after insert on public.leads
  for each row execute function private.lead_notification_enqueue();

-- Claims up to p_limit queued notifications (or ones stuck sending for 10 minutes) and returns the data
-- needed to write the email. Stale and opted-out ones are skipped, never returned.
create or replace function public.lead_notifications_claim(p_limit integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare claimed jsonb;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'Invalid claim size' using errcode = '22023';
  end if;
  update private.lead_notifications note set state = 'skipped', skip_reason = 'stale'
    from public.leads lead
    where lead.id = note.lead_id and note.state in ('queued', 'sending')
      and coalesce(lead.created_time, lead.created_at) < clock_timestamp() - interval '24 hours';
  update private.lead_notifications note set state = 'skipped', skip_reason = 'opted_out'
    where note.state = 'queued'
      and exists(select 1 from private.lead_email_settings setting where setting.business_id = note.business_id and not setting.enabled);
  update private.lead_notifications set state = 'failed', error_code = 'attempts_exhausted'
    where state = 'sending' and attempts >= 3 and claimed_at < clock_timestamp() - interval '10 minutes';
  with picked as (
    select note.lead_id from private.lead_notifications note
    where (note.state = 'queued' or (note.state = 'sending' and note.claimed_at < clock_timestamp() - interval '10 minutes'))
      and note.attempts < 3
    order by note.created_at limit p_limit for update skip locked
  ), marked as (
    update private.lead_notifications note
      set state = 'sending', claimed_at = clock_timestamp(), attempts = note.attempts + 1
      from picked where note.lead_id = picked.lead_id
      returning note.lead_id, note.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'leadId', lead.id, 'businessId', lead.business_id, 'ownerId', business.owner_id, 'businessName', business.name,
      'fullName', lead.full_name, 'phone', lead.phone, 'email', lead.email, 'city', lead.city,
      'fields', lead.field_data, 'formName', lead.form_name,
      'receivedAt', coalesce(lead.created_time, lead.created_at), 'attempt', marked.attempts) order by lead.created_at), '[]'::jsonb)
    into claimed
    from marked join public.leads lead on lead.id = marked.lead_id join public.businesses business on business.id = lead.business_id;
  return claimed;
end;
$$;

create or replace function public.lead_notification_result(p_lead_id uuid, p_outcome text, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_outcome not in ('sent', 'retry', 'failed') then
    raise exception 'Invalid notification outcome' using errcode = '22023';
  end if;
  update private.lead_notifications set
    state = case p_outcome when 'sent' then 'sent' when 'failed' then 'failed'
      else case when attempts >= 3 then 'failed' else 'queued' end end,
    sent_at = case when p_outcome = 'sent' then clock_timestamp() else sent_at end,
    error_code = left(p_error, 64)
    where lead_id = p_lead_id and state = 'sending';
end;
$$;

create or replace function public.lead_email_setting_get(p_business_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.owns_business(p_business_id) then raise exception 'Business unavailable' using errcode = '42501'; end if;
  return coalesce((select enabled from private.lead_email_settings where business_id = p_business_id), true);
end;
$$;

create or replace function public.lead_email_setting_set(p_business_id uuid, p_enabled boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_enabled is null then raise exception 'Choose on or off' using errcode = '22023'; end if;
  if not public.owns_business(p_business_id) then raise exception 'Business unavailable' using errcode = '42501'; end if;
  insert into private.lead_email_settings(business_id, enabled) values (p_business_id, p_enabled)
    on conflict (business_id) do update set enabled = excluded.enabled, updated_at = clock_timestamp();
  return p_enabled;
end;
$$;

create or replace function public.lead_email_unsubscribe(p_business_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into private.lead_email_settings(business_id, enabled) values (p_business_id, false)
    on conflict (business_id) do update set enabled = false, updated_at = clock_timestamp();
exception when foreign_key_violation then
  null;
end;
$$;

revoke all on function public.lead_notifications_claim(integer), public.lead_notification_result(uuid, text, text),
  public.lead_email_setting_get(uuid), public.lead_email_setting_set(uuid, boolean), public.lead_email_unsubscribe(uuid)
  from public, anon, authenticated;
grant execute on function public.lead_notifications_claim(integer), public.lead_notification_result(uuid, text, text),
  public.lead_email_unsubscribe(uuid) to service_role;
grant execute on function public.lead_email_setting_get(uuid), public.lead_email_setting_set(uuid, boolean) to authenticated;
commit;
