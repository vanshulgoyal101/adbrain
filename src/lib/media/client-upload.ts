import { mediaTranslator } from "@/i18n/words";
import {
  isMediaMime, isMediaVideoMime, MEDIA_MAX_BYTES, MEDIA_MAX_LONG_SIDE, MEDIA_MONTHLY_VIDEOS, MEDIA_VIDEO_MAX_BYTES, MEDIA_VIDEO_MAX_SECONDS,
  mediaBucket, mediaFit, mediaFitWords, videoTrimSeconds, type MediaFit, type MediaVideoMime,
} from "@/lib/media/rules";
import type { MediaView } from "@/lib/media/store";

/**
 * #778 slice 3b: the browser half of an upload. Each photo is re-encoded here (fixes phone EXIF rotation, strips
 * location data, shrinks 12 MP photos to 2048 px), hashed, then sent: sign → Storage → finalize. Words are the
 * CPO's (#1868 on #744).
 */
export const MEDIA_PICK_MAX = 10;
/** A `media.*` key and its values; the screen says it in the owner's language. */
export type UploadWords = { key: "upload.format" | "upload.failed" | "upload.rightsRequired" | "upload.rightsRequiredMedia" | "upload.tooBig" | "upload.videoFormat" | "upload.videoTooBig" | "upload.videoTooBigTrim" | "upload.videoTooLong" | "upload.videoRejectedLarge" | "upload.videoQuotaReached" | "fit.tooSmall"; values?: Record<string, string | number> };
const english = mediaTranslator();

type PreparedFile = { name: string; blob: Blob; bytes: number; width: number; height: number; sha256: string; fit: MediaFit };
export type Prepared = PreparedFile & (
  | { kind: "image"; mime: "image/jpeg" }
  | { kind: "video"; mime: MediaVideoMime; durationMs: number }
);
export type Encoded = { blob: Blob; width: number; height: number };
export type Codec = (file: File, maxSide: number) => Promise<Encoded>;
export type VideoInfo = { width: number; height: number; durationMs: number };
export type VideoReader = (file: File) => Promise<VideoInfo>;

/** `words` is set for the browser's own reasons; without it `message` is the server's, already in the owner's language. */
export class UploadError extends Error {
  constructor(public code: string, message: string, public words?: UploadWords) {
    super(message);
    this.name = "UploadError";
  }
}

const refusal = (code: string, words: UploadWords) => new UploadError(code, english(words.key, words.values), words);

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

export const browserVideoReader: VideoReader = (file) => new Promise((resolve, reject) => {
  const video = document.createElement("video");
  const url = URL.createObjectURL(file);
  const release = () => {
    clearTimeout(timer);
    video.onloadedmetadata = null;
    video.onerror = null;
    video.removeAttribute("src");
    try { video.load(); } finally { URL.revokeObjectURL(url); }
  };
  const timer = setTimeout(() => {
    release();
    reject(new Error("Video metadata timed out"));
  }, 15_000);
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.onloadedmetadata = () => {
    const info = { width: video.videoWidth, height: video.videoHeight, durationMs: Math.ceil(video.duration * 1000) };
    release();
    resolve(info);
  };
  video.onerror = () => {
    release();
    reject(new Error("Video metadata could not be read"));
  };
  try { video.src = url; }
  catch (error) { release(); reject(error); }
});

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A picked file, ready to send, or an UploadError with the line to show under it. Nothing leaves the phone here. */
export async function prepareImage(file: File, codec: Codec = browserCodec): Promise<Prepared> {
  if (!isMediaMime(file.type)) throw refusal("MEDIA_FORMAT", { key: "upload.format" });
  let encoded: Encoded;
  try { encoded = await codec(file, MEDIA_MAX_LONG_SIDE); }
  catch { throw refusal("MEDIA_FORMAT", { key: "upload.format" }); }
  const fit = mediaFit(encoded.width, encoded.height);
  if (fit.level === "too_small") throw refusal("MEDIA_TOO_SMALL", { key: "fit.tooSmall", values: { width: mediaFitWords(encoded.width, encoded.height).width } });
  if (encoded.blob.size > MEDIA_MAX_BYTES) throw refusal("MEDIA_TOO_BIG", { key: "upload.tooBig", values: { size: megabytes(encoded.blob.size), max: megabytes(MEDIA_MAX_BYTES) } });
  const name = file.name.replace(/\.[^.]+$/, "").slice(0, 200) || "Photo";
  return { kind: "image", mime: "image/jpeg", name, blob: encoded.blob, bytes: encoded.blob.size, width: encoded.width, height: encoded.height, sha256: await sha256Hex(encoded.blob), fit };
}

