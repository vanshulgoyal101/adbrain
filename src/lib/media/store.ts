import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { getEnv } from "@/lib/env";
import { readVideo, stripVideoMetadata } from "@/lib/media/mp4";
import {
  isMediaMime, isMediaVideoMime, MAX_AD_PHOTOS, mediaBucket, MEDIA_EXTENSION, MEDIA_MAX_BYTES, MEDIA_MAX_LONG_SIDE, MEDIA_MONTHLY_UPLOADS,
  MEDIA_MONTHLY_VIDEOS, MEDIA_VIDEO_EXTENSION, MEDIA_VIDEO_MAX_BYTES, mediaFit, videoRefusal, type MediaFit, type MediaMime,
} from "@/lib/media/rules";

/**
 * #1209 (#748): owners' own photos. The browser asks `sign` for a one-time upload URL, uploads the bytes straight
 * to the private `media` bucket, then calls `finalize`, which re-reads the stored object before it's listed.
 * Only the service role writes rows and objects; owners read their own under RLS.
 */
export function mediaUploadsEnabled(): boolean {
  return getEnv().MEDIA_UPLOADS_ENABLED;
}

/** #748 (#2653 = A): videos need their own flag on top of uploads (the bucket must take MP4/MOV first). */
export function mediaVideoEnabled(): boolean {
  const env = getEnv();
  return env.MEDIA_UPLOADS_ENABLED && env.MEDIA_VIDEO_ENABLED;
}

export type MediaKind = "image" | "video";
/** A month's uploads per kind; the database holds the same numbers (20261103_media_upload_quota.sql). */
export const MEDIA_MONTHLY_LIMIT: Record<MediaKind, number> = { image: MEDIA_MONTHLY_UPLOADS, video: MEDIA_MONTHLY_VIDEOS };

export type MediaRow = {
  id: string; business_id: string; kind: MediaKind; path: string; name: string | null; tags: string[]; sha256: string;
  bytes: number | null; mime: string | null; width: number | null; height: number | null; duration_ms: number | null;
  checks: Record<string, unknown>; status: "pending" | "ready" | "delete_failed"; deleted_at: string | null; created_at: string;
  /** #780: what the photo shows and the words printed in it, saved by the first Create that used it. */
  description?: string | null; visible_text?: string | null;
};
export type MediaView = {
  id: string; kind: MediaKind; name: string | null; tags: string[]; width: number | null; height: number | null; bytes: number | null;
  durationMs: number | null; fit: MediaFit | null; url: string | null; createdAt: string;
};

export class MediaError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "MediaError";
  }
}

const COLUMNS = "id, business_id, kind, path, name, tags, sha256, bytes, mime, width, height, duration_ms, checks, status, deleted_at, created_at, description, visible_text";
const URL_SECONDS = 3600;

/** Start of the current month in India (the pilots' billing month), as an ISO instant. */
export function monthStartIst(now = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 5.5 * 3_600_000).toISOString();
}

export async function monthlyUploads(admin: SupabaseClient, businessId: string, kind: MediaKind = "image", now = new Date()): Promise<number> {
  const { count, error } = await admin.from("media_assets").select("id", { count: "exact", head: true })
    .eq("business_id", businessId).eq("source", "upload").eq("kind", kind).gte("created_at", monthStartIst(now));
  if (error) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't check your uploads. Try again.");
  return count ?? 0;
}

/** #2653: the database's global video budget (20261105_media_video_reclaim.sql) is full; photos still work. */
function videoPausedError(): MediaError {
  return new MediaError(503, "MEDIA_VIDEO_PAUSED", "Video uploads are paused. Please use photos instead.");
}

function videoBusyError(): MediaError {
  return new MediaError(409, "MEDIA_FINALIZING", "This video can't finish yet. Try again later or use a photo.");
}

function videoLifecycleError(error: { message: string } | null): MediaError {
  if (error?.message === "MEDIA_VIDEO_BUDGET" || error?.message === "MEDIA_VIDEO_STORAGE_UNKNOWN" || error?.message === "MEDIA_VIDEO_BUCKET_UNSAFE") return videoPausedError();
  if (error?.message === "MEDIA_VIDEO_BUSY") return videoBusyError();
  return new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't save the video. Try again.");
}

