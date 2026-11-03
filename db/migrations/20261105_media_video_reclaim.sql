begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #2653 (CTO design): a video's Storage copy is removed once Meta holds its own (meta_uploads.video_id). This marks
-- when that happened; the upload budget in signUpload sums the bytes of videos where it is still null.
-- Additive: one nullable column and one partial index. Apply after 20261104_media_meta_uploads.sql.

alter table public.media_assets add column if not exists storage_reclaimed_at timestamptz;

create index if not exists media_assets_video_in_storage_idx on public.media_assets (created_at)
  where kind = 'video' and storage_reclaimed_at is null and deleted_at is null;

commit;
