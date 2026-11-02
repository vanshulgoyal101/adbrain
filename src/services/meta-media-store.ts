import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaAsset, MetaMediaStore, MetaUploadPatch, MetaUploadRow, NewMetaUpload } from "./meta-media";

/** #749: `media_meta_uploads` (20261104_media_meta_uploads.sql) and the `media_assets` it points at, service role only. */
type Admin = Pick<SupabaseClient, "from" | "storage">;

const UPLOAD_COLUMNS = "id, business_id, media_asset_id, ad_account_id, kind, attempt, upload_name, image_hash, video_id, status, problem, width, height, length_ms, instagram_eligible, claimed_at, checked_at";
/** Meta fetches the file within seconds of the POST; one hour also covers its single 389 retry. */
const VIDEO_URL_SECONDS = 3600;
const UNIQUE_VIOLATION = "23505";

type UploadDbRow = {
  id: string; business_id: string; media_asset_id: string; ad_account_id: string; kind: "image" | "video"; attempt: number;
  upload_name: string | null; image_hash: string | null; video_id: string | null; status: MetaUploadRow["status"];
  problem: MetaUploadRow["problem"]; width: number | null; height: number | null; length_ms: number | null;
  instagram_eligible: boolean | null; claimed_at: string; checked_at: string | null;
};

export function supabaseMetaMediaStore(admin: Admin): MetaMediaStore {
  return {
    async asset(businessId, assetId) {
      const { data, error } = await admin.from("media_assets").select("id, business_id, kind, status, deleted_at, path")
        .eq("id", assetId).eq("business_id", businessId).maybeSingle();
      if (error) throw new Error("Couldn't read the media file.");
      if (!data) return null;
      const row = data as { id: string; business_id: string; kind: "image" | "video"; status: string; deleted_at: string | null; path: string };
      return { id: row.id, businessId: row.business_id, kind: row.kind, status: row.status, deletedAt: row.deleted_at, path: row.path } satisfies MediaAsset;
    },
    async upload(assetId, adAccountId) {
      const { data, error } = await admin.from("media_meta_uploads").select(UPLOAD_COLUMNS)
        .eq("media_asset_id", assetId).eq("ad_account_id", adAccountId).maybeSingle();
      if (error) throw new Error("Couldn't read the Meta upload.");
      return data ? fromDb(data as UploadDbRow) : null;
    },
    async insert(row) {
      const { data, error } = await admin.from("media_meta_uploads").insert(toDb(row)).select(UPLOAD_COLUMNS).single();
      if (error?.code === UNIQUE_VIOLATION) return null;
      if (error || !data) throw new Error("Couldn't save the Meta upload.");
      return fromDb(data as UploadDbRow);
    },
    async update(id, expect, patch) {
      const { data, error } = await admin.from("media_meta_uploads").update({ ...toDb(patch), updated_at: new Date().toISOString() })
        .eq("id", id).eq("status", expect.status).eq("attempt", expect.attempt).select(UPLOAD_COLUMNS).maybeSingle();
      if (error) throw new Error("Couldn't save the Meta upload.");
      return data ? fromDb(data as UploadDbRow) : null;
    },
  };
}

/** The signed link Meta pulls an owner's video from (private `media` bucket). */
export async function signedMediaUrl(admin: Admin, asset: MediaAsset): Promise<string> {
  const { data, error } = await admin.storage.from("media").createSignedUrl(asset.path, VIDEO_URL_SECONDS);
  if (error || !data?.signedUrl) throw new Error("Couldn't prepare the video for Meta.");
  return data.signedUrl;
}

function fromDb(row: UploadDbRow): MetaUploadRow {
  return {
    id: row.id, businessId: row.business_id, mediaAssetId: row.media_asset_id, adAccountId: row.ad_account_id, kind: row.kind,
    attempt: row.attempt, uploadName: row.upload_name, imageHash: row.image_hash, videoId: row.video_id, status: row.status,
    problem: row.problem, width: row.width, height: row.height, lengthMs: row.length_ms, instagramEligible: row.instagram_eligible,
    claimedAt: row.claimed_at, checkedAt: row.checked_at,
  };
}

const DB_COLUMN: Record<keyof NewMetaUpload | "checkedAt", keyof UploadDbRow> = {
  businessId: "business_id", mediaAssetId: "media_asset_id", adAccountId: "ad_account_id", kind: "kind", attempt: "attempt",
  uploadName: "upload_name", imageHash: "image_hash", videoId: "video_id", status: "status", problem: "problem",
  width: "width", height: "height", lengthMs: "length_ms", instagramEligible: "instagram_eligible",
  claimedAt: "claimed_at", checkedAt: "checked_at",
};

function toDb(row: NewMetaUpload | MetaUploadPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const column = DB_COLUMN[key as keyof typeof DB_COLUMN];
    if (column && value !== undefined) out[column] = value;
  }
  return out;
}
