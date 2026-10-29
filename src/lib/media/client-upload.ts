import { isMediaMime, MEDIA_MAX_BYTES, MEDIA_MAX_LONG_SIDE, mediaFit, type MediaFit } from "@/lib/media/rules";
import type { MediaView } from "@/lib/media/store";

/**
 * #778 slice 3b: the browser half of an upload. Each photo is re-encoded here (fixes phone EXIF rotation, strips
 * location data, shrinks 12 MP photos to 2048 px), hashed, then sent: sign → Storage → finalize. Words are the
 * CPO's (#1868 on #744).
 */
export const MEDIA_PICK_MAX = 10;
export const UPLOAD_WORDS = {
  format: "This file type can't be used. Use a JPG or PNG photo, or an MP4 or MOV video.",
  failed: "This didn't upload. Check your connection and tap Try again.",
  duplicate: "You already added this one; using the saved copy.",
  rightsRequired: "Tick the box above to add your photos.",
  limitCount: (max: number) => `You can add up to ${max} at a time. Add the rest after these finish.`,
  tooBig: (size: string, max: string) => `This file is ${size}; the limit is ${max}. Trim or compress it in your gallery and add it again.`,
};

export type Prepared = { name: string; blob: Blob; bytes: number; width: number; height: number; sha256: string; fit: MediaFit };
export type Encoded = { blob: Blob; width: number; height: number };
export type Codec = (file: File, maxSide: number) => Promise<Encoded>;

export class UploadError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "UploadError";
  }
}

export function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** The long side capped at `max`, keeping the shape. */
export function scaledSize(width: number, height: number, max = MEDIA_MAX_LONG_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Decodes with the photo's own rotation, paints on white (transparent PNGs) and saves a JPEG. */
export const browserCodec: Codec = async (file, maxSide) => {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const size = scaledSize(bitmap.width, bitmap.height, maxSide);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) throw new Error("Encode failed");
    return { blob, ...size };
  } finally {
    bitmap.close();
  }
};

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A picked file, ready to send, or an UploadError with the line to show under it. Nothing leaves the phone here. */
export async function prepareImage(file: File, codec: Codec = browserCodec): Promise<Prepared> {
  if (!isMediaMime(file.type)) throw new UploadError("MEDIA_FORMAT", UPLOAD_WORDS.format);
  let encoded: Encoded;
  try { encoded = await codec(file, MEDIA_MAX_LONG_SIDE); }
  catch { throw new UploadError("MEDIA_FORMAT", UPLOAD_WORDS.format); }
  const fit = mediaFit(encoded.width, encoded.height);
  if (fit.level === "too_small") throw new UploadError("MEDIA_TOO_SMALL", fit.message);
  if (encoded.blob.size > MEDIA_MAX_BYTES) throw new UploadError("MEDIA_TOO_BIG", UPLOAD_WORDS.tooBig(megabytes(encoded.blob.size), megabytes(MEDIA_MAX_BYTES)));
  const name = file.name.replace(/\.[^.]+$/, "").slice(0, 200) || "Photo";
  return { name, blob: encoded.blob, bytes: encoded.blob.size, width: encoded.width, height: encoded.height, sha256: await sha256Hex(encoded.blob), fit };
}

export type SignedUpload = (path: string, token: string, blob: Blob) => Promise<{ error: unknown }>;
export type UploadDeps = { fetch: typeof fetch; uploadToSignedUrl: SignedUpload };

async function postJson(deps: UploadDeps, url: string, body: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await deps.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new UploadError("MEDIA_NETWORK", UPLOAD_WORDS.failed);
  }
  const json = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof json.code === "string" ? json.code : "MEDIA_UNAVAILABLE";
    if (code === "MEDIA_RIGHTS_REQUIRED") throw new UploadError(code, UPLOAD_WORDS.rightsRequired);
    // The server's own reasons (too small, monthly limit, can't read) are owner-facing; a crash isn't.
    throw new UploadError(code, response.status < 500 && typeof json.error === "string" ? json.error : UPLOAD_WORDS.failed);
  }
  return json;
}

/** sign → upload straight to Storage → finalize. A duplicate photo reuses the saved copy and sends no bytes. */
export async function uploadPrepared(businessId: string, file: Prepared, deps: UploadDeps): Promise<{ status: "added" | "duplicate"; asset: MediaView }> {
  const signed = await postJson(deps, "/api/media/sign", {
    businessId, mime: "image/jpeg", bytes: file.bytes, sha256: file.sha256, width: file.width, height: file.height, name: file.name,
  });
  if (signed.duplicate) return { status: "duplicate", asset: signed.asset as MediaView };
  const { error } = await deps.uploadToSignedUrl(String(signed.path), String(signed.token), file.blob).catch((caught: unknown) => ({ error: caught }));
  if (error) throw new UploadError("MEDIA_NETWORK", UPLOAD_WORDS.failed);
  const finalized = await postJson(deps, "/api/media/finalize", { id: signed.id });
  return { status: "added", asset: finalized.asset as MediaView };
}
