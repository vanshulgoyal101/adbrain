const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Matches `OWNER_PHOTO_PROVIDER` in generate.ts (kept apart so the browser doesn't load the generator). */
const OWNER_PHOTO = "owner-photo";

/** #1901: whose picture an ad uses, from its (client) receipt; null when unknown (no receipt or no image record). */
export function pictureSource(generation: unknown): "yours" | "ai" | null {
  if (!isRecord(generation) || !isRecord(generation.image) || typeof generation.image.provider !== "string") return null;
  return generation.image.provider === OWNER_PHOTO ? "yours" : "ai";
}