function quotaError(kind: MediaKind, now = new Date()): MediaError {
  const limit = MEDIA_MONTHLY_LIMIT[kind];
  if (kind === "image") return new MediaError(429, "MEDIA_QUOTA", `You've used ${limit} of ${limit} photo uploads this month.`);
  const next = Date.parse(monthStartIst(new Date(Date.parse(monthStartIst(now)) + 32 * 86_400_000))) + 5.5 * 3_600_000;
  const month = new Date(next).toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return new MediaError(429, "MEDIA_QUOTA", `You've used ${limit} of ${limit} videos this month. More from 1 ${month}; photos still work.`);
}

/** `rightsConfirmedAt`: when the route found the owner's current rights confirmation (#784, #1248's `hasCurrentMediaConsent`). */
/** `durationMs`: a video's length as the browser read it (#748); finalize re-reads it from the file. */
export type SignInput = { businessId: string; userId: string; mime: string; bytes: number; sha256: string; width: number; height: number; durationMs?: number; name?: string; rightsConfirmedAt: string };
export type SignResult =
  | { duplicate: true; asset: MediaView }
  | { duplicate: false; id: string; bucket: string; path: string; token: string; fit: MediaFit };

export async function signUpload(admin: SupabaseClient, input: SignInput): Promise<SignResult> {
  const kind: MediaKind = isMediaVideoMime(input.mime) && mediaVideoEnabled() ? "video" : "image";
  if (kind === "video") {
    // Designer (#744): refused here, before any row exists, so an honest refusal doesn't use up one of the month's 3.
    const refusal = input.durationMs ? videoRefusal(input.mime, input.bytes, input.durationMs) : { status: 415, code: "MEDIA_TYPE", message: "Please choose an MP4 or MOV video." };
    if (refusal) throw new MediaError(refusal.status, refusal.code, refusal.message);
  } else {
    if (!isMediaMime(input.mime)) throw new MediaError(415, "MEDIA_TYPE", "Please choose a JPG, PNG or WebP photo.");
    if (input.bytes > MEDIA_MAX_BYTES) throw new MediaError(413, "MEDIA_TOO_LARGE", "This photo is over 8 MB after resizing. Choose a smaller one.");
  }
  const fit = mediaFit(input.width, input.height, kind);
  if (fit.level === "too_small") throw new MediaError(422, "MEDIA_TOO_SMALL", fit.message);

  let existing = await liveBySha(admin, input.businessId, input.sha256);
  if (existing?.status === "ready") return { duplicate: true, asset: (await mediaViews(admin, [existing]))[0] };
  if (existing && Date.parse(existing.created_at) < Date.parse(monthStartIst())) {
    // The monthly limit is enforced on insert (20261103_media_upload_quota.sql), so a pending row from an earlier month
    // isn't reused (#2644 attack: 50 stale rows finished next month doubled the limit). It's retired, still counting in
    // its own month, and this try gets a new row that the limit sees.
    if (existing.kind === "video") {
      const { error } = await admin.storage.from(mediaBucket(existing.kind)).remove([existing.path]);
      if (error) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't start the upload. Try again.");
    } else {
      await admin.storage.from(mediaBucket(existing.kind)).remove([existing.path]).catch(() => undefined);
    }
    const { error } = await admin.from("media_assets").update({ deleted_at: new Date().toISOString() })
      .eq("id", existing.id).eq("status", "pending").is("deleted_at", null);
    if (error) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't start the upload. Try again.");
    existing = null;
  }
  if (!existing && await monthlyUploads(admin, input.businessId, kind) >= MEDIA_MONTHLY_LIMIT[kind]) throw quotaError(kind);

  // Reuse one logical upload path so old tokens do not create untracked names. This does not bound concurrent backend
  // versions created by replaying a token; the held video rollout needs a separate provider-backed admission bound.
  let row = existing;
  let intent: string | null = null;
  if (row?.kind === "video") {
    const { data, error } = await admin.rpc("media_video_sign_begin", { p_asset_id: row.id, p_upload_path: row.path });
    if (error || typeof data !== "string") throw videoLifecycleError(error);
    intent = data;
  }
  if (row) {
    if (row.kind === "video") {
      const { error } = await admin.storage.from(mediaBucket(row.kind)).remove([row.path]);
      if (error) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't start the upload. Try again.");
    } else {
      await admin.storage.from(mediaBucket(row.kind)).remove([row.path]).catch(() => undefined);
    }
  }
  if (!row) {
    const extension = kind === "video" ? MEDIA_VIDEO_EXTENSION[input.mime as keyof typeof MEDIA_VIDEO_EXTENSION] : MEDIA_EXTENSION[input.mime as MediaMime];
    const path = `${input.businessId}/${randomUUID()}.${extension}`;
    const { data, error } = await admin.from("media_assets").insert({
      business_id: input.businessId, kind, path, sha256: input.sha256, mime: input.mime, bytes: input.bytes,
      duration_ms: kind === "video" ? Math.round(input.durationMs!) : null,
      width: input.width, height: input.height, name: input.name?.trim().slice(0, 120) || null, rights_confirmed_at: input.rightsConfirmedAt,
    }).select(COLUMNS).single();
    // The database's monthly limit (20261103_media_upload_quota.sql) caught parallel requests the count above let through.
    if (error?.message === "MEDIA_QUOTA") throw quotaError(kind);
    if (kind === "video" && (error?.message === "MEDIA_VIDEO_BUDGET" || error?.message === "MEDIA_VIDEO_STORAGE_UNKNOWN" || error?.message === "MEDIA_VIDEO_BUCKET_UNSAFE")) {
      throw videoLifecycleError(error);
    }
    if (error?.code === "23505") {
      const raced = await liveBySha(admin, input.businessId, input.sha256);
      if (raced?.status === "ready") return { duplicate: true, asset: (await mediaViews(admin, [raced]))[0] };
      row = raced;
    } else if (error || !data) {
      throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't save the photo. Try again.");
    } else row = data as MediaRow;
  }
  if (!row) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't save the photo. Try again.");
  if (row.kind === "video" && intent === null) {
    const { data, error } = await admin.rpc("media_video_sign_begin", { p_asset_id: row.id, p_upload_path: row.path });
    if (error || typeof data !== "string") throw videoLifecycleError(error);
    intent = data;
  }
  // Reviewer (#1245): a token that could overwrite would let a finished photo be swapped for other bytes for ~2 h.
  const { data: signed, error } = await admin.storage.from(mediaBucket(row.kind)).createSignedUploadUrl(row.path, { upsert: false });
  if (error || !signed) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't start the upload. Try again.");
  if (intent) {
    const { data, error: finishError } = await admin.rpc("media_video_sign_finish", { p_asset_id: row.id, p_intent_id: intent });
    if (finishError || data !== true) throw videoLifecycleError(finishError);
  }
  return { duplicate: false, id: row.id, bucket: mediaBucket(row.kind), path: row.path, token: signed.token, fit };
}

