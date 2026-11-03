import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { brandFacts } from "@/lib/creative/brand-facts";
import { copyClaimWarnings, editableCopySchema } from "@/lib/creative/concept";
import { buildAdDesign } from "@/lib/creative/design";
import { OWNER_PHOTO } from "@/lib/creative/picture-source";
import { persistCreativeImage, renderAndPersistDesign } from "@/lib/creative/persist";
import { saveCreative } from "@/lib/creative/save";
import { getEnv } from "@/lib/env";
import { MAX_AD_PHOTOS } from "@/lib/media/rules";
import type { Business, Creative, Database, Json } from "@/lib/types";

/**
 * #780 slice 2b, "I'll write them": the owner's own words on his library photos. No AI call, so nothing is spent; the
 * words get the same warnings as an edit in Studio (the owner's wording is his call).
 */
export const OWN_WORDS_VERSION = "own-words-1";

export const ownWordsItemSchema = editableCopySchema.extend({
  mediaId: z.string().uuid(),
  /** Draw the headline and main text's first line on the photo (Add my offer); otherwise the photo is used as is. */
  offer: z.boolean().default(false),
});
export type OwnWordsItem = z.infer<typeof ownWordsItemSchema>;

export const ownWordsRequestSchema = z.object({
  businessId: z.string().uuid(),
  items: z.array(ownWordsItemSchema).min(1).max(MAX_AD_PHOTOS)
    .refine((items) => new Set(items.map((item) => item.mediaId)).size === items.length, "Each photo can be used once."),
});

export type OwnWordsAd = { creative: Creative; warnings: string[] };

/**
 * Saves one draft ad per item, in order, under one variant group. `photoUrls` are the photos' signed URLs by media id
 * (already checked as the owner's ready photos). Each ad is saved before the next starts, so a failure keeps the
 * earlier ones; the error is returned with them.
 */
export async function saveOwnWordsAds(
  supabase: SupabaseClient<Database>,
  input: { business: Business; items: OwnWordsItem[]; photoUrls: Map<string, string>; instructions?: string; requestId?: string },
): Promise<{ variantGroup: string; ads: OwnWordsAd[]; error?: unknown }> {
  const { business, items, photoUrls } = input;
  const variantGroup = crypto.randomUUID();
  const overlay = getEnv().AD_DESIGN_OVERLAY;
  const facts = brandFacts(business, input.instructions);
  const ads: OwnWordsAd[] = [];
  for (const [index, item] of items.entries()) {
    const sourceUrl = photoUrls.get(item.mediaId);
    if (!sourceUrl) return { variantGroup, ads, error: new Error("Photo not read") };
    const name = `own-${index + 1}`;
    try {
      const photoUrl = await persistCreativeImage(supabase, business.id, variantGroup, name, sourceUrl);
      const design = item.offer
        ? { ...buildAdDesign({ brand: business, copy: item, ownerPhoto: true }), benefits: [] }
        : null;
      const imageUrl = design && overlay
        ? await renderAndPersistDesign(supabase, business.id, variantGroup, name, design, photoUrl)
        : photoUrl;
      const { mediaId, headline, primary_text, description, cta } = item;
      const copy = { headline, primary_text, description, cta };
      const creative = await saveCreative(supabase, {
        business_id: business.id, brief: "", angle: null, image_url: imageUrl,
        headline: copy.headline, primary_text: copy.primary_text, cta: copy.cta,
        variant_group: variantGroup, status: "draft", media_asset_id: mediaId,
        generation: ownWordsReceipt({ copy, design: design && overlay ? design : null, photoUrl, mediaId, requestId: input.requestId }),
      });
      ads.push({ creative, warnings: copyClaimWarnings(copy, facts, business.vertical, { ownPicture: true }) });
    } catch (error) {
      return { variantGroup, ads, error };
    }
  }
  return { variantGroup, ads };
}

/**
 * The receipt Review, Studio and launch read: the owner's photo (`pictureSource` "yours"), the words as the concept
 * (launch reads its description), no AI models. `composition` isn't "image-only", so Studio can still add words later.
 */
function ownWordsReceipt(input: {
  copy: Omit<OwnWordsItem, "mediaId" | "offer">; design: ReturnType<typeof buildAdDesign> | null;
  photoUrl: string; mediaId: string; requestId?: string;
}): Json {
  const { copy, design } = input;
  return JSON.parse(JSON.stringify({
    version: OWN_WORDS_VERSION,
    ownWords: true,
    requestId: input.requestId,
    concept: { ...copy, description: copy.description || undefined },
    format: design?.format ?? "portrait",
    ...(design ? { design: { ...design, backgroundUrl: undefined } } : {}),
    photoUrl: input.photoUrl,
    language: null,
    referenceImages: [],
    sourceFacts: [],
    composition: design ? "overlay" : "photo",
    textModels: [],
    image: { provider: OWNER_PHOTO, model: OWNER_PHOTO, estimatedCostUsd: 0 },
    imageAttempts: [],
    ownerPhoto: `media:${input.mediaId}`,
  })) as Json;
}
