begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #181: deauthorizing one Meta user only clears connections that use that user's token.
create or replace function public.meta_revoke_subject(p_subject_id text)
returns integer language plpgsql security definer set search_path = private, public
as $$
declare affected_count integer; revoked_ids uuid[];
begin
  with revoked as (
    update private.meta_tokens
    set revoked_at = coalesce(revoked_at, now())
    where subject_id = p_subject_id
    returning id
  ) select coalesce(array_agg(id), '{}') into revoked_ids from revoked;
  -- Separate statement so a connection committed during the token update is also seen.
  update public.meta_connections connection
  set token_id = null, ad_account_id = null, page_id = null,
      authorization_status = 'revoked', generation = connection.generation + 1,
      updated_at = now()
  where connection.token_id = any(revoked_ids);
  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

revoke all on function public.meta_revoke_subject(text) from public, anon, authenticated;
grant execute on function public.meta_revoke_subject(text) to service_role;

commit;
