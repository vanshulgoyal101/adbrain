import { generateImage } from "@/lib/imageGen";
import { completeJSON } from "@/lib/llm";
import {
  buildCopyMessages,
  buildImagePrompt,
  getAngle,
  SOLAR_ANGLES,
  type BrandContext,
  type GeneratedCopy,
  type SolarAngle,
} from "@/lib/templates/solar";

export interface GeneratedVariant {
  angleId: string;
  angleName: string;
  headline: string;
  primaryText: string;
  cta: string;
  imageUrl: string;
  imagePrompt: string;
}

/**
 * Generate N complete ad variants (copy + image) for a brand + brief, one per
 * solar angle. Runs angles in parallel so a 3–5 variant batch stays well under
 * the 60s acceptance target.
 */
export async function generateVariants(params: {
  brand: BrandContext;
  brief: string;
  angleIds?: string[];
  count?: number;
}): Promise<GeneratedVariant[]> {
  const { brand, brief } = params;
  const count = Math.min(Math.max(params.count ?? 3, 1), SOLAR_ANGLES.length);

  const angles: SolarAngle[] = (
    params.angleIds?.length
      ? params.angleIds
          .map(getAngle)
          .filter((a): a is SolarAngle => a !== undefined)
      : SOLAR_ANGLES
  ).slice(0, count);

  return Promise.all(angles.map((angle) => generateOne(brand, brief, angle)));
}

async function generateOne(
  brand: BrandContext,
  brief: string,
  angle: SolarAngle,
): Promise<GeneratedVariant> {
  const [copy, image] = await Promise.all([
    completeJSON<GeneratedCopy>(buildCopyMessages(brand, brief, angle), {
      temperature: 0.8,
      maxTokens: 400,
    }),
    generateImage({
      prompt: buildImagePrompt(brand, brief, angle),
      width: 1024,
      height: 1024,
    }),
  ]);

  return {
    angleId: angle.id,
    angleName: angle.name,
    headline: copy.headline?.trim() ?? "",
    primaryText: copy.primary_text?.trim() ?? "",
    cta: copy.cta?.trim() || "Learn More",
    imageUrl: image.url,
    imagePrompt: image.prompt,
  };
}
