-- #784 (#744 phase 1, #790 design): before an owner's own photos or videos are accepted, they confirm
-- they own them or have permission (music and the people shown included). `media_consents` is the
-- append-only record: which terms version, who, when, and whether the people-in-photos clause was
-- shown and ticked. Owners read their own rows and add one only through media_consent_record(); nobody
-- updates or deletes a row (a business deletion cascades). Additive: no existing table changes.
begin;
set local lock_timeout = '5s';

create table if not exists public.media_consents (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  terms_version text not null check (terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,3})?$'),
  people_confirmed boolean not null default false,
  confirmed_at timestamptz not null default now()
);
create index if not exists media_consents_business_idx on public.media_consents(business_id, terms_version, confirmed_at desc);
create index if not exists media_consents_user_idx on public.media_consents(user_id);

alter table public.media_consents enable row level security;
revoke all on public.media_consents from public, anon, authenticated, service_role;
grant select on public.media_consents to authenticated;
grant select, insert on public.media_consents to service_role;
grant usage on sequence public.media_consents_id_seq to service_role;

drop policy if exists "media consents: read own" on public.media_consents;
create policy "media consents: read own" on public.media_consents
  for select to authenticated using (public.owns_business(business_id));

-- The signed-in owner confirms the current terms for their business; the row records who and when.
create or replace function public.media_consent_record(p_business_id uuid, p_terms_version text, p_people_confirmed boolean)
returns public.media_consents language plpgsql security definer set search_path = '' as $$
declare saved public.media_consents;
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then
    raise insufficient_privilege using message = 'Business access denied';
  end if;
  if coalesce(p_terms_version, '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,3})?$' or p_people_confirmed is null then
    raise invalid_parameter_value using message = 'Invalid consent';
  end if;
  insert into public.media_consents(business_id, user_id, terms_version, people_confirmed)
  values (p_business_id, auth.uid(), p_terms_version, p_people_confirmed)
  returning * into saved;
  return saved;
end;
$$;
revoke all on function public.media_consent_record(uuid, text, boolean) from public, anon;
grant execute on function public.media_consent_record(uuid, text, boolean) to authenticated;

commit;