async function liveBySha(admin: SupabaseClient, businessId: string, sha256: string): Promise<MediaRow | null> {
  const { data, error } = await admin.from("media_assets").select(COLUMNS)
    .eq("business_id", businessId).eq("sha256", sha256).is("deleted_at", null).maybeSingle();
  if (error) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't check your photos. Try again.");
  return (data as MediaRow | null) ?? null;
}

const SHARP_MIME: Record<string, MediaMime> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

type Refuse = (status: number, code: string, message: string) => Promise<never>;

/** Re-reads the stored object: the bytes must be the photo or video the browser described, or the object and row go. */
export async function finalizeUpload(admin: SupabaseClient, row: MediaRow): Promise<MediaView> {
  if (row.status === "ready") return (await mediaViews(admin, [row]))[0];
  if (row.kind === "video" && row.status !== "pending") throw new MediaError(409, "MEDIA_NOT_UPLOADED", "This video isn't ready yet.");
  const { data: blob, error } = await admin.storage.from(mediaBucket(row.kind)).download(row.path);
  if (error || !blob) throw new MediaError(409, "MEDIA_NOT_UPLOADED", "The upload didn't finish. Try again.");
  const bytes = Buffer.from(await blob.arrayBuffer());
  const refuse: Refuse = async (status, code, message) => {
    const { error: removeError } = await admin.storage.from(mediaBucket(row.kind)).remove([row.path]);
    if (row.kind === "video" && removeError) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't remove the video. Try again.");
    // Only the unfinished upload this call read: one another finalize already made ready stays. Soft-deleted, not
    // removed (Dev 7, #1245 attack): the row still counts toward the monthly limit and keeps its path for #2644's sweep,
    // so a token still live for that path can't store files the limit never sees. Honest refusals happen at sign (#748).
    const { error: saveError } = await admin.from("media_assets").update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", row.id).eq("path", row.path).eq("status", "pending");
    if (row.kind === "video" && saveError) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't remove the video. Try again.");
    throw new MediaError(status, code, message);
  };
  return row.kind === "video" ? finalizeVideo(admin, row, bytes, refuse) : finalizePhoto(admin, row, bytes, refuse);
}

