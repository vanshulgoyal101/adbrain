begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #2653: reserve both 50 MiB paths before upload and keep them accounted after logical deletion.
-- This does not delete Storage objects or prove provider-side version cleanup. Keep video activation and
-- migration application behind the existing legacy-data and release gates.
do $$
begin
  if to_regclass('private.media_video_slots') is null and (
    exists (select 1 from public.media_assets where kind = 'video')
    or exists (select 1 from storage.objects where bucket_id = 'media-video')
  ) then
    raise exception 'MEDIA_VIDEO_LEGACY_UNSAFE' using errcode = 'P0001';
  end if;
end;
$$;

alter table public.media_assets add column if not exists upload_path text;
alter table public.media_assets add column if not exists storage_reclaimed_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media-video', 'media-video', false, 52428800, array['video/mp4', 'video/quicktime'])
on conflict (id) do nothing;

create table if not exists private.media_video_slots (
  asset_id uuid not null,
  slot text not null check (slot in ('upload', 'final')),
  path text,
  reserved_bytes bigint not null check (reserved_bytes > 0),
  state text not null check (state in ('reserved', 'writing', 'verified', 'removed')),
  signing_intent uuid,
  token_expires_at timestamptz,
  primary key (asset_id, slot),
  check ((slot = 'upload' and path is not null and state = 'reserved') or slot = 'final'),
  check (slot = 'upload' or (signing_intent is null and token_expires_at is null))
);

create unique index if not exists media_video_slots_path_idx
  on private.media_video_slots (path) where path is not null;

drop trigger if exists media_assets_video_budget on public.media_assets;
drop function if exists private.media_assets_video_budget();
drop function if exists private.media_video_reserved_bytes(public.media_assets);

create or replace function private.media_video_bucket_safe()
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1
    from storage.buckets b
    where b.id = 'media-video'
      and b.name = 'media-video'
      and b.public is false
      and b.file_size_limit = 52428800
      and cardinality(b.allowed_mime_types) = 2
      and b.allowed_mime_types @> array['video/mp4', 'video/quicktime']
  )
$$;

create or replace function private.media_video_object_bytes(p_metadata jsonb)
returns bigint language plpgsql immutable set search_path = '' as $$
declare
  raw_size text;
  digits text;
begin
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'MEDIA_VIDEO_STORAGE_UNKNOWN' using errcode = 'P0001';
  end if;

  raw_size := p_metadata ->> 'size';
  if raw_size is null or raw_size !~ '^[0-9]+$' then
    raise exception 'MEDIA_VIDEO_STORAGE_UNKNOWN' using errcode = 'P0001';
  end if;
  digits := coalesce(nullif(ltrim(raw_size, '0'), ''), '0');
  if length(digits) > 19 or (length(digits) = 19 and digits > '9223372036854775807') then
    raise exception 'MEDIA_VIDEO_STORAGE_UNKNOWN' using errcode = 'P0001';
  end if;

  return digits::bigint;
end;
$$;

create or replace function private.media_video_held_bytes()
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  item record;
  object_size bigint;
  held numeric := 0;
begin
  for item in
    select o.name, o.metadata, s.reserved_bytes
    from storage.objects o
    left join private.media_video_slots s on s.path = o.name
    where o.bucket_id = 'media-video'
  loop
    object_size := private.media_video_object_bytes(item.metadata);
    if item.reserved_bytes is null then
      held := held + object_size;
    else
      held := held + greatest(item.reserved_bytes, object_size);
    end if;
  end loop;

  for item in
    select s.reserved_bytes
    from private.media_video_slots s
    where s.path is null
      or not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'media-video' and o.name = s.path
      )
  loop
    held := held + item.reserved_bytes;
  end loop;

  if held > 9223372036854775807 then
    raise exception 'MEDIA_VIDEO_BUDGET' using errcode = 'P0001';
  end if;
  return held::bigint;
end;
$$;

create or replace function private.media_assets_video_lifecycle()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  held bigint;
  actual_bytes bigint;
  final_state text;
  final_path text;
