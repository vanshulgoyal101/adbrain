begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #1209 (#744 phase 1 slice A; #748, #778) and #784: owners upload their own photos into a private bucket, see
-- them in a media library, and first confirm they own them or have permission. One migration (Dev 7, #744: the
-- old #1224 and #1248 both claimed media_consents). Additive: two new tables, one owner-checked function, one
-- nullable column on creatives, one FK on campaign_ads and one private bucket. Nothing existing changes.
-- Apply after 20261102_website_destination.sql (#2597); the two touch different objects.
--
-- media_assets: one row per uploaded file. The browser uploads straight to Storage with a signed upload URL the
-- server minted (bytes never pass through Vercel), so a row starts 'pending' and the server sets 'ready' after it
-- re-checks the stored object. Owners read their own rows; only the service role writes. One live row per file
-- (business, sha256), so the same photo isn't stored twice. Delete is soft (deleted_at); the object goes first.
-- The row already accepts MP4/MOV for kind 'video' (phase 2, MEDIA_VIDEO_ENABLED); the bucket stays image-only
-- until the CEO's Supabase Pro call, so no video byte can be stored yet.
create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null default 'image' check (kind in ('image', 'video')),
  source text not null default 'upload' check (source in ('upload', 'ai', 'brand')),
  bucket text not null default 'media' check (bucket = 'media'),
  path text not null check (char_length(path) between 3 and 300),
  name text check (char_length(name) <= 120),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes bigint check (bytes > 0),
  mime text check (mime in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime')),
  width integer check (width > 0),
  height integer check (height > 0),
  duration_ms integer check (duration_ms > 0),
  poster_path text check (char_length(poster_path) <= 300),
  description text check (char_length(description) <= 2000),
  visible_text text check (char_length(visible_text) <= 2000),
  checks jsonb not null default '{}'::jsonb,
  flags jsonb not null default '{}'::jsonb,
  creative_id uuid references public.creatives(id) on delete set null,
  rights_confirmed_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'ready', 'delete_failed')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The object lives under the business's own folder: <business_id>/<file>.
  check (split_part(path, '/', 1) = business_id::text),
  check (poster_path is null or split_part(poster_path, '/', 1) = business_id::text),
  -- A photo is an image type and a video a video type.
  check (mime is null or split_part(mime, '/', 1) = kind)
);
create unique index if not exists media_assets_live_sha256_idx on public.media_assets(business_id, sha256) where deleted_at is null;
create unique index if not exists media_assets_bucket_path_idx on public.media_assets(bucket, path);
create index if not exists media_assets_business_created_idx on public.media_assets(business_id, created_at desc);
create index if not exists media_assets_pending_idx on public.media_assets(status, created_at) where status = 'pending';
create index if not exists media_assets_creative_idx on public.media_assets(creative_id) where creative_id is not null;
-- Links from creatives and campaign_ads name the same business (a foreign key ignores RLS, so a plain id link
-- would let an owner point their own ad at another business's photo).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'media_assets_business_id_id_key' and conrelid = 'public.media_assets'::regclass) then
    alter table public.media_assets add constraint media_assets_business_id_id_key unique (business_id, id);
  end if;
end
$$;

alter table public.media_assets enable row level security;
revoke all on public.media_assets from public, anon, authenticated, service_role;
grant select on public.media_assets to authenticated;
grant select, insert, update, delete on public.media_assets to service_role;

drop policy if exists "media assets: read own" on public.media_assets;
create policy "media assets: read own" on public.media_assets
  for select to authenticated using (public.owns_business(business_id));

-- The ad made from an uploaded photo points back at it (#748, #752); deleting the photo keeps the ad.
alter table public.creatives add column if not exists media_asset_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'creatives_same_business_media_asset' and conrelid = 'public.creatives'::regclass) then
    alter table public.creatives add constraint creatives_same_business_media_asset foreign key (business_id, media_asset_id)
      references public.media_assets(business_id, id) on delete set null (media_asset_id);
  end if;
end
$$;
create index if not exists creatives_media_asset_idx on public.creatives(media_asset_id) where media_asset_id is not null;

-- campaign_ads.media_asset_id waited for this table (20261026_campaign_ads_ad_results.sql).
do $$
begin
  if to_regclass('public.campaign_ads') is not null then
    alter table public.campaign_ads add column if not exists media_asset_id uuid;
    if not exists (select 1 from pg_constraint where conname = 'campaign_ads_media_asset_id_fkey' and conrelid = 'public.campaign_ads'::regclass) then
      alter table public.campaign_ads add constraint campaign_ads_media_asset_id_fkey
        foreign key (business_id, media_asset_id) references public.media_assets(business_id, id) on delete set null (media_asset_id);
    end if;
    create index if not exists campaign_ads_media_asset_idx on public.campaign_ads(media_asset_id) where media_asset_id is not null;
  end if;
end
$$;

-- #784 (#790 design): media_consents is the append-only rights record: which terms version, who, when, and
-- whether the people-in-photos clause was shown and ticked. Owners read their own rows and add one only through
-- media_consent_record(); nobody updates or deletes a row (a business deletion cascades).
create table if not exists public.media_consents (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  terms_version text not null check (terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,3})?$'),
  people_confirmed boolean not null default false,
  confirmed_at timestamptz not null default now()
);
create index if not exists media_consents_business_idx on public.media_consents(business_id, terms_version, confirmed_at desc);
create index if not exists media_consents_user_idx on public.media_consents(user_id);

alter table public.media_consents enable row level security;
revoke all on public.media_consents from public, anon, authenticated, service_role;
grant select on public.media_consents to authenticated;
grant select, insert on public.media_consents to service_role;
grant usage on sequence public.media_consents_id_seq to service_role;

drop policy if exists "media consents: read own" on public.media_consents;
create policy "media consents: read own" on public.media_consents
  for select to authenticated using (public.owns_business(business_id));

-- The signed-in owner confirms the current terms for their business; the row records who and when.
create or replace function public.media_consent_record(p_business_id uuid, p_terms_version text, p_people_confirmed boolean)
returns public.media_consents language plpgsql security definer set search_path = '' as $$
declare saved public.media_consents;
begin
  if auth.uid() is null or not public.owns_business(p_business_id) then
    raise insufficient_privilege using message = 'Business access denied';
  end if;
  if coalesce(p_terms_version, '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,3})?$' or p_people_confirmed is null then
    raise invalid_parameter_value using message = 'Invalid consent';
  end if;
  insert into public.media_consents(business_id, user_id, terms_version, people_confirmed)
  values (p_business_id, auth.uid(), p_terms_version, p_people_confirmed)
  returning * into saved;
  return saved;
end;
$$;
revoke all on function public.media_consent_record(uuid, text, boolean) from public, anon;
grant execute on function public.media_consent_record(uuid, text, boolean) to authenticated;

-- Private bucket (CEO, #744: faces and rights, private from day one). Owners read their own folder (signed URLs);
-- nobody but the service role writes: uploads use a signed upload URL the server minted, which needs no object
-- policy. Stored photos are re-encoded in the browser to at most 8 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "media: read own" on storage.objects;
create policy "media: read own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'media'
    and public.owns_business(((storage.foldername(name))[1])::uuid)
  );

commit;
