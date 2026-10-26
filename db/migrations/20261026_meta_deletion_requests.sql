-- #730: Meta's data deletion callback records a deletion request the operator can see and answer.
-- A request from the callback is bound to every AdBrain owner who connected that Meta person, or
-- left unbound (owner_id null) when none did, so the status URL's promise can still be kept.
begin;
set local lock_timeout = '5s';

alter table public.privacy_requests alter column owner_id drop not null;
alter table public.privacy_requests add column if not exists source text not null default 'owner';
alter table public.privacy_requests add column if not exists confirmation_code text;
alter table public.privacy_requests add column if not exists meta_subject_id text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'privacy_requests_source_check'
      and conrelid = 'public.privacy_requests'::regclass) then
    alter table public.privacy_requests add constraint privacy_requests_source_check check (
      (source = 'owner' and owner_id is not null and confirmation_code is null and meta_subject_id is null)
      or (source = 'meta_callback' and kind = 'delete' and confirmation_code ~ '^[a-f0-9]{16}$'
        and meta_subject_id is not null and length(meta_subject_id) between 1 and 128));
  end if;
end $$;

-- An owner's own open request stays one per kind; a callback request sits beside it.
drop index if exists public.privacy_requests_open_idx;
create unique index if not exists privacy_requests_owner_open_idx on public.privacy_requests(owner_id, kind)
  where status in ('received', 'in_review') and source = 'owner';
-- Meta retries the callback: one open request per confirmation code and owner (or unbound).
create unique index if not exists privacy_requests_meta_open_idx
  on public.privacy_requests(confirmation_code, owner_id) nulls not distinct
  where status in ('received', 'in_review') and source = 'meta_callback';
create index if not exists privacy_requests_code_idx on public.privacy_requests(confirmation_code)
  where confirmation_code is not null;

create or replace function public.meta_deletion_request_record(p_subject_id text, p_code text)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(p_subject_id, '') = '' or length(p_subject_id) > 128 or coalesce(p_code, '') !~ '^[a-f0-9]{16}$' then
    raise exception 'Invalid Meta deletion request.' using errcode = '22023';
  end if;
  insert into public.privacy_requests(owner_id, kind, source, confirmation_code, meta_subject_id)
  select distinct token.authorized_by, 'delete', 'meta_callback', p_code, p_subject_id
  from private.meta_tokens token where token.subject_id = p_subject_id
  on conflict do nothing;
  if not exists (select 1 from private.meta_tokens token where token.subject_id = p_subject_id) then
    insert into public.privacy_requests(owner_id, kind, source, confirmation_code, meta_subject_id)
    values (null, 'delete', 'meta_callback', p_code, p_subject_id)
    on conflict do nothing;
  end if;
  return (select count(*)::integer from public.privacy_requests request
    where request.confirmation_code = p_code and request.status in ('received', 'in_review'));
end;
$$;
revoke all on function public.meta_deletion_request_record(text, text) from public, anon, authenticated;
grant execute on function public.meta_deletion_request_record(text, text) to service_role;

commit;
