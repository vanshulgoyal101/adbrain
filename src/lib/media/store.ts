import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { getEnv } from "@/lib/env";
import {
  isMediaMime, MEDIA_BUCKET, MEDIA_EXTENSION, MEDIA_MAX_BYTES, MEDIA_MAX_LONG_SIDE,
  MEDIA_MONTHLY_UPLOADS, mediaFit, type MediaFit, type MediaMime,
} from "@/lib/media/rules";

/**
 * #1209 (#748): owners' own photos. The browser asks `sign` for a one-time upload URL, uploads the bytes straight
 * to the private `media` bucket, then calls `finalize`, which re-reads the stored object before it's listed.
 * Only the service role writes rows and objects; owners read their own under RLS.
 */
export function mediaUploadsEnabled(): boolean {
  return getEnv().MEDIA_UPLOADS_ENABLED;
}

export type MediaRow = {
  id: string; business_id: string; path: string; name: string | null; tags: string[]; sha256: string;
  bytes: number | null; mime: string | null; width: number | null; height: number | null;
  checks: Record<string, unknown>; status: "pending" | "ready" | "delete_failed"; deleted_at: string | null; created_at: string;
  /** #780: what the photo shows and the words printed in it, saved by the first Create that used it. */
  description?: string | null; visible_text?: string | null;
};
export type MediaView = {
  id: string; name: string | null; tags: string[]; width: number | null; height: number | null; bytes: number | null;
  fit: MediaFit | null; url: string | null; createdAt: string;
};

export class MediaError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "MediaError";
  }
}

const COLUMNS = "id, business_id, path, name, tags, sha256, bytes, mime, width, height, checks, status, deleted_at, created_at, description, visible_text";
const URL_SECONDS = 3600;

/** Start of the current month in India (the pilots' billing month), as an ISO instant. */
export function monthStartIst(now = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 5.5 * 3_600_000).toISOString();
}

export async function monthlyUploads(admin: SupabaseClient, businessId: string, now = new Date()): Promise<number> {
  const { count, error } = await admin.from("media_assets").select("id", { count: "exact", head: true })
    .eq("business_id", businessId).eq("source", "upload").gte("created_at", monthStartIst(now));
  if (error) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't check your uploads. Try again.");
  return count ?? 0;
}

/** `rightsConfirmedAt`: when the route found the owner's current rights confirmation (#784, #1248's `hasCurrentMediaConsent`). */
export type SignInput = { businessId: string; userId: string; mime: string; bytes: number; sha256: string; width: number; height: number; name?: string; rightsConfirmedAt: string };
export type SignResult =
  | { duplicate: true; asset: MediaView }
  | { duplicate: false; id: string; path: string; token: string; fit: MediaFit };

