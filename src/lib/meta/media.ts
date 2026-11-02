/**
 * #749 (#744 plan 2): an owner's video goes to Meta by URL. Meta pulls the file itself (no bytes pass through
 * Vercel), then processes it for minutes, so the caller starts the upload, stores the id and polls the Video
 * node until `ready`. Adapter-shaped (ADR-001, #1792): Graph in, plain results out, so the Meta channel adapter
 * can lift these as they are. Images go up as bytes to `adimages` (`uploadAdImageBytes`).
 */
import { jpegIfWebp } from "@/lib/imageGen/encode";
import { readBoundedResponse } from "@/lib/imageGen/raster";
import { fetchPublicUrl } from "@/lib/security/ssrf";
import { MetaError, isThrottleCode } from "./client";
import { destinationCTA } from "./destinations";

export type MetaGraph = <T>(path: string, opts?: { method?: string; form?: Record<string, string> }) => Promise<T>;

export type AdVideoState = {
  status: "processing" | "ready" | "error";
  width: number | null;
  height: number | null;
  lengthSeconds: number | null;
  instagramEligible: boolean | null;
  thumbnailUrl: string | null;
};

export type AdVideoProblem = {
  kind: "unreachable" | "format" | "file" | "too_small" | "invalid" | "reconnect" | "throttled" | "unknown";
  message: string;
};

export type AdVideoLookup = { status: "found"; videoId: string } | { status: "absent" } | { status: "unknown" };

/** Meta's video title limit is "less than 255 characters". */
const TITLE_MAX = 254;
const CANT_FETCH_URL = 389;

export const AD_VIDEO_FIELDS = "status,length,is_instagram_eligible,format{width,height,filter},picture,thumbnails{uri,width,height,is_preferred}";

/** Fetch a public http(s) image (SSRF-guarded, size-bounded) for `uploadAdImageBytes`. */
export async function fetchAdImage(imageUrl: string, signal?: AbortSignal): Promise<Uint8Array> {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new MetaError("Creative image URL is invalid.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new MetaError("Creative image URL must use HTTP or HTTPS.");
  }
  let imgRes: Response;
  try {
    imgRes = await fetchPublicUrl(parsed.toString(), { timeoutMs: 30_000, signal });
  } catch {
    throw new MetaError("Could not fetch the creative image.");
  }
  if (!imgRes.ok) {
    throw new MetaError(`Could not fetch creative image (${imgRes.status}).`);
  }
  return readBoundedResponse(imgRes);
}

/** `POST /act_{id}/adimages` and return the image hash. */
export async function uploadAdImageBytes(graph: MetaGraph, adAccountId: string, bytes: Uint8Array): Promise<string> {
  // #1897: stored ads are WebP; Meta's ad images are sent as JPEG.
  const b64 = Buffer.from((await jpegIfWebp(bytes)).bytes).toString("base64");
  const data = await graph<{ images?: Record<string, { hash: string }> }>(`${adAccountId}/adimages`, {
    method: "POST",
    form: { bytes: b64 },
  });
  const first = Object.values(data.images ?? {})[0];
  if (!first?.hash) throw new MetaError("Image upload returned no hash.");
  return first.hash;
}

/**
 * `POST /act_{id}/advideos` with `file_url`. Meta's 389 (it couldn't fetch the URL, e.g. the signed link
 * expired first) gets exactly one more try with a freshly signed URL; nothing else repeats, since a write
 * may have been done.
 */
export async function startAdVideo(
  graph: MetaGraph,
  adAccountId: string,
  input: { fileUrl: () => string | Promise<string>; name: string; title: string },
): Promise<string> {
  const post = async () => graph<{ id?: string }>(`${adAccountId}/advideos`, {
    method: "POST",
    form: { file_url: await input.fileUrl(), name: input.name, title: input.title.trim().slice(0, TITLE_MAX) },
  });
  const created = await post().catch((error: unknown) => {
    if (error instanceof MetaError && error.code === CANT_FETCH_URL) return post();
    throw error;
  });
  if (!created.id) throw new MetaError("Video upload returned no id.");
  return created.id;
}

/** `title` echoes the `name` sent to `advideos` (recorded); reading `name` is refused (12). */
export const AD_VIDEO_LIST_FIELDS = "id,title,created_time";
const LIST_PAGE = 50;
const LIST_PAGES = 4;

/**
 * After an `advideos` POST whose answer never arrived, finds the video by the unique name it was sent with, so it is
 * never uploaded twice. Graph refuses `filtering` on title (100, recorded), so this reads the list (newest-first,
 * recorded but not promised) and calls it absent only after a whole page older than `since` (the claim time) or the
 * end of the list. `unknown` when 200 videos didn't settle it: never re-upload then.
 */
