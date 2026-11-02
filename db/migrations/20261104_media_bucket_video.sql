begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #748 (CEO, #2653 = A): owners' own videos, MP4/MOV up to 50 MB, 3 per business a month (20261103_media_upload_quota.sql).
-- Their own private bucket (QA 2 on #2735): the photo bucket `media` stays at 8 MB images, so a photo upload token can
-- never park 50 MB. The server signs video uploads here only behind MEDIA_VIDEO_ENABLED, and finalize re-reads every
-- object (type, size, length) before a row is ready. Paths are `<business id>/<uuid>.mp4|.mov`, like `media`.
-- Apply after 20261103_media_library.sql (owns_business).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media-video', 'media-video', false, 52428800, array['video/mp4', 'video/quicktime'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Owners read their own business's videos (the library signs its links as the owner, like `media`). No write policy:
-- uploads only through the server's signed URL.
drop policy if exists "media-video: read own" on storage.objects;
create policy "media-video: read own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'media-video'
    and public.owns_business(((storage.foldername(name))[1])::uuid)
  );

commit;
