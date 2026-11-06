import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readVideo, stripVideoMetadata, UnsafeVideoError } from "@/lib/media/mp4";
import { mediaVideoEnabled } from "@/lib/media/config";
import { MEDIA_ASSET_COLUMNS, MediaError, mediaViews, type MediaRow, type MediaView } from "@/lib/media/models";
import {
  mediaBucket, MEDIA_VIDEO_EXTENSION, MEDIA_VIDEO_MAX_BYTES, mediaFit, videoRefusal,
  type MediaFit,
} from "@/lib/media/rules";

type Refuse = (status: number, code: string, message: string) => Promise<never>;
type Checked = { mime: string; extension: string; width: number; height: number; durationMs: number | null; fit: MediaFit };
type VideoFinalizeState =
  | { status: "reserved" }
  | { status: "claimed" | "writing"; finalPath: string; attemptId: string; expectedSha256: string; expectedBytes: number }
  | { status: "ready"; finalPath: string };
type VideoFinalizeClaim = { state: VideoFinalizeState; newlyClaimed: boolean; matchesRequest: boolean };

function reconciliationRequired(): MediaError {
  return new MediaError(409, "MEDIA_RECONCILIATION_REQUIRED", "We couldn't verify the video save yet. Try again later.");
}

function parseVideoFinalizeState(value: unknown, row: MediaRow): VideoFinalizeState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw reconciliationRequired();
  const state = value as Record<string, unknown>;
  if (state.status === "reserved") return { status: "reserved" };
  if (state.status !== "ready" && state.status !== "writing" && state.status !== "claimed") throw reconciliationRequired();
  const finalPath = state.final_path;
  const finalName = typeof finalPath === "string" ? finalPath.slice(`${row.business_id}/`.length) : "";
  if (typeof finalPath !== "string" || !finalPath.startsWith(`${row.business_id}/`) || finalPath === row.path
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:mp4|mov)$/i.test(finalName)) {
    throw reconciliationRequired();
  }
  if (state.status === "ready") return { status: "ready", finalPath };
  const attemptId = state.attempt_id;
  const expectedSha256 = state.expected_sha256;
  const expectedBytes = state.expected_bytes;
  if (typeof attemptId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attemptId)
    || typeof expectedSha256 !== "string" || !/^[0-9a-f]{64}$/.test(expectedSha256)
    || typeof expectedBytes !== "number" || !Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > MEDIA_VIDEO_MAX_BYTES) {
    throw reconciliationRequired();
  }
  return { status: state.status, finalPath, attemptId, expectedSha256, expectedBytes };
}

function parseVideoFinalizeClaim(value: unknown, row: MediaRow): VideoFinalizeClaim {
  const result = Array.isArray(value) ? value[0] : value;
  if (!result || typeof result !== "object" || Array.isArray(result)) throw reconciliationRequired();
  const claim = result as Record<string, unknown>;
  if (claim.state === "ready") {
    const state = parseVideoFinalizeState({ status: "ready", final_path: claim.final_path }, row);
    if (state.status !== "ready") throw reconciliationRequired();
    return { state, newlyClaimed: false, matchesRequest: true };
  }
  const state = parseVideoFinalizeState({
    status: claim.state,
    final_path: claim.final_path,
    attempt_id: claim.attempt_id,
    expected_sha256: claim.expected_sha256,
    expected_bytes: claim.expected_bytes,
  }, row);
  if (state.status === "reserved" || typeof claim.newly_claimed !== "boolean" || typeof claim.matches_request !== "boolean") {
    throw reconciliationRequired();
  }
  return { state, newlyClaimed: claim.newly_claimed, matchesRequest: claim.matches_request };
}

async function videoFinalizeState(admin: SupabaseClient, row: MediaRow): Promise<VideoFinalizeState> {
  let data: unknown;
  try {
    const response = await admin.rpc("media_video_finalize_state", {
      p_asset_id: row.id,
      p_upload_path: row.path,
    });
    if (response.error) throw reconciliationRequired();
    data = response.data;
  } catch {
    throw reconciliationRequired();
  }
  return parseVideoFinalizeState(data, row);
}