/** Videos retain their original bytes; check their size, duration and shape before signing. */
export async function prepareVideo(file: File, read: VideoReader = browserVideoReader): Promise<Prepared> {
  if (!isMediaVideoMime(file.type) || file.size === 0) throw refusal("MEDIA_FORMAT", { key: "upload.videoFormat" });
  const tooBig = file.size > MEDIA_VIDEO_MAX_BYTES;
  const size = `${Math.ceil(file.size / (1024 * 1024))} MB`;
  const max = megabytes(MEDIA_VIDEO_MAX_BYTES);
  const exportSmaller = () => refusal("MEDIA_TOO_LARGE", { key: "upload.videoTooBig", values: { size, max } });
  let info: VideoInfo;
  try { info = await read(file); }
  catch { throw tooBig ? exportSmaller() : refusal("MEDIA_FORMAT", { key: "upload.videoFormat" }); }
  if (!Number.isSafeInteger(info.width) || info.width <= 0 || !Number.isSafeInteger(info.height) || info.height <= 0
    || !Number.isFinite(info.durationMs) || info.durationMs <= 0) {
    throw tooBig ? exportSmaller() : refusal("MEDIA_FORMAT", { key: "upload.videoFormat" });
  }
  if (tooBig) {
    const seconds = videoTrimSeconds(info.durationMs, file.size);
    if (seconds !== null && seconds * 1000 < info.durationMs) {
      throw refusal("MEDIA_TOO_LARGE", { key: "upload.videoTooBigTrim", values: { size, max, seconds } });
    }
    throw exportSmaller();
  }
  if (info.durationMs > MEDIA_VIDEO_MAX_SECONDS * 1000) {
    throw refusal("MEDIA_TOO_LONG", { key: "upload.videoTooLong", values: { max: MEDIA_VIDEO_MAX_SECONDS } });
  }
  const name = file.name.replace(/\.[^.]+$/, "").slice(0, 200) || "Video";
  return {
    kind: "video", mime: file.type, name, blob: file, bytes: file.size, width: info.width, height: info.height,
    durationMs: info.durationMs, sha256: await sha256Hex(file), fit: mediaFit(info.width, info.height, "video"),
  };
}

export type SignedUpload = (bucket: string, path: string, token: string, blob: Blob, mime: Prepared["mime"]) => Promise<{ error: unknown }>;
export type UploadDeps = { fetch: typeof fetch; uploadToSignedUrl: SignedUpload };

const REQUEST_TIMEOUT_MS = 30_000;
const FINALIZE_TIMEOUT_MS = 90_000;

