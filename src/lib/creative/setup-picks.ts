import type { Creative } from "@/lib/types";

/**
 * #1270 (#1251 WS1 step 2): which ads a first-timer starts with picked. A fixed rule, no AI call:
 * fewest text repairs first (each repair is one more text model in the receipt), then a picture
 * made by the first-choice image model, then the order the ads were made.
 */
export const SETUP_PICKS = 2;

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

/**
 * #1432: whether an ad was made from today's step 1. Step 2 sends `setupGoal` as its one source fact, so an
 * ad made before the owner changed what they sell, where or their offer (or made outside the setup) isn't.
 */
export function madeForSetup(creative: Pick<Creative, "generation">, business: Parameters<typeof setupGoal>[0]): boolean {
  const facts = isRecord(creative.generation) && Array.isArray(creative.generation.sourceFacts) ? creative.generation.sourceFacts : [];
  return facts.includes(setupGoal(business));
}
