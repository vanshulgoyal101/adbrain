/**
 * #1209 (#744 phase 1, slice A; #748, #751, #778): the rules for an owner's uploaded photo. Shared by the
 * upload screen (instant feedback before any bytes move) and the server (re-checked on the stored object).
 */
export const MEDIA_BUCKET = "media";
export const MEDIA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type MediaMime = (typeof MEDIA_MIME_TYPES)[number];
/** The browser re-encodes to at most this long side and size (fixes phone EXIF rotation, shrinks 12 MP photos). */
export const MEDIA_MAX_LONG_SIDE = 2048;
export const MEDIA_MAX_BYTES = 8 * 1024 * 1024;
/** Meta's minimum image width for Feed is 600 px; smaller photos look soft in every placement. */
export const MEDIA_MIN_SIDE = 600;
/** CPO #778 / #744: 50 uploads a month during pilots (deleting one doesn't give it back). */
export const MEDIA_MONTHLY_UPLOADS = 50;
/** Bump when the rights wording (#784) changes; owners confirm again. */
export const MEDIA_TERMS_VERSION = "media-v1";

export const MEDIA_EXTENSION: Record<MediaMime, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function isMediaMime(value: string): value is MediaMime {
  return (MEDIA_MIME_TYPES as readonly string[]).includes(value);
}

export type MediaFit = { level: "ready" | "feed" | "too_small"; ratio: string; message: string };

/** #751 / #778: what this photo fits, from its pixel size alone. */
export function mediaFit(width: number, height: number): MediaFit {
  const short = Math.min(width, height);
  const ratio = width / height;
  const label = Math.abs(ratio - 9 / 16) < 0.04 ? "9:16" : Math.abs(ratio - 4 / 5) < 0.04 ? "4:5" : Math.abs(ratio - 1) < 0.04 ? "1:1"
    : Math.abs(ratio - 16 / 9) < 0.06 ? "16:9" : ratio < 1 ? "tall" : "wide";
  if (short < MEDIA_MIN_SIDE) {
    return { level: "too_small", ratio: label, message: `Too small (${short} px on its short side). Use the original photo; at least ${MEDIA_MIN_SIDE} px works.` };
  }
  if (ratio <= 0.84) return { level: "ready", ratio: label, message: "Ready for Feed, Stories and Reels" };
  if (ratio <= 1.06) return { level: "feed", ratio: label, message: "Square: fine for Feed. Reels and Stories crop the top and bottom." };
  return { level: "feed", ratio: label, message: "Wide: Feed only. Reels and Stories need a tall photo." };
}
