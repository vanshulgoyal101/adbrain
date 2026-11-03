/**
 * #781 (#744): is an owner's video ready at Meta before Go live? A creative whose `media_asset_id` is a video needs
 * that video processed in the business's ad account (`media_meta_uploads`, #749). Preflight blocks on anything but
 * ready, so launch only ever runs on all-ready ads: no partial launch and no "processing" state to finish later.
 */
import { VIDEO_PROBLEM_WORDS } from "@/lib/meta/media";
import { mediaUploadsEnabled } from "@/lib/media/store";
import { supabaseMetaMediaStore } from "@/services/meta-media-store";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MetaMediaStore } from "@/services/meta-media";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PreflightVideo = { state: "ready" | "processing" | "error"; reason: string | null; videoId?: string };

export async function readCreativeVideos(
  store: Pick<MetaMediaStore, "asset" | "upload">,
  businessId: string,
  adAccountId: string,
  links: { creativeId: string; mediaAssetId: string | null }[],
): Promise<Map<string, PreflightVideo>> {
  const videos = new Map<string, PreflightVideo>();
  await Promise.all(links.map(async ({ creativeId, mediaAssetId }) => {
    if (!mediaAssetId) return;
    const asset = await store.asset(businessId, mediaAssetId);
    if (asset?.kind !== "video") return;
    const upload = await store.upload(asset.id, adAccountId);
    if (!upload || upload.status === "starting" || upload.status === "processing") videos.set(creativeId, { state: "processing", reason: null });
    else if (upload.status === "error") videos.set(creativeId, { state: "error", reason: VIDEO_PROBLEM_WORDS[upload.problem ?? "unknown"] });
    else videos.set(creativeId, upload.videoId ? { state: "ready", reason: null, videoId: upload.videoId } : { state: "processing", reason: null });
  }));
  return videos;
}

/**
 * The videos among `creativeIds`. Only with uploads on, which is when `creatives.media_asset_id` (#2625) is in the
 * database; a failed read throws (a retry), never a pass. `adAccountId` is read lazily: only when some ad has media.
 */
export async function loadCreativeVideos(
  database: Pick<SupabaseClient, "from">,
  businessId: string,
  creativeIds: string[],
  adAccountId: () => Promise<string | undefined>,
): Promise<Map<string, PreflightVideo>> {
  if (!mediaUploadsEnabled() || creativeIds.length === 0) return new Map();
  const { data, error } = await database.from("creatives").select("id, media_asset_id").in("id", creativeIds).eq("business_id", businessId);
  if (error) throw new Error("Creatives could not be read.");
  const links = (data ?? []).map((row: { id: string; media_asset_id: string | null }) => ({ creativeId: row.id, mediaAssetId: row.media_asset_id ?? null }));
  const account = links.some((link) => link.mediaAssetId) ? await adAccountId() : undefined;
  return account ? readCreativeVideos(supabaseMetaMediaStore(createAdminClient()), businessId, account, links) : new Map();
}
