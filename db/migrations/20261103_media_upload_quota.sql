begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #1209 (Reviewer must-fix on #2644): the monthly upload limit must hold under parallel requests. signUpload's
-- count-then-insert let parallel sign calls with different files pass 50. A BEFORE INSERT trigger now takes a
-- per-business transaction advisory lock, counts this IST calendar month's uploads of the same kind (retired and
-- soft-deleted rows still count, as in store.ts) and refuses the insert at the limit: 50 photos, 3 videos (CEO, #2653).
-- It fires for every writer, the service role included. Additive: one private function and one trigger.
-- Apply after 20261103_media_library.sql.

create or replace function private.media_assets_upload_quota()
returns trigger language plpgsql set search_path = '' as $$
declare
  month_start constant timestamptz := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  monthly_limit constant integer := case new.kind when 'video' then 3 else 50 end;
  used integer;
begin
  if new.source <> 'upload' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('media_assets_upload_quota:' || new.business_id::text, 0));
  -- After the lock, so this count sees every upload committed by the request that held it.
  select count(*) into used from public.media_assets
  where business_id = new.business_id and source = 'upload' and kind = new.kind and created_at >= month_start;
  if used >= monthly_limit then
    raise exception 'MEDIA_QUOTA' using errcode = 'P0001',
      detail = format('%s of %s %s uploads this month', used, monthly_limit, new.kind);
  end if;
  return new;
end;
$$;

revoke all on function private.media_assets_upload_quota() from public, anon, authenticated;

drop trigger if exists media_assets_upload_quota on public.media_assets;
create trigger media_assets_upload_quota
  before insert on public.media_assets
  for each row execute function private.media_assets_upload_quota();

commit;
