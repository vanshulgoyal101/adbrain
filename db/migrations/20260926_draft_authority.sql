create or replace function public.initialize_owned_campaign_draft()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if current_user = 'authenticated' then
    if new.owner_id is distinct from auth.uid() or not public.owns_business(new.business_id) then
      raise exception 'Draft owner mismatch' using errcode = '42501';
    end if;
    perform 1 from public.businesses where id = new.business_id for update;
    if (select count(*) from public.campaign_drafts draft
      where draft.business_id = new.business_id and draft.expires_at > now()
        and not exists (select 1 from public.campaign_operations operation where operation.draft_id = draft.id)) >= 50 then
      raise exception 'Draft limit reached' using errcode = '23514';
    end if;
    new.version := 1;
    new.created_at := now();
    new.updated_at := now();
    new.expires_at := now() + interval '7 days';
  end if;
  return new;
end;
$$;
revoke all on function public.initialize_owned_campaign_draft() from public, anon, authenticated;
create trigger initialize_owned_campaign_draft before insert on public.campaign_drafts
  for each row execute function public.initialize_owned_campaign_draft();

create or replace function public.update_campaign_draft_if_version(
  p_draft_id uuid, p_business_id uuid, p_owner_id uuid, p_expected_version bigint,
  p_input jsonb, p_now timestamptz default now()
)
returns setof public.campaign_drafts
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_owner_id is distinct from auth.uid() or not public.owns_business(p_business_id) then
    raise exception 'Draft owner mismatch' using errcode = '42501';
  end if;
  if p_expected_version < 1 or p_expected_version >= 9007199254740991
    or p_input is null or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 65536 then
    raise exception 'Invalid draft input' using errcode = '23514';
  end if;
  perform 1 from public.campaign_drafts where id = p_draft_id
    and business_id = p_business_id and owner_id = p_owner_id for update;
  if not found then return; end if;
  return query update public.campaign_drafts
    set input = p_input, version = version + 1, updated_at = now()
    where id = p_draft_id and version = p_expected_version and expires_at > now()
      and not exists (select 1 from public.campaign_operations where draft_id = p_draft_id)
    returning *;
end;
$$;
revoke all on function public.update_campaign_draft_if_version(uuid, uuid, uuid, bigint, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.update_campaign_draft_if_version(uuid, uuid, uuid, bigint, jsonb, timestamptz) to authenticated;

create or replace function public.delete_campaign_draft_if_version(p_draft_id uuid, p_expected_version bigint)
returns setof public.campaign_drafts
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform 1 from public.campaign_drafts where id = p_draft_id and owner_id = auth.uid()
    and public.owns_business(business_id) for update;
  if not found then return; end if;
  return query delete from public.campaign_drafts
    where id = p_draft_id and version = p_expected_version
    returning *;
end;
$$;
revoke all on function public.delete_campaign_draft_if_version(uuid, bigint) from public, anon, authenticated;
grant execute on function public.delete_campaign_draft_if_version(uuid, bigint) to authenticated;
revoke all on public.campaign_drafts from public, anon, authenticated;
grant select, insert on public.campaign_drafts to authenticated;