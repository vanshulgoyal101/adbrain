import type { SupabaseClient } from "@supabase/supabase-js";
import { MEDIA_BUCKET, mediaBucket } from "@/lib/media/rules";

/**
 * #2644 (#1209, #1245 attack): an unfinished upload leaves a pending `media_assets` row, and an upload token (about 2 h)
 * can still store one object at an upload path after finalize moved the checked bytes elsewhere. This daily sweep
 * (1) retires pending rows older than a day with their object, (2) removes the objects of recently retired pending rows,
 * and (3) removes objects in the photo bucket that no live row points to once they're older than any token lives.
 * Service role, so it only ever touches the `media` bucket's unreferenced objects and rows with `deleted_at is null`
 * that never finished. Retiring is soft: the row keeps counting toward its month's limit.
 */
const PENDING_MAX_AGE_MS = 24 * 3_600_000;
const ORPHAN_MIN_AGE_MS = 3 * 3_600_000;
/** A token lives about 2 h, so only rows retired recently can still have a stray object. */
const RETIRED_WINDOW_MS = 3 * 86_400_000;
const ROW_LIMIT = 500;
const LIST_LIMIT = 1000;
const MAX_FOLDERS = 500;

export type MediaSweepResult = { stalePending: number; retiredObjects: number; orphans: number; failed: number };

type Pending = { id: string; kind: "image" | "video" | null; path: string };
type Listed = { name: string; id?: string | null; created_at?: string | null };

export async function sweepMedia(admin: SupabaseClient, now = new Date()): Promise<MediaSweepResult> {
  const result: MediaSweepResult = { stalePending: 0, retiredObjects: 0, orphans: 0, failed: 0 };

  const { data: stale, error: staleError } = await admin.from("media_assets").select("id, kind, path")
    .eq("status", "pending").is("deleted_at", null).lt("created_at", new Date(now.getTime() - PENDING_MAX_AGE_MS).toISOString()).limit(ROW_LIMIT);
  if (staleError) result.failed += 1;
  for (const row of (stale ?? []) as Pending[]) {
    const { error: removeError } = await admin.storage.from(mediaBucket(row.kind)).remove([row.path]);
    if (removeError) { result.failed += 1; continue; }
    const { error } = await admin.from("media_assets").update({ deleted_at: now.toISOString(), updated_at: now.toISOString() })
      .eq("id", row.id).eq("status", "pending").is("deleted_at", null);
    if (error) result.failed += 1; else result.stalePending += 1;
  }

  const { data: retired, error: retiredError } = await admin.from("media_assets").select("id, kind, path, deleted_at")
    .eq("status", "pending").gte("deleted_at", new Date(now.getTime() - RETIRED_WINDOW_MS).toISOString()).limit(ROW_LIMIT);
  if (retiredError) result.failed += 1;
  for (const row of ((retired ?? []) as (Pending & { deleted_at: string | null })[]).filter((item) => item.deleted_at)) {
    const { error } = await admin.storage.from(mediaBucket(row.kind)).remove([row.path]);
    if (error) result.failed += 1; else result.retiredObjects += 1;
  }

  await sweepOrphans(admin, now, result);
  return result;
}

async function sweepOrphans(admin: SupabaseClient, now: Date, result: MediaSweepResult): Promise<void> {
  const bucket = admin.storage.from(MEDIA_BUCKET);
  const { data: folders, error } = await bucket.list("", { limit: MAX_FOLDERS });
  if (error) { result.failed += 1; return; }
  const cutoff = now.getTime() - ORPHAN_MIN_AGE_MS;
  for (const folder of ((folders ?? []) as Listed[]).filter((item) => !item.id)) {
    const { data: objects, error: listError } = await bucket.list(folder.name, { limit: LIST_LIMIT });
    if (listError) { result.failed += 1; continue; }
    const old = ((objects ?? []) as Listed[]).filter((item) => item.id && item.created_at && Date.parse(item.created_at) < cutoff);
    if (!old.length) continue;
    // Read after listing: a row written while we listed is newer than the age cutoff anyway.
    const { data: live, error: liveError } = await admin.from("media_assets").select("path")
      .eq("business_id", folder.name).is("deleted_at", null).in("kind", ["image"]);
    if (liveError) { result.failed += 1; continue; }
    const keep = new Set(((live ?? []) as { path: string }[]).map((row) => row.path));
    const orphans = old.map((item) => `${folder.name}/${item.name}`).filter((path) => !keep.has(path));
    if (!orphans.length) continue;
    const { error: removeError } = await bucket.remove(orphans);
    if (removeError) result.failed += 1; else result.orphans += orphans.length;
  }
}