begin
  if tg_op = 'INSERT' then
    if new.kind <> 'video' then
      return new;
    end if;
    if not private.media_video_bucket_safe() then
      raise exception 'MEDIA_VIDEO_BUCKET_UNSAFE' using errcode = 'P0001';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('media_video_global_budget', 0));
    held := private.media_video_held_bytes();
    if held::numeric + 104857600 > 157286400 then
      raise exception 'MEDIA_VIDEO_BUDGET' using errcode = 'P0001',
        detail = format('%s of 157286400 bytes held, 104857600 reserved', held);
    end if;

    new.upload_path := new.path;
    insert into private.media_video_slots (asset_id, slot, path, reserved_bytes, state)
    values
      (new.id, 'upload', new.upload_path, 52428800, 'reserved'),
      (new.id, 'final', null, 52428800, 'reserved');
    return new;
  end if;

  if new.kind is distinct from old.kind then
    raise exception 'MEDIA_VIDEO_STATE' using errcode = '23514';
  end if;
  if old.kind <> 'video' then
    return new;
  end if;
  if new.upload_path is distinct from old.upload_path then
    raise exception 'MEDIA_VIDEO_STATE' using errcode = '23514';
  end if;
  if old.status = 'ready' and new.path is distinct from old.path then
    raise exception 'MEDIA_VIDEO_STATE' using errcode = '23514';
  end if;

  if new.status = 'ready' and old.status is distinct from 'ready' then
    select s.state, s.path into final_state, final_path
    from private.media_video_slots s
    where s.asset_id = old.id and s.slot = 'final'
    for update;

    if final_state is distinct from 'writing' or final_path is distinct from new.path
      or new.bytes is null or new.bytes > 52428800 then
      raise exception 'MEDIA_VIDEO_STATE' using errcode = '23514';
    end if;

    select private.media_video_object_bytes(o.metadata) into actual_bytes
    from storage.objects o
    where o.bucket_id = 'media-video' and o.name = new.path;
    if not found or actual_bytes is distinct from new.bytes then
      raise exception 'MEDIA_VIDEO_STATE' using errcode = '23514';
    end if;

    update private.media_video_slots
    set state = 'verified', reserved_bytes = new.bytes
    where asset_id = old.id and slot = 'final' and state = 'writing' and path = new.path;
  end if;

  return new;
end;
$$;

drop trigger if exists media_assets_video_lifecycle on public.media_assets;
create trigger media_assets_video_lifecycle
  before insert or update on public.media_assets
  for each row execute function private.media_assets_video_lifecycle();

