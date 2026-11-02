import type { Creative } from "@/lib/types";

// Setup step 2's batch memory, shared by every tab of one browser (#1402, #1534).
const generationKey = (businessId: string) => `setup-generation:${businessId}`;
/** A batch takes 1–3 minutes; a kept id older than this is a leftover, not a run in progress. */
const KEEP_MS = 15 * 60_000;

/** #1402: the run in progress lives in localStorage, so a second tab resumes it instead of paying for another. */
export function readKept(businessId: string, fallbackCount: number): { id: string; count: number } | null {
  try {
    const [id, count, at] = (window.localStorage.getItem(generationKey(businessId)) ?? "").split(":");
    if (!id || Date.now() - Number(at) > KEEP_MS) return null;
    return { id, count: Number(count) || fallbackCount };
  } catch { return null; }
}
export function keep(businessId: string, id: string, count: number) {
  try { window.localStorage.setItem(generationKey(businessId), `${id}:${count}:${Date.now()}`); } catch { /* private mode: this tab still guards itself */ }
}
export function forget(businessId: string) {
  try { window.localStorage.removeItem(generationKey(businessId)); } catch { /* nothing kept */ }
}
/**
 * #1534: the tab that gets a batch's ads publishes them, so other tabs waiting on the same batch show them at once
 * instead of polling the status route (150 reads per 5 minutes per owner, shared by every tab) into 429s.
 */
const resultKey = (businessId: string) => `setup-generation-result:${businessId}`;
export function readResult(businessId: string, id: string, raw?: string | null): Creative[] | null {
  try {
    const value = JSON.parse(raw ?? window.localStorage.getItem(resultKey(businessId)) ?? "null") as { id?: string; at?: number; creatives?: Creative[] } | null;
    if (value && Date.now() - Number(value.at) > KEEP_MS) { window.localStorage.removeItem(resultKey(businessId)); return null; }
    return value?.id === id && Array.isArray(value.creatives) && value.creatives.length ? value.creatives : null;
  } catch { return null; }
}
export function publish(businessId: string, id: string, creatives: Creative[]) {
  if (!creatives.length) return;
  try { window.localStorage.setItem(resultKey(businessId), JSON.stringify({ id, at: Date.now(), creatives })); } catch { /* the other tabs keep polling */ }
}
/** Waits up to `ms` for another tab to publish this batch; null if none did. */
export function publishedWithin(businessId: string, id: string, ms: number): Promise<Creative[] | null> {
  return new Promise((resolve) => {
    const done = (value: Creative[] | null) => { window.clearTimeout(timer); window.removeEventListener("storage", heard); resolve(value); };
    const heard = (event: StorageEvent) => {
      if (event.key !== resultKey(businessId)) return;
      const found = readResult(businessId, id, event.newValue);
      if (found) done(found);
    };
    const timer = window.setTimeout(() => done(readResult(businessId, id)), ms);
    window.addEventListener("storage", heard);
  });
}
