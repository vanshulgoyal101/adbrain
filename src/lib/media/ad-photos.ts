import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProviderAttempt } from "@/lib/llm";
import type { LLMUsageEvent } from "@/lib/llm/persist";
import { DESCRIBE_PROMPT_VERSION, describePhoto, type PhotoNotes } from "@/lib/media/describe";
import { MAX_AD_PHOTOS } from "@/lib/media/rules";
import { MediaError, mediaViews, ownMedia, readVerifiedMedia, type MediaRow } from "@/lib/media/store";

export { MAX_AD_PHOTOS } from "@/lib/media/rules";
/** The whole describe step's budget; a photo still undescribed by then is used with Brand-only words. */
export const DESCRIBE_BUDGET_MS = 25_000;

export type AdPhoto = { mediaId: string; url: string; notes: PhotoNotes | null };

/** The owner's ready photos for these ids, in the order picked; read under the owner's RLS. Throws MediaError. */
export async function pickedMedia(client: SupabaseClient, businessId: string, ids: readonly string[]): Promise<MediaRow[]> {
  const rows = await Promise.all([...new Set(ids)].slice(0, MAX_AD_PHOTOS).map((id) => ownMedia(client, id)));
  for (const row of rows) {
    if (row.business_id !== businessId) throw new MediaError(404, "MEDIA_NOT_FOUND", "Photo not found.");
    if (row.status !== "ready") throw new MediaError(409, "MEDIA_NOT_UPLOADED", "This photo isn't ready yet.");
    if (row.kind !== "image") throw new MediaError(400, "MEDIA_NOT_IMAGE", "Pick a photo, not a video.");
  }
  return rows;
}

function savedNotes(row: MediaRow): PhotoNotes | null {
  return row.description ? { description: row.description, visibleText: row.visible_text ?? null } : null;
}

/** A picked photo, signed and (if never described) read, ready for its one vision call. */
export type ReadPhoto = { row: MediaRow; url: string; notes: PhotoNotes | null; bytes: Uint8Array | null };

/**
 * Signs each photo and reads the verified bytes of any never described. No AI call, so the route runs it before
 * admitting the paid batch: a photo deleted or changed mid-Create is refused there instead of stranding a hold.
 * Throws MediaError.
 */
export async function readAdPhotos(admin: SupabaseClient, rows: readonly MediaRow[]): Promise<ReadPhoto[]> {
  const views = await mediaViews(admin, [...rows]);
  return Promise.all(rows.map(async (row, index): Promise<ReadPhoto> => {
    const url = views[index]?.url;
    if (!url) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't read the photo. Try again.");
    const notes = savedNotes(row);
    return { row, url, notes, bytes: notes ? null : await readVerifiedMedia(admin, row) };
  }));
}

/**
 * Each photo's picture URL and what it shows, for its words. A photo described before reuses its saved notes (no
 * AI call); a new one gets one vision call, saved for next time. Never throws: an undescribed photo gets null notes.
 */
export async function adPhotos(
  admin: SupabaseClient,
  photos: readonly ReadPhoto[],
  options: { onAttempt?: (attempt: ProviderAttempt, mediaId: string) => void } = {},
): Promise<AdPhoto[]> {
  const signal = AbortSignal.timeout(DESCRIBE_BUDGET_MS);
  return Promise.all(photos.map(async ({ row, url, notes: saved, bytes }): Promise<AdPhoto> => {
    if (saved || !bytes) return { mediaId: row.id, url, notes: saved };
    const notes = await describePhoto({ data: bytes, mediaType: row.mime ?? "image/jpeg" },
      { signal, onAttempt: (attempt) => options.onAttempt?.(attempt, row.id) });
    if (notes) {
      // Only the first answer is kept, so two batches describing at once can't flip a photo's notes.
      const { error } = await Promise.resolve(admin.from("media_assets").update({ description: notes.description, visible_text: notes.visibleText })
        .eq("id", row.id).is("description", null)).catch((caught: unknown) => ({ error: caught }));
      // This Create still uses the notes; an unsaved answer means the next batch pays for the photo again.
      if (error) console.error(JSON.stringify({ source: "adbrain.media", code: "PHOTO_NOTES_NOT_SAVED", mediaId: row.id,
        message: (error instanceof Error ? error.message : String((error as { message?: unknown }).message ?? error)).slice(0, 300) }));
    }
    return { mediaId: row.id, url, notes };
  }));
}

/** A usage row for one vision attempt: tokens and status only, never the photo or the answer. */
export function describeUsageEvent(
  attempt: ProviderAttempt,
  mediaId: string,
  context: Pick<LLMUsageEvent, "businessId" | "userId" | "route" | "requestId" | "generationId">,
): LLMUsageEvent {
  return {
    ...context,
    provider: attempt.provider,
    model: attempt.model,
    usage: attempt.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    usageKind: "text",
    promptVersion: DESCRIBE_PROMPT_VERSION,
    status: attempt.status,
    latencyMs: attempt.latencyMs,
    providerRequestId: attempt.providerRequestId,
    providerFinalStatus: attempt.providerFinalStatus,
    ...(attempt.failure ? { failure: attempt.failure } : {}),
    ...(attempt.rateLimit ? { rateLimit: attempt.rateLimit } : {}),
    metadata: { task: "media.describe", mediaId },
  };
}
