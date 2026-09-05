import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdDesignSpec } from "@/lib/creative/design";
import { renderCompositeAd } from "@/lib/creative/render";
import { getEnv } from "@/lib/env";
import { downloadImage } from "@/lib/imageGen";
import type { Database } from "@/lib/types";

export async function persistCreativeImage(
  supabase: SupabaseClient<Database>,
  businessId: string,
  variantGroup: string,
  angleId: string,
  sourceUrl: string,
): Promise<string> {
  const { bytes, contentType } = await downloadImage(sourceUrl);
  return persistCreativeImageBytes(
    supabase,
    businessId,
    variantGroup,
    angleId,
    bytes,
    contentType,
  );
}

/** Upload already-in-memory image bytes to the `creatives` bucket. */
export async function persistCreativeImageBytes(
  supabase: SupabaseClient<Database>,
  businessId: string,
  variantGroup: string,
  name: string,
  bytes: Uint8Array,
  contentType = "image/png",
): Promise<string> {
  const ext = contentType.includes("png") ? "png" : "jpg";
  const path = `${businessId}/${variantGroup}/${name}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("creatives")
    .upload(path, bytes, { contentType, upsert: true });
  if (error)
    throw new Error(
      "Could not store the generated image. No finished creative was saved.",
    );
  return supabase.storage.from("creatives").getPublicUrl(path).data.publicUrl;
}

export async function renderAndPersistDesign(
  supabase: SupabaseClient<Database>,
  businessId: string,
  variantGroup: string,
  angleId: string,
  design: AdDesignSpec,
  photoUrl: string,
): Promise<string> {
  if (!getEnv().AD_DESIGN_OVERLAY) return photoUrl;
  const bytes = await renderCompositeAd({ ...design, backgroundUrl: photoUrl });
  const url = await persistCreativeImageBytes(
    supabase,
    businessId,
    variantGroup,
    `${angleId}-ad`,
    bytes,
    "image/png",
  );
  return url;
}