async function readyVideoResult(admin: SupabaseClient, row: MediaRow, finalPath: string): Promise<MediaView> {
  let data: unknown;
  try {
    const response = await admin.from("media_assets").select(MEDIA_ASSET_COLUMNS).eq("id", row.id).maybeSingle();
    if (response.error) throw reconciliationRequired();
    data = response.data;
  } catch {
    throw reconciliationRequired();
  }
  const current = data as MediaRow | null;
  if (!current || current.status !== "ready" || current.path !== finalPath) throw reconciliationRequired();
  return (await mediaViews(admin, [current]))[0];
}

export async function finalizeVideoUpload(admin: SupabaseClient, row: MediaRow): Promise<MediaView> {
  const state = await videoFinalizeState(admin, row);
  if (state.status === "ready") return readyVideoResult(admin, row, state.finalPath);
  if (state.status === "writing" || state.status === "claimed") return reconcileVideoFinalize(admin, row, state);

  const { data: blob, error } = await admin.storage.from(mediaBucket(row.kind)).download(row.path);
  if (error || !blob) throw new MediaError(409, "MEDIA_NOT_UPLOADED", "The upload didn't finish. Try again.");
  const bytes = Buffer.from(await blob.arrayBuffer());
  const refuse: Refuse = async (status, code, message) => {
    await admin.storage.from(mediaBucket(row.kind)).remove([row.path]);
    await admin.from("media_assets").update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", row.id).eq("path", row.path).eq("status", "pending");
    throw new MediaError(status, code, message);
  };
  return finalizeVideo(admin, row, bytes, refuse);
}

async function finalizeVideo(admin: SupabaseClient, row: MediaRow, bytes: Buffer, reject: Refuse): Promise<MediaView> {
  const wrongType = "Please choose an MP4 or MOV video.";
  if (!mediaVideoEnabled()) return reject(415, "MEDIA_TYPE", wrongType);
  if (bytes.length > MEDIA_VIDEO_MAX_BYTES) return reject(413, "MEDIA_TOO_LARGE", videoRefusal("video/mp4", bytes.length, row.duration_ms ?? 1)!.message);
  if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) return reject(422, "MEDIA_CHANGED", "The video changed while uploading. Add it again.");
  const info = readVideo(bytes);
  if (!info) return reject(415, "MEDIA_TYPE", wrongType);
  const refusal = videoRefusal(info.mime, bytes.length, info.durationMs);
  if (refusal) return reject(refusal.status, refusal.code, refusal.message);
  let stored: Uint8Array;
  try {
    stored = stripVideoMetadata(bytes);
  } catch (error) {
    if (error instanceof UnsafeVideoError) return reject(415, "MEDIA_TYPE", wrongType);
    throw error;
  }
  return promoteVideo(admin, row, stored, {
    mime: info.mime, extension: MEDIA_VIDEO_EXTENSION[info.mime], width: info.width, height: info.height,
    durationMs: info.durationMs, fit: mediaFit(info.width, info.height, "video"),
  });
}

async function promoteVideo(admin: SupabaseClient, row: MediaRow, stored: Uint8Array, checked: Checked): Promise<MediaView> {
  const candidateFinalPath = `${row.business_id}/${randomUUID()}.${checked.extension}`;
  const expectedSha256 = createHash("sha256").update(stored).digest("hex");
  const expectedBytes = stored.length;
  let responseData: unknown;
  let claimFailed = false;
  try {
    const response = await admin.rpc("media_video_finalize_claim", {
      p_asset_id: row.id,
      p_upload_path: row.path,
      p_candidate_final_path: candidateFinalPath,
      p_expected_sha256: expectedSha256,
      p_expected_bytes: expectedBytes,
    });
    responseData = response.data;
    claimFailed = Boolean(response.error);
  } catch {
    return reconcileClaimFailure(admin, row);
  }
  if (claimFailed) return reconcileClaimFailure(admin, row);

  const claim = parseVideoFinalizeClaim(responseData, row);
  if (claim.state.status === "ready") return readyVideoResult(admin, row, claim.state.finalPath);
  if (claim.state.status === "reserved") throw reconciliationRequired();
  if (!claim.matchesRequest || !claim.newlyClaimed) return reconcileVideoFinalize(admin, row, claim.state);
  if ((claim.state.status !== "claimed" && claim.state.status !== "writing") || claim.state.finalPath !== candidateFinalPath
    || claim.state.expectedSha256 !== expectedSha256 || claim.state.expectedBytes !== expectedBytes) {
    throw reconciliationRequired();
  }

  let writeError: unknown = null;
  try {
    const response = await admin.storage.from(mediaBucket(row.kind))
      .upload(claim.state.finalPath, stored, { upsert: false, contentType: checked.mime });
    writeError = response.error;
  } catch {
    return reconcileVideoFinalize(admin, row, claim.state);
  }
  if (writeError) {
    if (isDefinitivePreAcceptFailure(writeError) && await releaseTerminalAttempt(admin, row, claim.state)) {
      throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't save the video. Try again.");
    }
    return reconcileVideoFinalize(admin, row, claim.state);
  }
  return reconcileVideoFinalize(admin, row, claim.state);
}

