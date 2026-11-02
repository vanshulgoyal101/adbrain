/**
 * #749 (#744): the contract between an owner's file (a `media_assets` row, Dev 7) and Meta: the image hash or video id
 * that ad account has for it, recorded in `media_meta_uploads` so a file goes up once per account.
 *
 * Images are idempotent at Meta (the same bytes give the same hash), so a race only repeats a harmless upload.
 * Videos are not: every `advideos` POST makes a new video. So a video row is claimed (`starting`, with a unique
 * `upload_name`) before the POST; a claim whose answer never came back (timeout, crash) is settled by finding that
 * name at Meta before anything is sent again, and an unsettled lookup never re-sends.
 */
import { MetaError, isThrottleCode, type MetaClient } from "@/lib/meta/client";
import { VIDEO_PROBLEM_WORDS, adVideoProblem, type AdVideoLookup, type AdVideoProblem, type AdVideoState } from "@/lib/meta/media";

export type MediaAsset = {
  id: string;
  businessId: string;
  kind: "image" | "video";
  status: string;
  deletedAt: string | null;
  path: string;
};

export type MetaUploadStatus = "starting" | "processing" | "ready" | "error";

export type MetaUploadRow = {
  id: string;
  businessId: string;
  mediaAssetId: string;
  adAccountId: string;
  kind: "image" | "video";
  attempt: number;
  uploadName: string | null;
  imageHash: string | null;
  videoId: string | null;
  status: MetaUploadStatus;
  problem: AdVideoProblem["kind"] | null;
  width: number | null;
  height: number | null;
  lengthMs: number | null;
  instagramEligible: boolean | null;
  claimedAt: string;
  checkedAt: string | null;
};

export type NewMetaUpload = Omit<MetaUploadRow, "id" | "checkedAt">;
export type MetaUploadPatch = Partial<Omit<MetaUploadRow, "id" | "businessId" | "mediaAssetId" | "adAccountId" | "kind">>;

export type MetaMediaStore = {
  /** The asset only when it belongs to `businessId`. */
  asset(businessId: string, assetId: string): Promise<MediaAsset | null>;
  upload(assetId: string, adAccountId: string): Promise<MetaUploadRow | null>;
  /** `null` when a row for (asset, account) already exists. */
  insert(row: NewMetaUpload): Promise<MetaUploadRow | null>;
  /** Compare-and-set on (status, attempt); `null` when another writer moved the row first. */
  update(id: string, expect: { status: MetaUploadStatus; attempt: number }, patch: MetaUploadPatch): Promise<MetaUploadRow | null>;
};

/**
 * Meta for one ad account: the business's own connected account, never one a request names, so a file can only go to
 * the account its business is connected to.
 */
export type MetaMediaPort = {
  adAccountId: string;
  uploadImage(bytes: Uint8Array): Promise<string>;
  startVideo(input: { fileUrl: () => string | Promise<string>; name: string; title: string }): Promise<string>;
  readVideo(videoId: string): Promise<AdVideoState>;
  findVideoByName(name: string, since: Date): Promise<AdVideoLookup>;
};

export type MetaMediaClient = Pick<MetaClient, "adAccountId" | "uploadAdImageBytes" | "startAdVideo" | "readAdVideo" | "findAdVideoByName">;

/** The business's own MetaClient (from its connection, with its write mode), so the account can't come from a request. */
export function metaMediaPort(client: MetaMediaClient): MetaMediaPort {
  return {
    adAccountId: client.adAccountId,
    uploadImage: (bytes) => client.uploadAdImageBytes(bytes),
    startVideo: (input) => client.startAdVideo(input),
    readVideo: (videoId) => client.readAdVideo(videoId),
    findVideoByName: (name, since) => client.findAdVideoByName(name, since),
  };
}

export type MetaMediaDeps = {
  store: MetaMediaStore;
  meta: MetaMediaPort;
  /** The stored image, checked against its recorded sha256 (Dev 7's `readVerifiedMedia`). */
  readBytes(asset: MediaAsset): Promise<Uint8Array>;
  /** A short-lived signed link Meta fetches the video from; called again for Meta's one 389 retry. */
  signedUrl(asset: MediaAsset): Promise<string>;
  now?: () => Date;
};

