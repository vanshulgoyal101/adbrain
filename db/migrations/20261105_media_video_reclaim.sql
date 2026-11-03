begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #2653 (CTO design, CEO holds on #2835): a video's Storage copy is removed once Meta holds its own (meta_uploads.video_id).
-- `storage_reclaimed_at` marks when. The global video budget (150 MB across all businesses, under Free's 80% alert at 819 MB
-- with 613 MB already used) is enforced here, atomically, as a RESERVATION per row, not a sum of declared sizes, because a
-- row can hold more bytes than it declares:
--   * pending: the upload object (a token accepts up to the bucket's 50 MB, whatever the browser declared) plus the verified
--     copy finalize writes before it removes the upload object: 2 x 50 MB.
--   * ready: its bytes, plus 50 MB for the token window after it: a signed upload URL stays valid for 2 hours and can
--     recreate the old upload path after finalize or a delete.
--   * soft-deleted: 50 MB for that same 2-hour window, then nothing.
--   * reclaimed (storage_reclaimed_at set): nothing.
-- A row's reservation only falls over its life (pending -> ready -> window ends), so finalize never fails on the budget.
-- A BEFORE INSERT/UPDATE trigger takes one global advisory lock and, when a write RAISES a row's reservation (a new row, a
-- re-upload clearing storage_reclaimed_at, an un-delete, a bigger file), sums the other rows in SQL (no API page limit)
-- and refuses with P0001 MEDIA_VIDEO_BUDGET past 150 MB. It fires for every writer, the service role included.
-- Additive: one nullable column, one partial index, two private functions and one trigger.
-- Apply after 20261104_media_meta_uploads.sql and 20261103_media_upload_quota.sql, before MEDIA_VIDEO_ENABLED.

alter table public.media_assets add column if not exists storage_reclaimed_at timestamptz;

create index if not exists media_assets_video_in_storage_idx on public.media_assets (created_at)
  where kind = 'video' and storage_reclaimed_at is null;

create or replace function private.media_video_reserved_bytes(asset public.media_assets)
returns bigint language sql stable set search_path = '' as $$
  select case
    when asset.kind <> 'video' or asset.storage_reclaimed_at is not null then 0
    when asset.deleted_at is not null then
      case when greatest(asset.updated_at, asset.deleted_at) + interval '2 hours' > now() then 52428800 else 0 end
    when asset.status = 'pending' then 104857600
    else coalesce(asset.bytes, 0) + case when asset.updated_at + interval '2 hours' > now() then 52428800 else 0 end
  end::bigint
$$;

create or replace function private.media_assets_video_budget()
returns trigger language plpgsql set search_path = '' as $$
declare
  budget_bytes constant bigint := 150 * 1024 * 1024;
  before_bytes bigint := 0;
  after_bytes bigint;
  used bigint;
begin
  if new.kind <> 'video' then
    return new;
  end if;
  after_bytes := private.media_video_reserved_bytes(new);
  if tg_op = 'UPDATE' then
    before_bytes := private.media_video_reserved_bytes(old);
  end if;
  if after_bytes <= before_bytes then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('media_assets_video_budget', 0));
  select coalesce(sum(private.media_video_reserved_bytes(other)), 0) into used from public.media_assets other
  where other.kind = 'video' and other.storage_reclaimed_at is null and other.id <> new.id;
  if used + after_bytes > budget_bytes then
    raise exception 'MEDIA_VIDEO_BUDGET' using errcode = 'P0001',
      detail = format('%s of %s bytes reserved, %s more asked', used, budget_bytes, after_bytes);
  end if;
  return new;
end;
$$;

revoke all on function private.media_video_reserved_bytes(public.media_assets) from public, anon, authenticated;
grant execute on function private.media_video_reserved_bytes(public.media_assets) to service_role;
revoke all on function private.media_assets_video_budget() from public, anon, authenticated;

drop trigger if exists media_assets_video_budget on public.media_assets;
create trigger media_assets_video_budget
  before insert or update of bytes, status, storage_reclaimed_at, deleted_at, updated_at on public.media_assets
  for each row execute function private.media_assets_video_budget();

commit;
