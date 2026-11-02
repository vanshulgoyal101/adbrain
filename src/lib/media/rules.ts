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

export const MEDIA_EXTENSION: Record<MediaMime, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function isMediaMime(value: string): value is MediaMime {
  return (MEDIA_MIME_TYPES as readonly string[]).includes(value);
}

/** #748 (CEO, #2653 = A): owners' own videos on the Free plan. Uploaded as they are; never re-encoded. */
export const MEDIA_VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime"] as const;
export type MediaVideoMime = (typeof MEDIA_VIDEO_MIME_TYPES)[number];
export const MEDIA_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
/** Designer (#744): Stories' own cap; the words take `{max}`, so this one number changes it everywhere. */
export const MEDIA_VIDEO_MAX_SECONDS = 60;
export const MEDIA_MONTHLY_VIDEOS = 3;
export const MEDIA_VIDEO_EXTENSION: Record<MediaVideoMime, string> = { "video/mp4": "mp4", "video/quicktime": "mov" };

export function isMediaVideoMime(value: string): value is MediaVideoMime {
  return (MEDIA_VIDEO_MIME_TYPES as readonly string[]).includes(value);
}

/** Designer (#744): the length to trim a too-big video to, in 5-second steps (`floor(dur×50/size/5)×5`). */
export function videoTrimSeconds(durationMs: number, bytes: number): number {
  const fits = Math.floor((durationMs / 1000) * MEDIA_VIDEO_MAX_BYTES / bytes / 5) * 5;
  return Math.max(5, Math.min(fits, MEDIA_VIDEO_MAX_SECONDS));
}

const MB = 1024 * 1024;

/** Why a video can't be added, in words the owner can act on in their phone's Gallery, or null if it can. */
export function videoRefusal(mime: string, bytes: number, durationMs: number): { status: number; code: string; message: string } | null {
  if (!isMediaVideoMime(mime)) return { status: 415, code: "MEDIA_TYPE", message: "Please choose an MP4 or MOV video." };
  if (bytes > MEDIA_VIDEO_MAX_BYTES) {
    return { status: 413, code: "MEDIA_TOO_LARGE", message: `${Math.ceil(bytes / MB)} MB, limit ${MEDIA_VIDEO_MAX_BYTES / MB} MB. Trim it to about ${videoTrimSeconds(durationMs, bytes)} seconds in your Gallery.` };
  }
  if (durationMs > MEDIA_VIDEO_MAX_SECONDS * 1000 + 500) {
    return { status: 422, code: "MEDIA_TOO_LONG", message: `${Math.round(durationMs / 1000)} seconds, limit ${MEDIA_VIDEO_MAX_SECONDS}. Trim it to ${MEDIA_VIDEO_MAX_SECONDS} seconds or less in your Gallery.` };
  }
  return null;
}

export type MediaFit = { level: "ready" | "feed" | "too_small"; ratio: string; message: string };

/** #751 / #778: what this photo fits, from its pixel size alone. Words are the CPO's (#1868 on #744). Videos (#748) are
 * judged on shape only: a photo's pixel minimum would refuse ordinary phone clips. */
export function mediaFit(width: number, height: number, kind: "image" | "video" = "image"): MediaFit {
  const short = Math.min(width, height);
  const ratio = width / height;
  const label = Math.abs(ratio - 9 / 16) < 0.04 ? "9:16" : Math.abs(ratio - 4 / 5) < 0.04 ? "4:5" : Math.abs(ratio - 1) < 0.04 ? "1:1"
    : Math.abs(ratio - 16 / 9) < 0.06 ? "16:9" : ratio < 1 ? "tall" : "wide";
  if (kind === "image" && short < MEDIA_MIN_SIDE) {
    return { level: "too_small", ratio: label, message: `Too small (${short} px wide). Use the original photo, not a screenshot or a WhatsApp copy.` };
  }
  if (ratio <= 0.84) return { level: "ready", ratio: label, message: "Ready for Feed, Stories and Reels" };
  if (ratio <= 1.06) return { level: "feed", ratio: label, message: "Square: fine for Feed." };
  return { level: "feed", ratio: label, message: `Wide (${label === "wide" ? "landscape" : label}): Feed shows it; Stories and Reels need a tall picture.` };
}