export type MetaMediaResult =
  | { status: "ready"; kind: "image"; imageHash: string }
  | { status: "ready"; kind: "video"; videoId: string; width: number | null; height: number | null; lengthMs: number | null; instagramEligible: boolean | null }
  | { status: "processing"; kind: "video"; videoId: string | null }
  | { status: "error"; kind: "image" | "video"; problem: AdVideoProblem }
  | { status: "refused"; reason: "bad_account" | "not_found" | "not_ready" };

/** Clocks (ours across hosts, and Meta's `created_time`) may disagree by up to this much. */
export const CLOCK_SKEW_MS = 5 * 60_000;
/**
 * An `advideos` POST is at most two 15 s Graph calls (one 389 retry), so a claim older than 2 min with no id lost its
 * answer. The skew allowance is added so a host with a slow clock can't make another host's in-flight claim look stale.
 */
export const CLAIM_STALE_MS = 2 * 60_000 + CLOCK_SKEW_MS;
export const MAX_ATTEMPTS = 20;

const AD_ACCOUNT = /^act_[0-9]{1,30}$/;

export function uploadName(assetId: string, attempt: number) {
  return `adbrain-media-${assetId}-${attempt}`;
}

/**
 * Returns the Meta image hash or video id for an owner's file on the business's connected ad account (`deps.meta`),
 * uploading it first if needed. A video comes back `processing` until Meta finishes; call again to poll. `retry`
 * re-sends only a video that ended in `error`, and only after checking Meta doesn't already have it.
 */
export async function ensureMetaMedia(
  deps: MetaMediaDeps,
  input: { businessId: string; assetId: string; retry?: boolean },
): Promise<MetaMediaResult> {
  const adAccountId = deps.meta.adAccountId;
  if (!AD_ACCOUNT.test(adAccountId)) return { status: "refused", reason: "bad_account" };
  const asset = await deps.store.asset(input.businessId, input.assetId);
  if (!asset || asset.businessId !== input.businessId) return { status: "refused", reason: "not_found" };
  if (asset.status !== "ready" || asset.deletedAt) return { status: "refused", reason: "not_ready" };
  const existing = await deps.store.upload(asset.id, adAccountId);
  return asset.kind === "image"
    ? ensureImage(deps, asset, adAccountId, existing)
    : ensureVideo(deps, asset, adAccountId, existing, input.retry === true);
}

async function ensureImage(deps: MetaMediaDeps, asset: MediaAsset, adAccountId: string, existing: MetaUploadRow | null): Promise<MetaMediaResult> {
  if (existing?.status === "ready" && existing.imageHash) return { status: "ready", kind: "image", imageHash: existing.imageHash };
  let imageHash: string;
  try {
    imageHash = await deps.meta.uploadImage(await deps.readBytes(asset));
  } catch (error) {
    if (!(error instanceof MetaError)) throw error;
    return { status: "error", kind: "image", problem: imageProblem(error) };
  }
  const now = nowIso(deps);
  const ready = { status: "ready" as const, imageHash, problem: null, checkedAt: now };
  // A lost race (null) means another writer sent the same bytes, so Meta gave it the same hash; nothing to undo.
  if (existing) await deps.store.update(existing.id, { status: existing.status, attempt: existing.attempt }, ready);
  else await deps.store.insert({ ...blankRow(asset, adAccountId, "ready", now), imageHash });
  return { status: "ready", kind: "image", imageHash };
}

async function ensureVideo(
  deps: MetaMediaDeps,
  asset: MediaAsset,
  adAccountId: string,
  existing: MetaUploadRow | null,
  retry: boolean,
): Promise<MetaMediaResult> {
  if (!existing) {
    const claimed = await deps.store.insert({ ...blankRow(asset, adAccountId, "starting", nowIso(deps)), uploadName: uploadName(asset.id, 1) });
    if (!claimed) return { status: "processing", kind: "video", videoId: null };
    return postVideo(deps, asset, claimed);
  }
  switch (existing.status) {
    case "ready":
      return readyVideo(existing);
    case "processing":
      return pollVideo(deps, existing);
    case "error":
      if (!retry) return videoError(existing);
      // `unknown`: a POST may have reached Meta, so look again before sending a second copy.
      return existing.problem === "unknown" ? settleClaim(deps, asset, existing, true) : reclaim(deps, asset, existing);
    case "starting":
      return settleClaim(deps, asset, existing);
  }
}

