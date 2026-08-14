import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdDesignSpec } from "@/lib/creative/design";
import { renderCompositeAd } from "@/lib/creative/render";
import { getEnv } from "@/lib/env";
import { downloadImage } from "@/lib/imageGen";
import type { Database } from "@/lib/types";

/**
 * Download a generated image and store it in the `creatives` bucket so the URL
 * is permanent (Pollinations URLs regenerate on each load). Falls back to the
 * original URL if the download or upload fails.
 */
export async function persistCreativeImage(
  supabase: SupabaseClient<Database>,
  businessId: string,
  variantGroup: string,
  angleId: string,
  sourceUrl: string,
): Promise<string> {
  try {
    const { bytes, contentType } = await downloadImage(sourceUrl);
    const ext = contentType.includes("png") ? "png" : "jpg";
    const path = `${businessId}/${variantGroup}/${angleId}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("creatives")
      .upload(path, bytes, { contentType, upsert: true });
    if (error) return sourceUrl;
    return supabase.storage.from("creatives").getPublicUrl(path).data.publicUrl;
  } catch {
    return sourceUrl;
  }
}

/** Upload already-in-memory image bytes to the `creatives` bucket. */
export async function persistCreativeImageBytes(
  supabase: SupabaseClient<Database>,
  businessId: string,
  variantGroup: string,
  name: string,
  bytes: Uint8Array,
  contentType = "image/png",
): Promise<string | null> {
  try {
    const ext = contentType.includes("png") ? "png" : "jpg";
    const path = `${businessId}/${variantGroup}/${name}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("creatives")
      .upload(path, bytes, { contentType, upsert: true });
    if (error) return null;
    return supabase.storage.from("creatives").getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

/**
 * Composite the finished poster design over the (already persisted) background
 * photo and store it as the creative's image. Best-effort: on any failure — or
 * when the overlay is disabled — the original photo URL is returned unchanged so
 * generation never breaks.
 */
export async function renderAndPersistDesign(
  supabase: SupabaseClient<Database>,
  businessId: string,
  variantGroup: string,
  angleId: string,
  design: AdDesignSpec,
  photoUrl: string,
): Promise<string> {
  if (!getEnv().AD_DESIGN_OVERLAY) return photoUrl;
  try {
    const bytes = await renderCompositeAd({ ...design, backgroundUrl: photoUrl });
    const url = await persistCreativeImageBytes(
      supabase,
      businessId,
      variantGroup,
      `${angleId}-ad`,
      bytes,
      "image/png",
    );
    return url ?? photoUrl;
  } catch {
    return photoUrl;
  }
}

