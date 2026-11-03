begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #2653 (CTO design, CEO hold on #2835): a video's Storage copy is removed once Meta holds its own (meta_uploads.video_id).
-- `storage_reclaimed_at` marks when. The global video budget (150 MB across all businesses, under Free's 80% alert at 819 MB
-- with 613 MB already used) is enforced here, atomically: a BEFORE INSERT/UPDATE trigger takes one global advisory lock, sums
-- the bytes of videos still in Storage in SQL (no API page limit) and refuses with P0001 MEDIA_VIDEO_BUDGET when this row would
-- pass it. It fires for every writer, the service role included, and for a re-upload that clears `storage_reclaimed_at`,
-- an un-delete, or a row that grows. Additive: one nullable column, one partial index, one private function and one trigger.
-- Apply after 20261104_media_meta_uploads.sql and 20261103_media_upload_quota.sql, before MEDIA_VIDEO_ENABLED.

alter table public.media_assets add column if not exists storage_reclaimed_at timestamptz;

create index if not exists media_assets_video_in_storage_idx on public.media_assets (created_at)
  where kind = 'video' and storage_reclaimed_at is null and deleted_at is null;

create or replace function private.media_assets_video_budget()
returns trigger language plpgsql set search_path = '' as $$
declare
  budget_bytes constant bigint := 150 * 1024 * 1024;
  used bigint;
begin
  if new.kind <> 'video' or new.storage_reclaimed_at is not null or new.deleted_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.kind = 'video' and old.storage_reclaimed_at is null and old.deleted_at is null
     and coalesce(new.bytes, 0) <= coalesce(old.bytes, 0) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('media_assets_video_budget', 0));
  select coalesce(sum(bytes), 0) into used from public.media_assets
  where kind = 'video' and storage_reclaimed_at is null and deleted_at is null and id <> new.id;
  if used + coalesce(new.bytes, 0) > budget_bytes then
    raise exception 'MEDIA_VIDEO_BUDGET' using errcode = 'P0001',
      detail = format('%s of %s bytes held, %s more asked', used, budget_bytes, coalesce(new.bytes, 0));
  end if;
  return new;
end;
$$;

revoke all on function private.media_assets_video_budget() from public, anon, authenticated;

drop trigger if exists media_assets_video_budget on public.media_assets;
create trigger media_assets_video_budget
  before insert or update of bytes, storage_reclaimed_at, deleted_at on public.media_assets
  for each row execute function private.media_assets_video_budget();

commit;