async function reconcileClaimFailure(admin: SupabaseClient, row: MediaRow): Promise<MediaView> {
  const state = await videoFinalizeState(admin, row);
  if (state.status === "ready") return readyVideoResult(admin, row, state.finalPath);
  if (state.status === "writing" || state.status === "claimed") return reconcileVideoFinalize(admin, row, state);
  throw reconciliationRequired();
}

function isDefinitivePreAcceptFailure(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return false;
  return ["400", "401", "403", "404", "413", "415", "422"].includes(String(error.statusCode));
}

async function releaseTerminalAttempt(
  admin: SupabaseClient,
  row: MediaRow,
  state: Extract<VideoFinalizeState, { status: "claimed" | "writing" }>,
): Promise<boolean> {
  try {
    const response = await admin.rpc("media_video_finalize_terminal", {
      p_asset_id: row.id,
      p_attempt_id: state.attemptId,
    });
    return !response.error && response.data === true;
  } catch {
    return false;
  }
}

async function reconcileVideoFinalize(
  admin: SupabaseClient,
  row: MediaRow,
  state: Extract<VideoFinalizeState, { status: "claimed" | "writing" }>,
): Promise<MediaView> {
  let stored: Buffer;
  try {
    const downloaded = await admin.storage.from(mediaBucket(row.kind)).download(state.finalPath);
    if (downloaded.error || !downloaded.data) throw reconciliationRequired();
    stored = Buffer.from(await downloaded.data.arrayBuffer());
  } catch {
    throw reconciliationRequired();
  }
  if (stored.length !== state.expectedBytes || createHash("sha256").update(stored).digest("hex") !== state.expectedSha256) {
    throw reconciliationRequired();
  }
  const info = readVideo(stored);
  if (!info) throw reconciliationRequired();
  const checked: Checked = {
    mime: info.mime,
    extension: MEDIA_VIDEO_EXTENSION[info.mime],
    width: info.width,
    height: info.height,
    durationMs: info.durationMs,
    fit: mediaFit(info.width, info.height, "video"),
  };
  let data: unknown;
  let failed = false;
  try {
    const response = await admin.rpc("media_video_finalize_complete", {
      p_asset_id: row.id,
      p_upload_path: row.path,
      p_final_path: state.finalPath,
      p_attempt_id: state.attemptId,
      p_expected_sha256: state.expectedSha256,
      p_expected_bytes: state.expectedBytes,
      p_mime: checked.mime,
      p_width: checked.width,
      p_height: checked.height,
      p_duration_ms: checked.durationMs,
      p_checks: { fit: checked.fit, storedSha256: state.expectedSha256 },
    });
    data = response.data;
    failed = Boolean(response.error);
  } catch {
    const latest = await videoFinalizeState(admin, row);
    if (latest.status === "ready") return readyVideoResult(admin, row, latest.finalPath);
    throw reconciliationRequired();
  }
  if (failed || data !== true) {
    const latest = await videoFinalizeState(admin, row);
    if (latest.status === "ready") return readyVideoResult(admin, row, latest.finalPath);
    throw reconciliationRequired();
  }
  const result = await readyVideoResult(admin, row, state.finalPath);
  const { error: removeError } = await admin.storage.from(mediaBucket(row.kind)).remove([row.path]);
  if (removeError) throw new MediaError(503, "MEDIA_UNAVAILABLE", "Couldn't finish saving the video. Try again.");
  return result;
}
