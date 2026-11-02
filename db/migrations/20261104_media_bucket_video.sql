begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #748 (CEO, #2653 = A): owners' own videos on the Free plan, MP4/MOV up to 50 MB, 3 per business a month
-- (20261103_media_upload_quota.sql). The private `media` bucket also takes video and objects up to 50 MB. The bucket
-- limit is the outer bound only: the server signs uploads per kind and finalize re-reads every object, refusing a
-- photo over 8 MB or a video over 50 MB / 60 s (and the refused row still counts toward the month).
-- `media_assets` already accepts kind 'video' with video/* MIME. Nothing is signed for video until MEDIA_VIDEO_ENABLED.
-- Apply after 20261103_media_library.sql.
update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
where id = 'media';

commit;