async function postJson(deps: UploadDeps, url: string, body: unknown, kind: Prepared["kind"], timeout = REQUEST_TIMEOUT_MS): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await deps.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  } catch {
    throw refusal("MEDIA_NETWORK", { key: "upload.failed" });
  }
  const json = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof json.code === "string" ? json.code : "MEDIA_UNAVAILABLE";
    if (code === "MEDIA_RIGHTS_REQUIRED") throw refusal(code, { key: kind === "video" ? "upload.rightsRequiredMedia" : "upload.rightsRequired" });
    if (kind === "video" && response.status < 500) {
      if (code === "MEDIA_QUOTA") throw refusal(code, { key: "upload.videoQuotaReached", values: { limit: MEDIA_MONTHLY_VIDEOS } });
      if (code === "MEDIA_TOO_LARGE") throw refusal(code, { key: "upload.videoRejectedLarge", values: { max: megabytes(MEDIA_VIDEO_MAX_BYTES) } });
      if (code === "MEDIA_TOO_LONG") throw refusal(code, { key: "upload.videoTooLong", values: { max: MEDIA_VIDEO_MAX_SECONDS } });
      if (code === "MEDIA_TYPE" || code === "MEDIA_FORMAT") throw refusal(code, { key: "upload.videoFormat" });
    }
    // The server's own reasons (too small, monthly limit, can't read) are owner-facing and in their language; a crash isn't.
    if (response.status < 500 && typeof json.error === "string") throw new UploadError(code, json.error);
    throw refusal(code, { key: "upload.failed" });
  }
  return json;
}

function isMediaView(value: unknown): value is MediaView {
  if (!value || typeof value !== "object") return false;
  const asset = value as Record<string, unknown>;
  const optionalNumber = (number: unknown) => number === null || (typeof number === "number" && Number.isFinite(number) && number > 0);
  const fit = asset.fit;
  const validFit = fit === null || (typeof fit === "object" && fit !== null
    && "level" in fit && (fit.level === "ready" || fit.level === "feed" || fit.level === "too_small")
    && "ratio" in fit && typeof fit.ratio === "string" && "message" in fit && typeof fit.message === "string");
  return typeof asset.id === "string" && asset.id.length > 0 && (asset.kind === "image" || asset.kind === "video")
    && (asset.name === null || typeof asset.name === "string") && Array.isArray(asset.tags) && asset.tags.every((tag) => typeof tag === "string")
    && optionalNumber(asset.width) && optionalNumber(asset.height) && optionalNumber(asset.bytes) && optionalNumber(asset.durationMs)
    && validFit && (asset.url === null || typeof asset.url === "string") && typeof asset.createdAt === "string";
}

function checkedAsset(value: unknown, kind: Prepared["kind"], id?: string): MediaView {
  if (!isMediaView(value) || value.kind !== kind || (id && value.id !== id)) {
    throw refusal("MEDIA_UNAVAILABLE", { key: "upload.failed" });
  }
  return value;
}

/** sign → upload straight to Storage → finalize. A duplicate reuses the saved copy and sends no bytes. */
export async function uploadPrepared(businessId: string, file: Prepared, deps: UploadDeps, options?: { onSigned?: () => void }): Promise<{ status: "added" | "duplicate"; asset: MediaView }> {
  const signed = await postJson(deps, "/api/media/sign", {
    businessId, mime: file.mime, bytes: file.bytes, sha256: file.sha256, width: file.width, height: file.height,
    ...(file.kind === "video" ? { durationMs: file.durationMs } : {}), name: file.name,
  }, file.kind);
  options?.onSigned?.();
  if (signed.ok === true && signed.duplicate === true) return { status: "duplicate", asset: checkedAsset(signed.asset, file.kind) };
  if (signed.ok !== true || signed.duplicate !== false || signed.bucket !== mediaBucket(file.kind) || typeof signed.id !== "string" || !signed.id
    || typeof signed.path !== "string" || !signed.path || typeof signed.token !== "string" || !signed.token) {
    throw refusal("MEDIA_UNAVAILABLE", { key: "upload.failed" });
  }
  const bucket = mediaBucket(file.kind);
  const { error } = await deps.uploadToSignedUrl(bucket, signed.path, signed.token, file.blob, file.mime).catch((caught: unknown) => ({ error: caught }));
  if (error) throw refusal("MEDIA_NETWORK", { key: "upload.failed" });
  const finalized = await postJson(deps, "/api/media/finalize", { id: signed.id }, file.kind, FINALIZE_TIMEOUT_MS);
  if (finalized.ok !== true) throw refusal("MEDIA_UNAVAILABLE", { key: "upload.failed" });
  return { status: "added", asset: checkedAsset(finalized.asset, file.kind, signed.id) };
}
