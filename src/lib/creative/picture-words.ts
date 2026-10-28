import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buildAdDesign, type AdDesignSpec, type AdFormat } from "@/lib/creative/design";
import { getAngleByName, META_CTAS, type BrandContext } from "@/lib/templates/ads";
import type { Database } from "@/lib/types";

/** The words our overlay prints on the picture (#280 slice 2). */
export const pictureWordsSchema = z.object({
  headline: z.string().trim().min(1).max(40),
  subhead: z.string().trim().max(64),
  phone: z.string().trim().max(20).regex(/^[+\d\s().-]*$/, "Use digits, spaces and + only."),
  ctaLabel: z.enum(META_CTAS),
  /** Omitted by older clients: the picture keeps whatever it has now. */
  showCta: z.boolean().optional(),
});

export type PictureWords = z.infer<typeof pictureWordsSchema>;

const storedDesignSchema = z.object({
  format: z.enum(["portrait", "square", "story", "landscape"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  brandName: z.string(),
  logoUrl: z.string().nullable(),
  headline: z.string(),
  subhead: z.string().nullable(),
  benefits: z.array(z.string()),
  phone: z.string().nullable(),
  // Designs saved before #1147 asked for a call.
  contact: z.enum(["phone", "whatsapp"]).default("phone"),
  contactLabel: z.string().nullable().optional(),
  contactLine: z.string().nullable(),
  ctaLabel: z.string(),
  // Designs saved before #760 were all drawn with the button.
  showCta: z.boolean().default(true),
  primaryColor: z.string(),
  ctaTextColor: z.string(),
  fontFamily: z.string(),
  layout: z.enum(["bottom", "top", "center"]),
});

type CreativeRow = Pick<
  Database["public"]["Tables"]["creatives"]["Row"],
  "headline" | "primary_text" | "cta" | "angle" | "generation"
>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The overlay spec saved in a creative's generation receipt, or null for older ads. */
/** Whether the ad can be laid out at 9:16 (`renderStoryAd`, #333): an overlay ad with its photo and saved design. */
export function hasStoryDesign(generation: unknown): generation is Record<string, unknown> & { photoUrl: string } {
  if (typeof generation !== "object" || generation === null || Array.isArray(generation)) return false;
  const record = generation as Record<string, unknown>;
  return record.composition === "overlay" && typeof record.photoUrl === "string" && storedPictureDesign(record.design) !== null;
}

export function storedPictureDesign(value: unknown): AdDesignSpec | null {
  const stored = storedDesignSchema.safeParse(value);
  return stored.success ? { ...stored.data, backgroundUrl: null } : null;
}

/** The overlay spec saved with the ad, or one rebuilt from the Brand for ads made before it was saved. */
export function pictureDesign(creative: CreativeRow, brand: BrandContext): AdDesignSpec {
  const generation = isRecord(creative.generation) ? creative.generation : {};
  const stored = storedDesignSchema.safeParse(generation.design);
  if (stored.success) return { ...stored.data, backgroundUrl: null };

  const concept = isRecord(generation.concept) ? generation.concept : {};
  const visual = isRecord(concept.visual) ? concept.visual : {};
  const format = z.enum(["portrait", "square", "story", "landscape"]).catch("portrait").parse(generation.format) as AdFormat;
  const design = buildAdDesign({
    brand,
    copy: { headline: creative.headline ?? "", primary_text: creative.primary_text ?? "", cta: creative.cta ?? "" },
    angle: getAngleByName(creative.angle ?? ""),
    format,
    language: typeof generation.language === "string" ? generation.language : null,
  });
  // Ads this old were all drawn with the button (before #760); keep it on redraw.
  if (typeof concept.headline !== "string") return { ...design, showCta: true };
  // Concept ads were drawn from the concept, not from the derived copy fields.
  return {
    ...design,
    showCta: true,
    headline: concept.headline,
    subhead: typeof concept.supportingText === "string" ? concept.supportingText : null,
    benefits: [],
    layout: visual.textPlacement === "top" || visual.textPlacement === "center" ? visual.textPlacement : "bottom",
  };
}

export function pictureWordsOf(design: AdDesignSpec): PictureWords {
  return {
    headline: design.headline,
    subhead: design.subhead ?? "",
    phone: design.phone ?? "",
    ctaLabel: (META_CTAS as readonly string[]).includes(design.ctaLabel)
      ? (design.ctaLabel as PictureWords["ctaLabel"])
      : "Learn More",
    showCta: design.showCta,
  };
}

export function withPictureWords(design: AdDesignSpec, words: PictureWords): AdDesignSpec {
  return {
    ...design,
    headline: words.headline,
    subhead: words.subhead || null,
    phone: words.phone || null,
    ctaLabel: words.ctaLabel,
    showCta: words.showCta ?? design.showCta,
  };
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Ads made before the photo URL was saved: the background sits next to the
 * finished picture as `<angle>-<uuid>`, the finished one as `<angle>-ad-<uuid>`.
 * Picks the newest background stored no later than the finished picture.
 */
export async function findStoredBackground(
  supabase: SupabaseClient<Database>,
  folder: string,
  angleId: string,
  imageUrl: string | null,
): Promise<string | null> {
  const escaped = angleId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const photo = new RegExp(`^${escaped}-${UUID}\\.(?:png|jpg)$`);
  const finishedName = imageUrl?.split("?")[0].split("/").pop() ?? "";
  const found: { path: string; createdAt: string }[] = [];
  let finishedAt: string | null = null;
  for (const dir of [folder, `${folder}/originals-v1`]) {
    const { data, error } = await supabase.storage.from("creatives").list(dir, { limit: 1000 });
    if (error || !data) continue;
    for (const file of data) {
      const createdAt = file.created_at ?? "";
      if (file.name === finishedName) finishedAt = createdAt;
      if (photo.test(file.name)) found.push({ path: `${dir}/${file.name}`, createdAt });
    }
  }
  const usable = found
    .filter((file) => finishedAt === null || file.createdAt <= finishedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const chosen = usable[0];
  return chosen ? supabase.storage.from("creatives").getPublicUrl(chosen.path).data.publicUrl : null;
}