export async function findAdVideoByName(graph: MetaGraph, adAccountId: string, name: string, since: Date): Promise<AdVideoLookup> {
  let after: string | null = null;
  for (let page = 0; page < LIST_PAGES; page++) {
    const cursor: string = after ? `&after=${encodeURIComponent(after)}` : "";
    const data: { data?: { id?: string; title?: string; created_time?: string }[]; paging?: { cursors?: { after?: string }; next?: string } } =
      await graph(`${adAccountId}/advideos?fields=${encodeURIComponent(AD_VIDEO_LIST_FIELDS)}&limit=${LIST_PAGE}${cursor}`);
    const videos = data.data ?? [];
    const match = videos.find((video) => video.id && video.title === name);
    if (match?.id) return { status: "found", videoId: match.id };
    const older = (video: { created_time?: string }) => Date.parse(video.created_time ?? "") < since.getTime();
    if (videos.length > 0 && videos.every(older)) return { status: "absent" };
    after = data.paging?.next ? data.paging.cursors?.after ?? null : null;
    if (!after) return { status: "absent" };
  }
  return { status: "unknown" };
}

export async function readAdVideo(graph: MetaGraph, videoId: string): Promise<AdVideoState> {
  return decodeAdVideo(await graph<AdVideoNode>(`${videoId}?fields=${encodeURIComponent(AD_VIDEO_FIELDS)}`));
}

type AdVideoNode = {
  id: string;
  status?: { video_status?: string };
  length?: number;
  is_instagram_eligible?: boolean;
  format?: { width?: number; height?: number; filter?: string }[];
  picture?: string;
  thumbnails?: { data?: { uri?: string; is_preferred?: boolean }[] };
};

/**
 * `ready` goes, `error` stops; anything else (uploading, processing, upload_complete) keeps polling. While
 * processing Meta answers 0×0, length 0 and a placeholder picture (recorded), so those read as unknown.
 */
export function decodeAdVideo(node: AdVideoNode): AdVideoState {
  const videoStatus = node.status?.video_status;
  const status = videoStatus === "ready" ? "ready" : videoStatus === "error" ? "error" : "processing";
  // The native rendition is Meta's stored size; other filters are scaled copies.
  const format = node.format?.find((entry) => entry.filter === "native") ?? node.format?.at(-1);
  const thumbnails = node.thumbnails?.data ?? [];
  const thumbnail = thumbnails.find((entry) => entry.is_preferred) ?? thumbnails[0];
  const positive = (value: number | undefined) => typeof value === "number" && value > 0 ? value : null;
  return {
    status,
    width: positive(format?.width),
    height: positive(format?.height),
    lengthSeconds: positive(node.length),
    instagramEligible: typeof node.is_instagram_eligible === "boolean" ? node.is_instagram_eligible : null,
    thumbnailUrl: status === "ready" ? thumbnail?.uri ?? node.picture ?? null : null,
  };
}

export const VIDEO_PROBLEM_WORDS: Record<AdVideoProblem["kind"], string> = {
  unreachable: "Couldn't send your video to Meta. Try again.",
  format: "Meta can't read this kind of video. Use an MP4 or MOV from your phone.",
  file: "Meta couldn't use this video file. Try another video.",
  too_small: "This video is too small for Meta. Use a longer or larger video.",
  invalid: "Meta couldn't accept this video. Try another video.",
  reconnect: "Reconnect Facebook to send videos to Meta.",
  throttled: "Meta is busy. We'll try again in a minute.",
  unknown: "Meta couldn't take this video right now. Try again.",
};

/** Plain words for the owner; codes from Meta's Ad Videos reference. */
export function adVideoProblem(error: unknown): AdVideoProblem {
  const kind = adVideoProblemKind(error instanceof MetaError ? error.code : undefined);
  return { kind, message: VIDEO_PROBLEM_WORDS[kind] };
}

function adVideoProblemKind(code: number | undefined): AdVideoProblem["kind"] {
  if (code === CANT_FETCH_URL) return "unreachable";
  if (code === 352) return "format";
  if (code === 351 || code === 6000 || code === 6001) return "file";
  if (code === 382) return "too_small";
  if (code === 100) return "invalid";
  if (code === 190 || code === 200) return "reconnect";
  if (isThrottleCode(code)) return "throttled";
  return "unknown";
}

export type VideoCreativeInput = {
  pageId: string;
  videoId: string;
  /** The video's own thumbnail (`readAdVideo().thumbnailUrl` once ready); Meta needs one on `video_data`. */
  thumbnailUrl: string;
  message: string;
  headline: string;
  description?: string | null;
  destination: "whatsapp" | "instant_form";
  leadFormId?: string;
  /** `whatsappWelcomeMessage(opening)`, already serialized. */
  welcomeMessage?: string;
};

/**
 * #749: the `object_story_spec` for an owner's video ad, the video twin of the launch's `link_data` image creative:
 * same words, same call to action (`destinationCTA`), same WhatsApp welcome. Meta accepted these (validate_only,
 * tests/core/fixtures/meta/video-creative-validate.json). One recorded difference: on `video_data` Meta refuses a
 * `link` in the WhatsApp button (code 105, subcode 1815630), so the number comes from the ad set's promoted object.
 */
export function videoStorySpec(input: VideoCreativeInput): { page_id: string; video_data: Record<string, unknown> } {
  const description = input.description?.trim();
  return {
    page_id: input.pageId,
    video_data: {
      video_id: input.videoId,
      image_url: input.thumbnailUrl,
      message: input.message,
      title: input.headline,
      ...(description ? { link_description: description } : {}),
      ...(input.destination === "whatsapp" && input.welcomeMessage ? { page_welcome_message: input.welcomeMessage } : {}),
      call_to_action: destinationCTA(input.destination, { leadFormId: input.leadFormId }),
    },
  };
}