create or replace function public.media_video_sign_begin(p_asset_id uuid, p_upload_path text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  asset_status text;
  asset_upload_path text;
  asset_deleted_at timestamptz;
  intent uuid := gen_random_uuid();
  changed integer;
begin
  if not private.media_video_bucket_safe() then
    raise exception 'MEDIA_VIDEO_BUCKET_UNSAFE' using errcode = 'P0001';
  end if;

  select m.status, m.upload_path, m.deleted_at
  into asset_status, asset_upload_path, asset_deleted_at
  from public.media_assets m
  where m.id = p_asset_id and m.kind = 'video'
  for update;
  if not found or asset_status <> 'pending' or asset_deleted_at is not null
    or asset_upload_path is distinct from p_upload_path then
    return null;
  end if;

  update private.media_video_slots u
  set signing_intent = intent
  where u.asset_id = p_asset_id and u.slot = 'upload' and u.path = p_upload_path
    and u.state = 'reserved' and u.signing_intent is null
    and exists (
      select 1 from private.media_video_slots f
      where f.asset_id = p_asset_id and f.slot = 'final' and f.state = 'reserved' and f.path is null
    );
  get diagnostics changed = row_count;
  if changed = 0 then
    raise exception 'MEDIA_VIDEO_BUSY' using errcode = 'P0001';
  end if;
  return intent;
end;
$$;

create or replace function public.media_video_sign_finish(p_asset_id uuid, p_intent_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  asset_status text;
  asset_deleted_at timestamptz;
  current_intent uuid;
begin
  if not private.media_video_bucket_safe() then
    raise exception 'MEDIA_VIDEO_BUCKET_UNSAFE' using errcode = 'P0001';
  end if;

  select m.status, m.deleted_at into asset_status, asset_deleted_at
  from public.media_assets m
  where m.id = p_asset_id and m.kind = 'video'
  for update;
  if not found or asset_status <> 'pending' or asset_deleted_at is not null then
    return false;
  end if;

  select u.signing_intent into current_intent
  from private.media_video_slots u
  where u.asset_id = p_asset_id and u.slot = 'upload' and u.state = 'reserved'
  for update;
  if not found or current_intent is distinct from p_intent_id then
    return false;
  end if;

  update private.media_video_slots
  set signing_intent = null, token_expires_at = clock_timestamp() + interval '2 hours'
  where asset_id = p_asset_id and slot = 'upload' and signing_intent = p_intent_id;
  return found;
end;
$$;

create or replace function public.media_video_finalize_claim(p_asset_id uuid, p_upload_path text, p_final_path text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  asset_status text;
  asset_upload_path text;
  asset_deleted_at timestamptz;
  asset_business_id uuid;
  upload_intent uuid;
  final_state text;
  final_path text;
begin
  if not private.media_video_bucket_safe() then
    raise exception 'MEDIA_VIDEO_BUCKET_UNSAFE' using errcode = 'P0001';
  end if;

  select m.status, m.upload_path, m.deleted_at, m.business_id
  into asset_status, asset_upload_path, asset_deleted_at, asset_business_id
  from public.media_assets m
  where m.id = p_asset_id and m.kind = 'video'
  for update;
  if not found or asset_status <> 'pending' or asset_deleted_at is not null
    or asset_upload_path is distinct from p_upload_path
    or p_final_path is null or p_final_path = p_upload_path
    or split_part(p_final_path, '/', 1) <> asset_business_id::text
    or char_length(p_final_path) not between 3 and 300 then
    return false;
  end if;

  select u.signing_intent into upload_intent
  from private.media_video_slots u
  where u.asset_id = p_asset_id and u.slot = 'upload' and u.path = p_upload_path
  for update;
  if not found or upload_intent is not null then
    return false;
  end if;

  select f.state, f.path into final_state, final_path
  from private.media_video_slots f
  where f.asset_id = p_asset_id and f.slot = 'final'
  for update;
  if final_state is distinct from 'reserved' or final_path is not null
    or exists (select 1 from storage.objects o where o.bucket_id = 'media-video' and o.name = p_final_path) then
    return false;
  end if;

  update private.media_video_slots
  set path = p_final_path, state = 'writing'
  where asset_id = p_asset_id and slot = 'final' and state = 'reserved' and path is null;
  return found;
end;
$$;

create or replace function public.media_video_final_removed(p_asset_id uuid, p_final_path text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  final_state text;
  final_path text;
begin
  select f.state, f.path into final_state, final_path
  from private.media_video_slots f
  where f.asset_id = p_asset_id and f.slot = 'final'
  for update;
  if not found or final_state <> 'verified' or final_path is distinct from p_final_path
    or exists (select 1 from storage.objects o where o.bucket_id = 'media-video' and o.name = p_final_path) then
    return false;
  end if;

  update private.media_video_slots set state = 'removed'
  where asset_id = p_asset_id and slot = 'final' and state = 'verified' and path = p_final_path;
  return found;
end;
$$;

revoke all on table private.media_video_slots from public, anon, authenticated, service_role;
revoke all on function private.media_video_bucket_safe() from public, anon, authenticated, service_role;
revoke all on function private.media_video_object_bytes(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.media_video_held_bytes() from public, anon, authenticated;
grant execute on function private.media_video_held_bytes() to service_role;
revoke all on function private.media_assets_video_lifecycle() from public, anon, authenticated, service_role;

revoke all on function public.media_video_sign_begin(uuid, text) from public, anon, authenticated;
revoke all on function public.media_video_sign_finish(uuid, uuid) from public, anon, authenticated;
revoke all on function public.media_video_finalize_claim(uuid, text, text) from public, anon, authenticated;
revoke all on function public.media_video_final_removed(uuid, text) from public, anon, authenticated;
grant execute on function public.media_video_sign_begin(uuid, text) to service_role;
grant execute on function public.media_video_sign_finish(uuid, uuid) to service_role;
grant execute on function public.media_video_finalize_claim(uuid, text, text) to service_role;
grant execute on function public.media_video_final_removed(uuid, text) to service_role;

commit;
