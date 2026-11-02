/**
 * #2712 (#2595 phase 2): can this ad account's website report signups (Lead) or sales (Purchase)? Read-only: the
 * account's pixels (`act_/adspixels`), then one pixel's per-event counts over the last 7 days (`/{pixel}/stats`,
 * aggregation=event). Adapter-shaped (ADR-001, #1792): Graph in, a channel-neutral `TrackingStatus` out.
 *
 * "unreadable" means AdBrain couldn't check (Meta refused or failed the read, the pixel isn't listed for this
 * account, or Meta marks it unavailable). It never means another business owns the pixel: Graph's 100/33 says
 * "doesn't exist or no permission" and can't tell them apart. A failed read is never reported as "none" or "quiet".
 */
import type { ConnectionDTO } from "./connect-contracts";
import { MetaThrottledError, isMetaReauthError, type MetaClient } from "./client";
import type { MetaGraph } from "./media";

export type TrackingEvent = "Lead" | "Purchase";
export type TrackingState = "none" | "unreadable" | "quiet" | "event_missing" | "ready";
export type TrackingUnreadable = "reconnect" | "throttled" | "list_failed" | "not_listed" | "unavailable" | "stats_failed" | "stats_incomplete";
export type TrackingPixel = { id: string; name: string; lastFiredAt: string | null; unavailable: boolean };

export type TrackingStatus = {
  state: TrackingState;
  /** Why it couldn't be checked; only for "unreadable". */
  unreadable: TrackingUnreadable | null;
  /** The pixel the counts belong to (null for "none" or when the list couldn't be read). */
  pixelId: string | null;
  /** Every pixel the ad account lists, so Brand can offer a choice. */
  pixels: TrackingPixel[];
  /** The window the counts cover (ISO, UTC); null when no stats were read. */
  window: { since: string; until: string } | null;
  /** The newest moment Meta saw any event from this pixel, if known. */
  lastSeenAt: string | null;
  /** Lead and Purchase counts in the window; null when no stats were read. */
  counts: Record<TrackingEvent, number> | null;
  /** All events (any name) in the window; null when no stats were read. */
  totalEvents: number | null;
};

export const TRACKING_WINDOW_DAYS = 7;
const PAGE_LIMIT = 10;

type GraphPage<T> = { data?: T[]; paging?: { next?: string; cursors?: { after?: string } } };
type RawPixel = { id?: string; name?: string; last_fired_time?: string; is_unavailable?: boolean };
type RawBucket = { start_time?: string; aggregation?: string; data?: { value?: string; count?: number | string }[] };

const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "+0000");

function unreadableReason(error: unknown, fallback: TrackingUnreadable): TrackingUnreadable {
  if (isMetaReauthError(error)) return "reconnect";
  if (error instanceof MetaThrottledError) return "throttled";
  return fallback;
}

/** Every page of a Graph edge, following `cursors.after`; `complete` is false if pages remained after the limit. */
async function readAll<T>(graph: MetaGraph, path: string): Promise<{ rows: T[]; complete: boolean }> {
  const rows: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < PAGE_LIMIT; page++) {
    const result = await graph<GraphPage<T>>(after ? `${path}&after=${encodeURIComponent(after)}` : path);
    if (!Array.isArray(result.data)) throw new Error("Graph returned no list.");
    rows.push(...result.data);
    if (!result.paging?.next) return { rows, complete: true };
    after = result.paging.cursors?.after;
    if (!after) return { rows, complete: false };
  }
  return { rows, complete: false };
}

function pixelFrom(raw: RawPixel): TrackingPixel | null {
  if (typeof raw.id !== "string" || !/^\d+$/.test(raw.id)) return null;
  return { id: raw.id, name: raw.name ?? "", lastFiredAt: raw.last_fired_time ?? null, unavailable: raw.is_unavailable === true };
}

/** With no choice made, an available pixel before an unavailable one, then the one that fired most recently. */
function pickPixel(pixels: TrackingPixel[], pixelId: string | undefined): TrackingPixel | null {
  if (pixelId) return pixels.find((pixel) => pixel.id === pixelId) ?? null;
  return [...pixels].sort((a, b) => Number(a.unavailable) - Number(b.unavailable)
    || (b.lastFiredAt ?? "").localeCompare(a.lastFiredAt ?? ""))[0] ?? null;
}