async function finalizePhoto(admin: SupabaseClient, row: MediaRow, bytes: Buffer, reject: Refuse): Promise<MediaView> {
  if (bytes.length > MEDIA_MAX_BYTES) return reject(413, "MEDIA_TOO_LARGE", "This photo is over 8 MB. Choose a smaller one.");
  if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) return reject(422, "MEDIA_CHANGED", "The photo changed while uploading. Add it again.");
  const meta = await sharp(bytes).metadata().catch(() => null);
  const mime = meta?.format ? SHARP_MIME[meta.format] : undefined;
  if (!meta?.width || !meta.height || !mime) return reject(415, "MEDIA_TYPE", "Please choose a JPG, PNG or WebP photo.");
  if (Math.max(meta.width, meta.height) > MEDIA_MAX_LONG_SIDE * 2) return reject(413, "MEDIA_TOO_LARGE", "This photo is too large. Add it again so it can be resized.");
  // Reviewer (#1245): EXIF/XMP/IPTC can carry GPS, a camera serial and times. The server re-encodes without them
  // (sharp drops metadata unless asked; `rotate()` applies the orientation first), whatever the browser did.
  let stored: Uint8Array = bytes, width = meta.width, height = meta.height;
  if (meta.exif || meta.xmp || meta.iptc) {
    const clean = await sharp(bytes).rotate().toFormat(meta.format as "jpeg" | "png" | "webp", meta.format === "jpeg" ? { quality: 90 } : {})
      .toBuffer({ resolveWithObject: true }).catch(() => null);
    if (!clean) return reject(415, "MEDIA_TYPE", "Please choose a JPG, PNG or WebP photo.");
    stored = new Uint8Array(clean.data);
    width = clean.info.width;
    height = clean.info.height;
  }
  const fit = mediaFit(width, height);
  if (fit.level === "too_small") return reject(422, "MEDIA_TOO_SMALL", fit.message);
  return promote(admin, row, stored, { mime, extension: MEDIA_EXTENSION[mime], width, height, durationMs: null, fit });
}

/** #748: an MP4/MOV is checked from its boxes (container, length, shown size) and kept as it is, minus location. */
async function finalizeVideo(admin: SupabaseClient, row: MediaRow, bytes: Buffer, reject: Refuse): Promise<MediaView> {
  const wrongType = "Please choose an MP4 or MOV video.";
  if (!mediaVideoEnabled()) return reject(415, "MEDIA_TYPE", wrongType);
  if (bytes.length > MEDIA_VIDEO_MAX_BYTES) return reject(413, "MEDIA_TOO_LARGE", videoRefusal("video/mp4", bytes.length, row.duration_ms ?? 1)!.message);
  if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) return reject(422, "MEDIA_CHANGED", "The video changed while uploading. Add it again.");
  const info = readVideo(bytes);
  if (!info) return reject(415, "MEDIA_TYPE", wrongType);
  const refusal = videoRefusal(info.mime, bytes.length, info.durationMs);
  if (refusal) return reject(refusal.status, refusal.code, refusal.message);
  // Reviewer (#1245): no location leaves with an owner's media. Phones write it into `udta`/`meta` boxes.
  const stored = stripVideoMetadata(bytes);
  return promote(admin, row, stored, {
    mime: info.mime, extension: MEDIA_VIDEO_EXTENSION[info.mime], width: info.width, height: info.height,
    durationMs: info.durationMs, fit: mediaFit(info.width, info.height, "video"),
  });
}

type Checked = { mime: string; extension: string; width: number; height: number; durationMs: number | null; fit: MediaFit };

