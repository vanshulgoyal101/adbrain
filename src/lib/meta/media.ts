/**
 * #749 (#744 plan 2): an owner's video goes to Meta by URL. Meta pulls the file itself (no bytes pass through
 * Vercel), then processes it for minutes, so the caller starts the upload, stores the id and polls the Video
 * node until `ready`. Adapter-shaped (ADR-001, #1792): Graph in, plain results out, so the Meta channel adapter
 * can lift these as they are. Images need nothing new: `MetaClient.uploadAdImageBytes` already does `adimages`.
 */
import { MetaError, isThrottleCode } from "./client";

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

/** Meta's video title limit is "less than 255 characters". */
const TITLE_MAX = 254;
const CANT_FETCH_URL = 389;

export const AD_VIDEO_FIELDS = "status,length,is_instagram_eligible,format{width,height,filter},picture,thumbnails{uri,width,height,is_preferred}";

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

/** Plain words for the owner; codes from Meta's Ad Videos reference. */
export function adVideoProblem(error: unknown): AdVideoProblem {
  const code = error instanceof MetaError ? error.code : undefined;
  if (code === CANT_FETCH_URL) return { kind: "unreachable", message: "Couldn't send your video to Meta. Try again." };
  if (code === 352) return { kind: "format", message: "Meta can't read this kind of video. Use an MP4 or MOV from your phone." };
  if (code === 351 || code === 6000 || code === 6001) return { kind: "file", message: "Meta couldn't use this video file. Try another video." };
  if (code === 382) return { kind: "too_small", message: "This video is too small for Meta. Use a longer or larger video." };
  if (code === 100) return { kind: "invalid", message: "Meta couldn't accept this video. Try another video." };
  if (code === 190 || code === 200) return { kind: "reconnect", message: "Reconnect Facebook to send videos to Meta." };
  if (isThrottleCode(code)) return { kind: "throttled", message: "Meta is busy. We'll try again in a minute." };
  return { kind: "unknown", message: "Meta couldn't take this video right now. Try again." };
}