export async function signUpload(admin: SupabaseClient, input: SignInput): Promise<SignResult> {
  if (!isMediaMime(input.mime)) throw new MediaError(415, "MEDIA_TYPE", "Please choose a JPG, PNG or WebP photo.");
  if (input.bytes > MEDIA_MAX_BYTES) throw new MediaError(413, "MEDIA_TOO_LARGE", "This photo is over 8 MB after resizing. Choose a smaller one.");
  const fit = mediaFit(input.width, input.height);
  if (fit.level === "too_small") throw new MediaError(422, "MEDIA_TOO_SMALL", fit.message);

  let existing = await liveBySha(admin, input.businessId, input.sha256);
  if (existing?.status === "ready") return { duplicate: true, asset: (await mediaViews(admin, [existing]))[0] };
  if (existing && Date.parse(existing.created_at) < Date.parse(monthStartIst())) {
    // The monthly limit is enforced on insert (20261103_media_upload_quota.sql), so a pending row from an earlier month
    // isn't reused (#2644 attack: 50 stale rows finished next month doubled the limit). It's retired, still counting in
    // its own month, and this try gets a new row that the limit sees.
    await admin.storage.from(MEDIA_BUCKET).remove([existing.path]).catch(() => undefined);
    const { error } = await admin.from("media_assets").update({ deleted_at: new Date().toISOString() })
      .eq("id", existing.id).eq("status", "pending").is("deleted_at", null);
    if (error) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't start the upload. Try again.");
    existing = null;
  }
  if (!existing && await monthlyUploads(admin, input.businessId) >= MEDIA_MONTHLY_UPLOADS) {
    throw new MediaError(429, "MEDIA_QUOTA", `You've used ${MEDIA_MONTHLY_UPLOADS} of ${MEDIA_MONTHLY_UPLOADS} photo uploads this month.`);
  }

  // A pending row (an earlier try that didn't finish) is reused, so retrying never stores the file twice. It keeps its one
  // upload path, so every token ever signed for it targets that path: at most one unverified object per counted row
  // (Dev 7, #1245 attack: a new path per retry left old tokens able to store uncounted files). Tokens can't overwrite
  // (Reviewer, #1245), so an unverified object from the earlier try goes first; finalize copies verified bytes elsewhere.
  let row = existing;
  if (row) await admin.storage.from(MEDIA_BUCKET).remove([row.path]).catch(() => undefined);
  if (!row) {
    const path = `${input.businessId}/${randomUUID()}.${MEDIA_EXTENSION[input.mime as MediaMime]}`;
    const { data, error } = await admin.from("media_assets").insert({
      business_id: input.businessId, path, sha256: input.sha256, mime: input.mime, bytes: input.bytes,
      width: input.width, height: input.height, name: input.name?.trim().slice(0, 120) || null, rights_confirmed_at: input.rightsConfirmedAt,
    }).select(COLUMNS).single();
    if (error?.message === "MEDIA_QUOTA") {
      // The database's monthly limit (20261103_media_upload_quota.sql) caught parallel requests the count above let through.
      throw new MediaError(429, "MEDIA_QUOTA", `You've used ${MEDIA_MONTHLY_UPLOADS} of ${MEDIA_MONTHLY_UPLOADS} photo uploads this month.`);
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
  // Reviewer (#1245): a token that could overwrite would let a finished photo be swapped for other bytes for ~2 h.
  const { data: signed, error } = await admin.storage.from(MEDIA_BUCKET).createSignedUploadUrl(row.path, { upsert: false });
  if (error || !signed) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't start the upload. Try again.");
  return { duplicate: false, id: row.id, path: row.path, token: signed.token, fit };
}

async function liveBySha(admin: SupabaseClient, businessId: string, sha256: string): Promise<MediaRow | null> {
  const { data, error } = await admin.from("media_assets").select(COLUMNS)
    .eq("business_id", businessId).eq("sha256", sha256).is("deleted_at", null).maybeSingle();
  if (error) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't check your photos. Try again.");
  return (data as MediaRow | null) ?? null;
}

const SHARP_MIME: Record<string, MediaMime> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Re-reads the stored object: the bytes must be the photo the browser described, or the object and row go. */
export async function finalizeUpload(admin: SupabaseClient, row: MediaRow): Promise<MediaView> {
  if (row.status === "ready") return (await mediaViews(admin, [row]))[0];
  const { data: blob, error } = await admin.storage.from(MEDIA_BUCKET).download(row.path);
  if (error || !blob) throw new MediaError(409, "MEDIA_NOT_UPLOADED", "The upload didn't finish. Try again.");
  const bytes = Buffer.from(await blob.arrayBuffer());
  const reject = async (status: number, code: string, message: string): Promise<never> => {
    await admin.storage.from(MEDIA_BUCKET).remove([row.path]);
    // Only the unfinished upload this call read: a photo another finalize already made ready stays. Soft-deleted, not
    // removed (Dev 7, #1245 attack): the row still counts toward the monthly limit and keeps its path for #2644's sweep,
    // so a token still live for that path can't store files the limit never sees.
    await admin.from("media_assets").update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", row.id).eq("path", row.path).eq("status", "pending");
    throw new MediaError(status, code, message);
  };
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
  // Dev 7 (#1245 attack): the checked bytes go to a new path no upload token was ever signed for, and the row moves
  // there only if it still points at the upload path we read. A token still live for the upload path (a retry's, or one
  // signed while this ran) can then never put unchecked bytes behind a ready photo.
  // TODO(#2644): sweep the one orphan such a token can still leave at the old upload path, and stale pending rows.
  const uploadPath = row.path;
  const finalPath = `${row.business_id}/${randomUUID()}.${MEDIA_EXTENSION[mime]}`;
  const { error: writeError } = await admin.storage.from(MEDIA_BUCKET).upload(finalPath, stored, { upsert: false, contentType: mime });
  if (writeError) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't save the photo. Try again.");
  const storedSha256 = createHash("sha256").update(stored).digest("hex");
  const { data, error: saveError } = await admin.from("media_assets").update({
    path: finalPath, status: "ready", bytes: stored.length, mime, width, height, checks: { fit, storedSha256 }, updated_at: new Date().toISOString(),
  }).eq("id", row.id).eq("path", uploadPath).eq("status", "pending").select(COLUMNS).maybeSingle();
  if (saveError || !data) {
    await admin.storage.from(MEDIA_BUCKET).remove([finalPath]).catch(() => undefined);
    if (saveError) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't save the photo. Try again.");
    // Another finalize of the same upload won the race: answer with its result.
    const { data: now } = await admin.from("media_assets").select(COLUMNS).eq("id", row.id).maybeSingle();
    if ((now as MediaRow | null)?.status === "ready") return (await mediaViews(admin, [now as MediaRow]))[0];
    throw new MediaError(409, "MEDIA_CHANGED", "The photo changed while uploading. Add it again.");
  }
  await admin.storage.from(MEDIA_BUCKET).remove([uploadPath]).catch(() => undefined);
  return (await mediaViews(admin, [data as MediaRow]))[0];
}

/**
 * The bytes of a finished photo for use (a picture, a Meta upload), only if they're still what finalize stored
 * (Reviewer, #1245): anything else is refused rather than put in an ad.
 */
export async function readVerifiedMedia(admin: SupabaseClient, row: MediaRow): Promise<Uint8Array> {
  if (row.status !== "ready") throw new MediaError(409, "MEDIA_NOT_UPLOADED", "This photo isn't ready yet.");
  const { data: blob, error } = await admin.storage.from(MEDIA_BUCKET).download(row.path);
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
  const { data: signed } = ready.length
    ? await client.storage.from(MEDIA_BUCKET).createSignedUrls(ready.map((row) => row.path), URL_SECONDS)
    : { data: [] as { path: string | null; signedUrl: string }[] };
  const urls = new Map((signed ?? []).map((item) => [item.path, item.signedUrl]));
  return rows.map((row) => ({
    id: row.id, name: row.name, tags: row.tags ?? [], width: row.width, height: row.height, bytes: row.bytes,
    fit: row.width && row.height ? mediaFit(row.width, row.height) : null, url: row.status === "ready" ? urls.get(row.path) ?? null : null, createdAt: row.created_at,
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
  const { error: removeError } = await admin.storage.from(MEDIA_BUCKET).remove([row.path]);
  if (removeError) {
    await admin.from("media_assets").update({ status: "delete_failed", updated_at: new Date().toISOString() }).eq("id", row.id);
    throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't delete the photo. Try again.");
  }
  const { error: saveError } = await admin.from("media_assets").update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id);
  if (saveError) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't delete the photo. Try again.");
}