async function promote(admin: SupabaseClient, row: MediaRow, stored: Uint8Array, checked: Checked): Promise<MediaView> {
  const noun = row.kind === "video" ? "video" : "photo";
  // Dev 7 (#1245 attack): the checked bytes go to a new path no upload token was ever signed for, and the row moves
  // there only if it still points at the upload path we read. A token still live for the upload path (a retry's, or one
  // signed while this ran) can then never put unchecked bytes behind a ready one.
  // TODO(#2644): sweep the one orphan such a token can still leave at the old upload path, and stale pending rows.
  const uploadPath = row.path;
  const finalPath = `${row.business_id}/${randomUUID()}.${checked.extension}`;
  if (row.kind === "video") {
    const { data, error } = await admin.rpc("media_video_finalize_claim", {
      p_asset_id: row.id, p_upload_path: uploadPath, p_final_path: finalPath,
    });
    if (error) throw videoLifecycleError(error);
    if (data !== true) throw videoBusyError();
  }
  const { error: writeError } = await admin.storage.from(mediaBucket(row.kind)).upload(finalPath, stored, { upsert: false, contentType: checked.mime });
  if (writeError) throw new MediaError(503, "MEDIA_UNAVAILABLE", `Couldn't save the ${noun}. Try again.`);
  const storedSha256 = createHash("sha256").update(stored).digest("hex");
  const { data, error: saveError } = await admin.from("media_assets").update({
    path: finalPath, status: "ready", bytes: stored.length, mime: checked.mime, width: checked.width, height: checked.height,
    ...(checked.durationMs ? { duration_ms: checked.durationMs } : {}),
    checks: { fit: checked.fit, storedSha256 }, updated_at: new Date().toISOString(),
  }).eq("id", row.id).eq("path", uploadPath).eq("status", "pending").is("deleted_at", null).select(COLUMNS).maybeSingle();
  if (saveError || !data) {
    if (row.kind !== "video") await admin.storage.from(mediaBucket(row.kind)).remove([finalPath]).catch(() => undefined);
    if (saveError) throw new MediaError(503, "MEDIA_UNAVAILABLE", `Couldn't save the ${noun}. Try again.`);
    // Another finalize of the same upload won the race: answer with its result.
    const { data: now } = await admin.from("media_assets").select(COLUMNS).eq("id", row.id).maybeSingle();
    if ((now as MediaRow | null)?.status === "ready") return (await mediaViews(admin, [now as MediaRow]))[0];
    throw new MediaError(409, "MEDIA_CHANGED", `The ${noun} changed while uploading. Add it again.`);
  }
  if (row.kind === "video") {
    const { error: removeError } = await admin.storage.from(mediaBucket(row.kind)).remove([uploadPath]);
    if (removeError) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't finish saving the video. Try again.");
  } else {
    await admin.storage.from(mediaBucket(row.kind)).remove([uploadPath]).catch(() => undefined);
  }
  return (await mediaViews(admin, [data as MediaRow]))[0];
}

/**
 * The bytes of a finished photo for use (a picture, a Meta upload), only if they're still what finalize stored
 * (Reviewer, #1245): anything else is refused rather than put in an ad.
 */
export async function readVerifiedMedia(admin: SupabaseClient, row: MediaRow): Promise<Uint8Array> {
  if (row.status !== "ready") throw new MediaError(409, "MEDIA_NOT_UPLOADED", "This photo isn't ready yet.");
  const { data: blob, error } = await admin.storage.from(mediaBucket(row.kind)).download(row.path);
  if (error || !blob) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't read the photo. Try again.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const expected = typeof row.checks?.storedSha256 === "string" ? row.checks.storedSha256 : row.sha256;
  if (createHash("sha256").update(bytes).digest("hex") !== expected) {
    throw new MediaError(409, "MEDIA_CHANGED", "This photo changed after it was added. Add it again.");
  }
  return bytes;
}

/** Rows to what the library shows. Only a `ready` row gets a signed URL to its private object (an hour): a pending
 * row's object is whatever an upload token stored, unchecked (Reviewer, #1245). */
