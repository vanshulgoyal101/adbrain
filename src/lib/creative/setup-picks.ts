import type { Creative } from "@/lib/types";

/**
 * #1270 (#1251 WS1 step 2): which ads a first-timer starts with picked. A fixed rule, no AI call:
 * fewest text repairs first (each repair is one more text model in the receipt), then a picture
 * made by the first-choice image model, then the order the ads were made.
 */
export const SETUP_PICKS = 2;
/** A full setup batch. */
export const SETUP_BATCH = 3;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function setupAdCost(creative: Pick<Creative, "generation">): number {
  const generation = isRecord(creative.generation) ? creative.generation : {};
  const textModels = Array.isArray(generation.textModels) ? generation.textModels.length : 1;
  const image = isRecord(generation.image) ? generation.image : {};
  return Math.max(0, textModels - 1) * 2 + (image.fallbackFrom ? 1 : 0);
}

export function setupPicks<T extends Pick<Creative, "id" | "generation">>(creatives: T[], count = SETUP_PICKS): string[] {
  return creatives
    .map((creative, index) => ({ id: creative.id, cost: setupAdCost(creative), index }))
    .sort((a, b) => a.cost - b.cost || a.index - b.index)
    .slice(0, count)
    .map((item) => item.id);
}

/** The goal Create starts from when the owner hasn't typed one: their offer, to people where they serve. */
export function setupGoal(business: { vertical?: string | null; locations?: readonly string[] | null; offers?: readonly string[] | null }): string {
  const what = business.vertical && business.vertical !== "local business" ? business.vertical.trim() : "our business";
  const where = business.locations?.find((place) => place.trim())?.trim();
  const offer = business.offers?.find((item) => item.trim())?.trim();
  return [`Get WhatsApp enquiries for ${what}${where ? ` in ${where}` : ""}`, offer ? `, leading with: ${offer}` : ""].join("").slice(0, 500);
}

type BatchRow = Pick<Creative, "variant_group" | "created_at">;

/**
 * #1402: from a business's newest creatives (newest first), the ads setup shows, oldest first: the newest batch
 * (one `variant_group`), plus earlier batches from the 2 hours before it while there are fewer than 3 ads, so a
 * "Make another" top-up shows beside its batch. `newest` is that batch, for checking whether it's still running.
 */
export function setupBatch<T extends BatchRow>(newestFirst: T[]): { ads: T[]; newest: { generationId: string; createdAt: string; count: number } | null } {
  const rows = newestFirst.filter((creative) => creative.variant_group);
  if (!rows.length) return { ads: [], newest: null };
  const newestGroup = rows[0].variant_group!;
  const newestRows = rows.filter((creative) => creative.variant_group === newestGroup);
  const since = Date.parse(rows[0].created_at) - 2 * 60 * 60_000;
  const groups: string[] = [];
  let count = 0;
  for (const creative of rows) {
    const group = creative.variant_group!;
    if (groups.includes(group)) continue;
    if (count >= SETUP_BATCH || groups.length >= SETUP_BATCH || Date.parse(creative.created_at) < since) break;
    groups.push(group);
    count += rows.filter((row) => row.variant_group === group).length;
  }
  return {
    ads: rows.filter((creative) => groups.includes(creative.variant_group!)).reverse(),
    newest: { generationId: newestGroup, createdAt: newestRows.at(-1)!.created_at, count: newestRows.length },
  };
}

/** #1402: a short batch started in the last 15 minutes may still be running (another tab or device). */
export function pendingSetupBatch(newest: { generationId: string; createdAt: string; count: number } | null, now: number): { generationId: string } | null {
  return newest && newest.count < SETUP_BATCH && now - Date.parse(newest.createdAt) < 15 * 60_000 ? { generationId: newest.generationId } : null;
}
