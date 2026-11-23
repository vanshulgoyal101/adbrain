import type { LLMUsageEvent } from "@/lib/llm/persist";
import { describeUsageEvent } from "@/lib/media/ad-photos";
import { describePhoto, type PhotoNotes } from "@/lib/media/describe";

/** Newest brand photos looked at per Create; the ads use at most three. */
const VET_LIMIT = 6;
const MAX_BYTES = 6_000_000;
const FETCH_TIMEOUT_MS = 8_000;
/** Process-local: a brand photo is described once per server instance, not on every Create. */
const notesByUrl = new Map<string, PhotoNotes>();
const CACHE_LIMIT = 500;

/** Brand photo URLs are stored data: only fetch https from our own Supabase storage host, never an arbitrary address. */
function ownStorageUrl(url: string): boolean {
  try {
    const own = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    const target = new URL(url);
    return target.protocol === "https:" && target.hostname === own.hostname && target.port === own.port && target.pathname.startsWith("/storage/v1/");
  } catch {
    return false;
  }
}

type Context = Pick<LLMUsageEvent, "businessId" | "userId" | "route" | "requestId" | "generationId">;

async function fetchImage(url: string, signal: AbortSignal): Promise<{ data: Uint8Array; mediaType: string } | null> {
  try {
    if (!ownStorageUrl(url)) return null;
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) });
    const mediaType = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!response.ok || !mediaType.startsWith("image/")) return null;
    if (Number(response.headers.get("content-length")) > MAX_BYTES) return null;
    const data = new Uint8Array(await response.arrayBuffer());
    return data.length && data.length <= MAX_BYTES ? { data, mediaType } : null;
  } catch {
    return null;
  }
}

/**
 * The brand's saved product photos are used as ad pictures untouched, so a flyer, logo or photo with printed words
 * (another company's name, a slogan) clashes with the ad's own headline. Describe each (one vision call, cached) and
 * leave out any with printed text; a photo that can't be read is kept, as before. Never throws.
 */
export async function vetBrandPhotos(
  urls: readonly string[],
  context: Context,
  signal: AbortSignal = AbortSignal.timeout(25_000),
): Promise<{ photos: string[]; notes: Record<string, PhotoNotes>; events: LLMUsageEvent[] }> {
  const events: LLMUsageEvent[] = [];
  const candidates = urls.slice(0, VET_LIMIT);
  await Promise.all(candidates.filter((url) => !notesByUrl.has(url)).map(async (url) => {
    const image = await fetchImage(url, signal);
    if (!image) return;
    const notes = await describePhoto(image, { signal, onAttempt: (attempt) => events.push(describeUsageEvent(attempt, url, context)) });
    if (!notes) return;
    if (notesByUrl.size >= CACHE_LIMIT) notesByUrl.clear();
    notesByUrl.set(url, notes);
  }));
  const printed = (url: string) => Boolean(notesByUrl.get(url)?.visibleText?.trim());
  const photos = [...candidates.filter((url) => !printed(url)), ...urls.slice(VET_LIMIT)];
  const notes = Object.fromEntries(photos.flatMap((url) => {
    const found = notesByUrl.get(url);
    return found ? [[url, found] as const] : [];
  }));
  return { photos, notes, events };
}
