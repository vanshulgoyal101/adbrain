import type { SupabaseClient } from "@supabase/supabase-js";
import { mediaBucket, mediaFit, type MediaFit } from "@/lib/media/rules";

export type MediaKind = "image" | "video";

export type MediaRow = {
  id: string; business_id: string; kind: MediaKind; path: string; name: string | null; tags: string[]; sha256: string;
  bytes: number | null; mime: string | null; width: number | null; height: number | null; duration_ms: number | null;
  checks: Record<string, unknown>; status: "pending" | "ready" | "delete_failed"; deleted_at: string | null; created_at: string;
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

export const MEDIA_ASSET_COLUMNS = "id, business_id, kind, path, name, tags, sha256, bytes, mime, width, height, duration_ms, checks, status, deleted_at, created_at, description, visible_text";
const URL_SECONDS = 3600;

/** Rows to what the library shows. Only a ready row gets a signed URL to its private object. */
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
    durationMs: row.duration_ms ?? null, fit: row.width && row.height ? mediaFit(row.width, row.height, row.kind ?? "image") : null,
    url: row.status === "ready" ? urls.get(row.path) ?? null : null, createdAt: row.created_at,
  }));
}