export async function mediaViews(client: SupabaseClient, rows: MediaRow[]): Promise<MediaView[]> {
  const ready = rows.filter((row) => row.status === "ready");
  const urls = new Map<string | null, string>();
  for (const kind of ["image", "video"] as const) {
    const paths = ready.filter((row) => (row.kind ?? "image") === kind).map((row) => row.path);
    if (!paths.length) continue;
    const { data: signed } = await client.storage.from(mediaBucket(kind)).createSignedUrls(paths, URL_SECONDS);
    for (const item of signed ?? []) if (item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  return rows.map((row) => ({
    id: row.id, kind: row.kind ?? "image", name: row.name, tags: row.tags ?? [], width: row.width, height: row.height, bytes: row.bytes,
    durationMs: row.duration_ms ?? null, fit: row.width && row.height ? mediaFit(row.width, row.height, row.kind ?? "image") : null, url: row.status === "ready" ? urls.get(row.path) ?? null : null, createdAt: row.created_at,
  }));
}

/** The owner's ready photos, newest first; `before` pages by created_at. Read under the owner's RLS. */
export async function listMedia(client: SupabaseClient, businessId: string, before?: string, limit = 30): Promise<{ items: MediaView[]; next: string | null }> {
  let query = client.from("media_assets").select(COLUMNS).eq("business_id", businessId).eq("status", "ready").is("deleted_at", null)
    .order("created_at", { ascending: false }).limit(limit + 1);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't load your photos. Try again.");
  const rows = (data ?? []) as MediaRow[];
  const page = rows.slice(0, limit);
  return { items: await mediaViews(client, page), next: rows.length > limit ? page.at(-1)!.created_at : null };
}

/** The owner's own row (RLS read), or a 404. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function ownMedia(client: SupabaseClient, id: string): Promise<MediaRow> {
  if (!UUID.test(id)) throw new MediaError(404, "MEDIA_NOT_FOUND", "Photo not found.");
  const { data, error } = await client.from("media_assets").select(COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't load the photo. Try again.");
  if (!data) throw new MediaError(404, "MEDIA_NOT_FOUND", "Photo not found.");
  return data as MediaRow;
}

/** #780 slice 2a: the photos the library sent to Create (`?photos=`), under the owner's RLS and in the owner's order.
 * Bad, unknown, another business's, unready and video ids are dropped; Create re-checks them when it runs. */
export async function pickedMediaViews(client: SupabaseClient, businessId: string, ids: readonly string[]): Promise<MediaView[]> {
  const wanted = [...new Set(ids.filter((id) => UUID.test(id)))].slice(0, 10);
  if (!wanted.length) return [];
  const { data, error } = await client.from("media_assets").select(COLUMNS).in("id", wanted).eq("business_id", businessId)
    .eq("status", "ready").eq("kind", "image").is("deleted_at", null);
  if (error) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't load your photos. Try again.");
  const rows = new Map(((data ?? []) as MediaRow[]).map((row) => [row.id, row]));
  return mediaViews(client, wanted.flatMap((id) => rows.get(id) ?? []).slice(0, MAX_AD_PHOTOS));
}

export async function updateMedia(admin: SupabaseClient, row: MediaRow, change: { name?: string | null; tags?: string[] }): Promise<MediaView> {
  if (row.status !== "ready") throw new MediaError(409, "MEDIA_NOT_UPLOADED", "This photo isn't ready yet.");
  const { data, error } = await admin.from("media_assets").update({
    ...(change.name !== undefined ? { name: change.name?.trim().slice(0, 120) || null } : {}),
    ...(change.tags ? { tags: [...new Set(change.tags.map((tag) => tag.trim().slice(0, 40)).filter(Boolean))].slice(0, 10) } : {}),
    updated_at: new Date().toISOString(),
  }).eq("id", row.id).select(COLUMNS).single();
  if (error || !data) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't save the change. Try again.");
  return (await mediaViews(admin, [data as MediaRow]))[0];
}

/** Soft delete; refused while a running campaign uses an ad made from the photo (#778). The object goes first. */
export async function deleteMedia(admin: SupabaseClient, row: MediaRow): Promise<void> {
  const { data: creatives, error } = await admin.from("creatives").select("id").eq("media_asset_id", row.id);
  if (error) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't check where this photo is used. Try again.");
  const ids = ((creatives ?? []) as { id: string }[]).map((creative) => creative.id);
  if (ids.length) {
    const { data: live, error: liveError } = await admin.from("campaigns").select("name")
      .eq("business_id", row.business_id).eq("status", "active").overlaps("creative_ids", ids).limit(1);
    if (liveError) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't check where this photo is used. Try again.");
    const campaign = (live as { name: string | null }[] | null)?.[0];
    if (campaign) throw new MediaError(409, "MEDIA_IN_USE", `"${campaign.name ?? "A running campaign"}" uses this photo. Pause that campaign first.`);
  }
  const { error: removeError } = await admin.storage.from(mediaBucket(row.kind)).remove([row.path]);
  if (removeError) {
    await admin.from("media_assets").update({ status: "delete_failed", updated_at: new Date().toISOString() }).eq("id", row.id);
    throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't delete the photo. Try again.");
  }
  if (row.kind === "video") {
    const { data, error: confirmError } = await admin.rpc("media_video_final_removed", { p_asset_id: row.id, p_final_path: row.path });
    if (confirmError || (row.status === "ready" && data !== true)) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't confirm the video was removed. Try again.");
    if (data === true) return;
  }
  const { error: saveError } = await admin.from("media_assets").update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id);
  if (saveError) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't delete the photo. Try again.");
}