async function postVideo(deps: MetaMediaDeps, asset: MediaAsset, claim: MetaUploadRow): Promise<MetaMediaResult> {
  const name = claim.uploadName ?? uploadName(asset.id, claim.attempt);
  const expect = { status: "starting" as const, attempt: claim.attempt };
  let firstUrl: string | null;
  try {
    firstUrl = await deps.signedUrl(asset);
  } catch {
    // Nothing was sent, so a retry is safe.
    await deps.store.update(claim.id, expect, { status: "error", problem: "unreachable", checkedAt: nowIso(deps) });
    return { status: "error", kind: "video", problem: { kind: "unreachable", message: VIDEO_PROBLEM_WORDS.unreachable } };
  }
  // Meta's one 389 retry gets a freshly signed link.
  const fileUrl = () => {
    const url = firstUrl;
    firstUrl = null;
    return url ?? deps.signedUrl(asset);
  };
  let videoId: string;
  try {
    videoId = await deps.meta.startVideo({ fileUrl, name, title: name });
  } catch (error) {
    // Only a refusal Meta actually answered means no video was made; anything else stays `starting` for the lookup.
    if (!refused(error)) return { status: "processing", kind: "video", videoId: null };
    const problem = adVideoProblem(error);
    await deps.store.update(claim.id, expect, { status: "error", problem: problem.kind, checkedAt: nowIso(deps) });
    return { status: "error", kind: "video", problem };
  }
  const saved = await deps.store.update(claim.id, expect, { status: "processing", videoId, problem: null, checkedAt: nowIso(deps) });
  return { status: "processing", kind: "video", videoId: saved?.videoId ?? videoId };
}

async function pollVideo(deps: MetaMediaDeps, row: MetaUploadRow): Promise<MetaMediaResult> {
  if (!row.videoId) return { status: "processing", kind: "video", videoId: null };
  let state: AdVideoState;
  try {
    state = await deps.meta.readVideo(row.videoId);
  } catch (error) {
    // Not saved: the video may well be fine at Meta, and a saved error would let a retry upload it again.
    if (!refused(error) || isThrottleCode((error as MetaError).code)) return { status: "processing", kind: "video", videoId: row.videoId };
    const kind = adVideoProblem(error).kind === "reconnect" ? "reconnect" : "unknown";
    return { status: "error", kind: "video", problem: { kind, message: VIDEO_PROBLEM_WORDS[kind] } };
  }
  const expect = { status: "processing" as const, attempt: row.attempt };
  const checkedAt = nowIso(deps);
  if (state.status === "processing") {
    await deps.store.update(row.id, expect, { checkedAt });
    return { status: "processing", kind: "video", videoId: row.videoId };
  }
  if (state.status === "error") {
    await deps.store.update(row.id, expect, { status: "error", problem: "file", checkedAt });
    return videoError({ ...row, problem: "file" });
  }
  const ready = {
    status: "ready" as const,
    width: state.width,
    height: state.height,
    lengthMs: state.lengthSeconds === null ? null : Math.round(state.lengthSeconds * 1000),
    instagramEligible: state.instagramEligible,
  };
  await deps.store.update(row.id, expect, { ...ready, checkedAt });
  return readyVideo({ ...row, ...ready });
}

