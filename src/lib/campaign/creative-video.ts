/**
 * #781 (#744): is an owner's video ready at Meta before Go live? A creative whose `media_asset_id` is a video needs
 * that video processed in the business's ad account (`media_meta_uploads`, #749). Preflight blocks on anything but
 * ready, so launch only ever runs on all-ready ads: no partial launch and no "processing" state to finish later.
 */
import { VIDEO_PROBLEM_WORDS, type AdVideoProblem } from "@/lib/meta/media";
import { mediaVideoEnabled } from "@/lib/media/store";
import { supabaseMetaMediaReader } from "@/services/meta-media-store";
import type { MetaMediaStore } from "@/services/meta-media";
import type { SupabaseClient } from "@supabase/supabase-js";

export type VideoReviewProblem = AdVideoProblem["kind"] | "disabled" | "media_missing";
export type PreflightVideo = { state: "ready" | "processing" | "error"; reason: string | null; assetId: string; videoId?: string; problem?: VideoReviewProblem };

const VIDEO_PAUSED = "Videos are switched off for now, so this ad can't launch. Take it out of this campaign or choose another.";
const MEDIA_GONE = "This file was removed or isn't ready. Take it out of this campaign or choose another.";

export async function readCreativeVideos(
  store: Pick<MetaMediaStore, "asset" | "upload">,
  businessId: string,
  adAccountId: string | undefined | (() => Promise<string | undefined>),
  links: { creativeId: string; mediaAssetId: string | null }[],
  videosOn = true,
): Promise<Map<string, PreflightVideo>> {
  const videos = new Map<string, PreflightVideo>();
  let account: Promise<string | undefined> | undefined;
  const selectedAccount = () => (account ??= typeof adAccountId === "function" ? adAccountId() : Promise.resolve(adAccountId));
  await Promise.all(links.map(async ({ creativeId, mediaAssetId }) => {
    if (!mediaAssetId) return;
    const asset = await store.asset(businessId, mediaAssetId);
    // A missing file might be a video; a known photo keeps its existing saved-ad path.
    if (!asset) { videos.set(creativeId, { state: "error", reason: MEDIA_GONE, assetId: mediaAssetId, problem: "media_missing" }); return; }
    if (asset.kind !== "video") return;
    if (asset.deletedAt || asset.status !== "ready") { videos.set(creativeId, { state: "error", reason: MEDIA_GONE, assetId: mediaAssetId, problem: "media_missing" }); return; }
    // Switching either media flag off must not turn a video ad into its poster picture.
    if (!videosOn) { videos.set(creativeId, { state: "error", reason: VIDEO_PAUSED, assetId: asset.id, problem: "disabled" }); return; }
    // Without an ad account there is nothing to launch with: wait, never send the poster as a picture.
    const accountId = await selectedAccount();
    const upload = accountId ? await store.upload(asset.id, accountId) : null;
    if (!upload || upload.status === "starting" || upload.status === "processing") videos.set(creativeId, { state: "processing", reason: null, assetId: asset.id });
    else if (upload.status === "error") {
      const problem = upload.problem ?? "unknown";
      videos.set(creativeId, { state: "error", reason: VIDEO_PROBLEM_WORDS[problem], assetId: asset.id, problem });
    }
    else videos.set(creativeId, upload.videoId ? { state: "ready", reason: null, assetId: asset.id, videoId: upload.videoId } : { state: "processing", reason: null, assetId: asset.id });
  }));
  return videos;
}

/**
 * The videos among `creativeIds`, read even with either media flag off so a linked video never becomes its poster.
 * A failed read throws, and the ad account is read only when a linked video needs it.
 */
export async function loadCreativeVideos(
  database: Pick<SupabaseClient, "from">,
  businessId: string,
  creativeIds: string[],
  adAccountId: () => Promise<string | undefined>,
): Promise<Map<string, PreflightVideo>> {
  if (creativeIds.length === 0) return new Map();
  const { data, error } = await database.from("creatives").select("id, media_asset_id").in("id", creativeIds).eq("business_id", businessId);
  if (error || !data) throw new Error("Creatives could not be read.");
  const links = data.map((row: { id: string; media_asset_id: string | null }) => ({ creativeId: row.id, mediaAssetId: row.media_asset_id ?? null }));
  if (!links.some((link) => link.mediaAssetId)) return new Map();
  return readCreativeVideos(supabaseMetaMediaReader(database), businessId, adAccountId, links, mediaVideoEnabled());
}

/** Find only videos in this business's selected media; owner photos keep their existing launch path. */
export async function findVideoAssetIds(database: Pick<SupabaseClient, "from">, businessId: string, assetIds: string[]): Promise<string[]> {
  if (!mediaVideoEnabled() || assetIds.length === 0) return [];
  const { data, error } = await database.from("media_assets").select("id").eq("business_id", businessId)
    .eq("kind", "video").in("id", [...new Set(assetIds)]);
  if (error || !data) throw new Error("Video files could not be read.");
  return data.map((row: { id: string }) => row.id);
}
