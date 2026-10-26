-- #731 (Reviewer, before outside pilots): close two leftovers that matter once strangers sign up.
-- 1. public.meta_credentials (legacy plaintext tokens; no rows, no reader left) is server-only.
-- 2. Public storage buckets accept only the images AdBrain writes, within a size limit.
begin;
set local lock_timeout = '5s';

do $$ begin
  if to_regclass('public.meta_credentials') is not null then
    revoke all on public.meta_credentials from public, anon, authenticated;
  end if;
end $$;

-- Brand uploads are capped at 5 MB in the browser; creatives are re-encoded PNG up to 20 MB (MAX_IMAGE_BYTES).
update storage.buckets
  set file_size_limit = 10485760, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
  where id = 'brand-assets';
update storage.buckets
  set file_size_limit = 20971520, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
  where id = 'creatives';

commit;
