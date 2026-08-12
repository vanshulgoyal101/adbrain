import { generateImage } from "@/lib/imageGen";
import { completeJSON } from "@/lib/llm";
import {
  AD_ANGLES,
  buildCopyMessages,
  buildImagePrompt,
  getAngle,
  type AdAngle,
  type BrandContext,
  type GeneratedCopy,
} from "@/lib/templates/ads";

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
 * ad angle. Runs angles in parallel so a 3–5 variant batch stays well under
 * the 60s acceptance target.
 */
export async function generateVariants(params: {
  brand: BrandContext;
  brief: string;
  angleIds?: string[];
  count?: number;
  instructions?: string;
  language?: string;
}): Promise<GeneratedVariant[]> {
  const { brand, brief, instructions, language } = params;
  const count = Math.min(Math.max(params.count ?? 3, 1), AD_ANGLES.length);

  const angles: AdAngle[] = (
    params.angleIds?.length
      ? params.angleIds
          .map(getAngle)
          .filter((a): a is AdAngle => a !== undefined)
      : AD_ANGLES
  ).slice(0, count);

  return Promise.all(
    angles.map((angle) =>
      generateOneVariant(brand, brief, angle, instructions, language),
    ),
  );
}

export async function generateOneVariant(
  brand: BrandContext,
  brief: string,
  angle: AdAngle,
  instructions?: string,
  language?: string,
): Promise<GeneratedVariant> {
  const [copy, image] = await Promise.all([
    completeJSON<GeneratedCopy>(
      buildCopyMessages(brand, brief, angle, instructions, language),
      {
        temperature: 0.8,
        maxTokens: 400,
      },
    ),
    generateImage({
      prompt: buildImagePrompt(brand, brief, angle, instructions),
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
