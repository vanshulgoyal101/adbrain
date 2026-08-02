import type { SupabaseClient } from "@supabase/supabase-js";
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