function later(a: string | null, b: string | null): string | null {
  if (!a || !b) return a ?? b;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

export async function readTrackingStatus(
  graph: MetaGraph,
  adAccountId: string,
  options: { pixelId?: string; need?: TrackingEvent; now?: Date } = {},
): Promise<TrackingStatus> {
  const empty = { pixelId: null, pixels: [], window: null, lastSeenAt: null, counts: null, totalEvents: null };
  let pixels: TrackingPixel[];
  try {
    const listed = await readAll<RawPixel>(graph, `${adAccountId}/adspixels?fields=id,name,last_fired_time,is_unavailable&limit=50`);
    pixels = listed.rows.map(pixelFrom).filter((pixel): pixel is TrackingPixel => pixel !== null);
    if (!listed.complete && !pixels.length) return { ...empty, state: "unreadable", unreadable: "list_failed" };
  } catch (error) {
    return { ...empty, state: "unreadable", unreadable: unreadableReason(error, "list_failed") };
  }
  if (!pixels.length) return { ...empty, state: "none", unreadable: null };

  const pixel = pickPixel(pixels, options.pixelId);
  if (!pixel) return { ...empty, pixels, pixelId: options.pixelId ?? null, state: "unreadable", unreadable: "not_listed" };
  const base = { pixels, pixelId: pixel.id, lastSeenAt: pixel.lastFiredAt };
  if (pixel.unavailable) return { ...base, window: null, counts: null, totalEvents: null, state: "unreadable", unreadable: "unavailable" };

  const until = new Date(options.now ?? Date.now());
  until.setUTCMinutes(0, 0, 0);
  const since = new Date(until.getTime() - TRACKING_WINDOW_DAYS * 86_400_000);
  const window = { since: iso(since), until: iso(until) };
  let stats: { rows: RawBucket[]; complete: boolean };
  try {
    stats = await readAll<RawBucket>(graph,
      `${pixel.id}/stats?aggregation=event&start_time=${encodeURIComponent(window.since)}&end_time=${encodeURIComponent(window.until)}`);
  } catch (error) {
    return { ...base, window: null, counts: null, totalEvents: null, state: "unreadable", unreadable: unreadableReason(error, "stats_failed") };
  }

  const counts: Record<TrackingEvent, number> = { Lead: 0, Purchase: 0 };
  let totalEvents = 0;
  let lastSeenAt = base.lastSeenAt;
  for (const bucket of stats.rows) {
    let inBucket = 0;
    for (const row of bucket.data ?? []) {
      const count = Number(row.count);
      if (!Number.isSafeInteger(count) || count <= 0) continue;
      inBucket += count;
      if (row.value === "Lead" || row.value === "Purchase") counts[row.value] += count;
    }
    totalEvents += inBucket;
    if (inBucket && bucket.start_time && !Number.isNaN(Date.parse(bucket.start_time))) lastSeenAt = later(lastSeenAt, bucket.start_time);
  }

  const wanted = options.need ? counts[options.need] : counts.Lead + counts.Purchase;
  const state: TrackingState = wanted > 0 ? "ready" : totalEvents > 0 ? "event_missing" : "quiet";
  // Pages left unread could hold the missing event, so only "ready" survives an incomplete read.
  if (state !== "ready" && !stats.complete) return { ...base, lastSeenAt, window, counts, totalEvents, state: "unreadable", unreadable: "stats_incomplete" };
  return { ...base, lastSeenAt, window, counts, totalEvents, state, unreadable: null };
}

const TTL_MS = 2 * 60_000;
const MAX_ENTRIES = 500;
const cache = new Map<string, { status: TrackingStatus; expiresAt: number }>();

/**
 * The tracking status, kept for two minutes per business, connection generation, ad account and choice (like
 * `cachedLeadForms`), so a shared ad account never shares a hit across businesses. "unreadable" isn't kept, so the
 * next look retries; `fresh` re-reads Meta.
 */
export async function cachedTrackingStatus(
  meta: MetaClient,
  connection: ConnectionDTO,
  options: { pixelId?: string; need?: TrackingEvent; fresh?: boolean } = {},
): Promise<TrackingStatus> {
  const key = [connection.businessId, connection.generation, connection.selected?.adAccountId, options.pixelId ?? "", options.need ?? ""].join(":");
  const hit = cache.get(key);
  if (!options.fresh && hit && hit.expiresAt > Date.now()) return hit.status;
  const status = await meta.trackingStatus({ pixelId: options.pixelId, need: options.need });
  cache.delete(key);
  if (status.state !== "unreadable") cache.set(key, { status, expiresAt: Date.now() + TTL_MS });
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return status;
}

export function resetTrackingStatusCache() {
  cache.clear();
}