/** A claim whose answer was lost (`starting`, stale) or never settled (`error`/`unknown`, on retry): look it up at Meta. */
async function settleClaim(deps: MetaMediaDeps, asset: MediaAsset, claim: MetaUploadRow, retrying = false): Promise<MetaMediaResult> {
  const now = clock(deps);
  const claimedAt = Date.parse(claim.claimedAt);
  const waiting = { status: "processing" as const, kind: "video" as const, videoId: null };
  if (!claim.uploadName || !Number.isFinite(claimedAt)) return retrying ? videoError(claim) : waiting;
  if (!retrying && now.getTime() - claimedAt < CLAIM_STALE_MS) return waiting;
  let lookup: AdVideoLookup;
  try {
    lookup = await deps.meta.findVideoByName(claim.uploadName, new Date(claimedAt - CLOCK_SKEW_MS));
  } catch {
    return retrying ? videoError(claim) : waiting;
  }
  const expect = { status: claim.status, attempt: claim.attempt };
  if (lookup.status === "found") {
    const saved = await deps.store.update(claim.id, expect, { status: "processing", videoId: lookup.videoId, problem: null, checkedAt: now.toISOString() });
    return saved ? pollVideo(deps, saved) : { status: "processing", kind: "video", videoId: lookup.videoId };
  }
  if (lookup.status === "unknown") {
    // Too many newer videos to be sure: never risk a second copy.
    if (claim.status === "starting") await deps.store.update(claim.id, expect, { status: "error", problem: "unknown", checkedAt: now.toISOString() });
    return videoError({ ...claim, problem: "unknown" });
  }
  return reclaim(deps, asset, claim);
}

async function reclaim(deps: MetaMediaDeps, asset: MediaAsset, row: MetaUploadRow): Promise<MetaMediaResult> {
  if (row.attempt >= MAX_ATTEMPTS) {
    if (row.status === "starting") await deps.store.update(row.id, { status: "starting", attempt: row.attempt }, { status: "error", problem: "unknown", checkedAt: nowIso(deps) });
    return videoError({ ...row, problem: row.problem ?? "unknown" });
  }
  const attempt = row.attempt + 1;
  const claimed = await deps.store.update(row.id, { status: row.status, attempt: row.attempt }, {
    status: "starting", attempt, uploadName: uploadName(asset.id, attempt), videoId: null, problem: null,
    width: null, height: null, lengthMs: null, instagramEligible: null, claimedAt: nowIso(deps), checkedAt: null,
  });
  if (!claimed) return { status: "processing", kind: "video", videoId: null };
  return postVideo(deps, asset, claimed);
}

/** Meta answered with a refusal (4xx), so nothing was created. Its "unknown"/"service" codes 1 and 2 may be transient. */
function refused(error: unknown) {
  return error instanceof MetaError
    && typeof error.status === "number" && error.status >= 400 && error.status < 500
    && error.code !== 1 && error.code !== 2;
}

function imageProblem(error: MetaError): AdVideoProblem {
  const kind = adVideoProblem(error).kind;
  if (kind === "reconnect") return { kind, message: "Reconnect Facebook to send pictures to Meta." };
  if (kind === "throttled") return { kind, message: "Meta is busy. Try again in a few minutes." };
  return { kind: kind === "unreachable" ? "unknown" : kind, message: "Meta couldn't use this picture. Try another picture." };
}

function videoError(row: MetaUploadRow): MetaMediaResult {
  const kind = row.problem ?? "unknown";
  return { status: "error", kind: "video", problem: { kind, message: VIDEO_PROBLEM_WORDS[kind] } };
}

function readyVideo(row: MetaUploadRow): MetaMediaResult {
  if (!row.videoId) return { status: "processing", kind: "video", videoId: null };
  return { status: "ready", kind: "video", videoId: row.videoId, width: row.width, height: row.height, lengthMs: row.lengthMs, instagramEligible: row.instagramEligible };
}

function blankRow(asset: MediaAsset, adAccountId: string, status: MetaUploadStatus, now: string): NewMetaUpload {
  return {
    businessId: asset.businessId, mediaAssetId: asset.id, adAccountId, kind: asset.kind, attempt: 1, uploadName: null,
    imageHash: null, videoId: null, status, problem: null, width: null, height: null, lengthMs: null,
    instagramEligible: null, claimedAt: now,
  };
}

function clock(deps: MetaMediaDeps) {
  return deps.now?.() ?? new Date();
}

function nowIso(deps: MetaMediaDeps) {
  return clock(deps).toISOString();
}
