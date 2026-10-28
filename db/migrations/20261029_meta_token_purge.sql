begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #1648: a revoked Meta token keeps no secret. Disconnect (`meta_disconnect`) and deauthorization
-- (`meta_revoke_subject`) set `revoked_at`; the trigger wipes the ciphertext, nonce and auth tag in the same
-- update, whichever path revokes. The row stays (subject, scopes, `revoked_at`) for audit and reauth reads.
alter table private.meta_tokens
  alter column ciphertext drop not null,
  alter column nonce drop not null,
  alter column auth_tag drop not null;

create or replace function private.meta_token_purge_on_revoke()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.revoked_at is not null then
    new.ciphertext := null;
    new.nonce := null;
    new.auth_tag := null;
  end if;
  return new;
end;
$$;
revoke all on function private.meta_token_purge_on_revoke() from public, anon, authenticated, service_role;

drop trigger if exists meta_tokens_purge_on_revoke on private.meta_tokens;
create trigger meta_tokens_purge_on_revoke
  before insert or update of revoked_at, ciphertext, nonce, auth_tag on private.meta_tokens
  for each row execute function private.meta_token_purge_on_revoke();

-- Backfill: tokens revoked before this migration.
update private.meta_tokens set ciphertext = null, nonce = null, auth_tag = null
  where revoked_at is not null and ciphertext is not null;

-- A live token always has all three parts; a revoked one has none.
alter table private.meta_tokens drop constraint if exists meta_tokens_secret_matches_revocation;
alter table private.meta_tokens add constraint meta_tokens_secret_matches_revocation check (
  case when revoked_at is null
    then ciphertext is not null and nonce is not null and auth_tag is not null
    else ciphertext is null and nonce is null and auth_tag is null
  end);

-- Belt and braces: the reader never hands out a revoked token's secret.
create or replace function public.meta_token_get(p_token_id uuid, p_business_id uuid)
returns table (id uuid, business_id uuid, ciphertext bytea, nonce bytea,
  auth_tag bytea, key_id text, format_version text, expires_at timestamptz,
  revoked_at timestamptz, granted_scopes text[], data_access_expires_at timestamptz)
language sql security definer set search_path = ''
as $$ select t.id, t.business_id,
  case when t.revoked_at is null then t.ciphertext end,
  case when t.revoked_at is null then t.nonce end,
  case when t.revoked_at is null then t.auth_tag end,
  t.key_id, t.format_version, t.expires_at, t.revoked_at, t.granted_scopes, t.data_access_expires_at
  from private.meta_tokens t
  where t.id = p_token_id and t.business_id = p_business_id; $$;
revoke all on function public.meta_token_get(uuid, uuid) from public, anon, authenticated;
grant execute on function public.meta_token_get(uuid, uuid) to service_role;

commit;
