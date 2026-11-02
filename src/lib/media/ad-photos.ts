import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProviderAttempt } from "@/lib/llm";
import type { LLMUsageEvent } from "@/lib/llm/persist";
import { DESCRIBE_PROMPT_VERSION, describePhoto, type PhotoNotes } from "@/lib/media/describe";
import { MediaError, mediaViews, ownMedia, readVerifiedMedia, type MediaRow } from "@/lib/media/store";

/** #780: photos an owner picked from the library for a Create batch, each one ad's picture (ads 1-3). */
export const MAX_AD_PHOTOS = 3;
/** The whole describe step's budget; a photo still undescribed by then is used with Brand-only words. */
export const DESCRIBE_BUDGET_MS = 25_000;

export type AdPhoto = { mediaId: string; url: string; notes: PhotoNotes | null };

/** The owner's ready photos for these ids, in the order picked; read under the owner's RLS. Throws MediaError. */
export async function pickedMedia(client: SupabaseClient, businessId: string, ids: readonly string[]): Promise<MediaRow[]> {
  const rows = await Promise.all([...new Set(ids)].slice(0, MAX_AD_PHOTOS).map((id) => ownMedia(client, id)));
  for (const row of rows) {
    if (row.business_id !== businessId) throw new MediaError(404, "MEDIA_NOT_FOUND", "Photo not found.");
    if (row.status !== "ready") throw new MediaError(409, "MEDIA_NOT_UPLOADED", "This photo isn't ready yet.");
  }
  return rows;
}

function savedNotes(row: MediaRow): PhotoNotes | null {
  return row.description ? { description: row.description, visibleText: row.visible_text ?? null } : null;
}

/**
 * Each photo with a signed URL for its picture and what it shows for its words. A photo described before reuses
 * its saved notes (no AI call); a new one gets one vision call on its verified bytes, saved for next time.
 */
export async function adPhotos(
  admin: SupabaseClient,
  rows: readonly MediaRow[],
  options: { onAttempt?: (attempt: ProviderAttempt, mediaId: string) => void } = {},
): Promise<AdPhoto[]> {
  const views = await mediaViews(admin, [...rows]);
  const signal = AbortSignal.timeout(DESCRIBE_BUDGET_MS);
  return Promise.all(rows.map(async (row, index): Promise<AdPhoto> => {
    const url = views[index]?.url;
    if (!url) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't read the photo. Try again.");
    const saved = savedNotes(row);
    if (saved) return { mediaId: row.id, url, notes: saved };
    const bytes = await readVerifiedMedia(admin, row);
    const notes = await describePhoto({ data: bytes, mediaType: row.mime ?? "image/jpeg" },
      { signal, onAttempt: (attempt) => options.onAttempt?.(attempt, row.id) });
    if (notes) {
      // Only the first answer is kept, so two batches describing at once can't flip a photo's notes.
      await admin.from("media_assets").update({ description: notes.description, visible_text: notes.visibleText })
        .eq("id", row.id).is("description", null).then(() => undefined, () => undefined);
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
