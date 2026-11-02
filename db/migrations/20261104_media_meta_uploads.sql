begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #749 (#744): the contract between an owner's file and Meta. One row per (media asset, ad account): the image hash or
-- video id Meta gave that account for it, so a file is never uploaded twice and an owner who changes ad account gets a
-- fresh upload. A video row is claimed ('starting', with the unique upload_name) before the POST, so an answer that
-- never arrived is found again by that name instead of uploading a second copy. Needs 20261103_media_library.sql.
-- Owners read their own rows; only the service role writes. Additive.
-- The row's business is its asset's business: the FK uses media_assets' unique (business_id, id) from 20261103.
create table if not exists public.media_meta_uploads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  media_asset_id uuid not null,
  ad_account_id text not null check (ad_account_id ~ '^act_[0-9]{1,30}$'),
  kind text not null check (kind in ('image', 'video')),
  attempt integer not null default 1 check (attempt between 1 and 20),
  upload_name text check (char_length(upload_name) between 1 and 120),
  image_hash text check (image_hash ~ '^[0-9a-f]{32}$'),
  video_id text check (video_id ~ '^[0-9]{1,30}$'),
  status text not null check (status in ('starting', 'processing', 'ready', 'error')),
  problem text check (problem in ('unreachable', 'format', 'file', 'too_small', 'invalid', 'reconnect', 'throttled', 'unknown')),
  width integer check (width > 0),
  height integer check (height > 0),
  length_ms integer check (length_ms > 0),
  instagram_eligible boolean,
  claimed_at timestamptz not null default now(),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (media_asset_id, ad_account_id),
  foreign key (business_id, media_asset_id) references public.media_assets(business_id, id) on delete cascade,
  check (kind = 'video' or (video_id is null and upload_name is null)),
  check (kind = 'image' or image_hash is null),
  check (status <> 'ready' or image_hash is not null or video_id is not null),
  check ((status = 'error') = (problem is not null))
);
-- Leads with (business_id, media_asset_id), so it covers both foreign keys (businesses, and the same-business asset FK).
create index if not exists media_meta_uploads_business_asset_idx on public.media_meta_uploads(business_id, media_asset_id);

alter table public.media_meta_uploads enable row level security;
revoke all on public.media_meta_uploads from public, anon, authenticated, service_role;
grant select on public.media_meta_uploads to authenticated;
grant select, insert, update, delete on public.media_meta_uploads to service_role;

drop policy if exists "media meta uploads: read own" on public.media_meta_uploads;
create policy "media meta uploads: read own" on public.media_meta_uploads
  for select to authenticated using (public.owns_business(business_id));

commit;
