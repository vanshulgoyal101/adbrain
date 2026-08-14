import { buildAdDesign, formatDimensions, type AdDesignSpec, type AdFormat } from "@/lib/creative/design";
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
  /** Design spec used to composite the finished poster over `imageUrl`. */
  design: AdDesignSpec;
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
  format?: AdFormat;
}): Promise<GeneratedVariant[]> {
  const { brand, brief, instructions, language, format } = params;
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
      generateOneVariant(brand, brief, angle, instructions, language, format),
    ),
  );
}

export async function generateOneVariant(
  brand: BrandContext,
  brief: string,
  angle: AdAngle,
  instructions?: string,
  language?: string,
  format?: AdFormat,
): Promise<GeneratedVariant> {
  const dims = formatDimensions(format ?? "portrait");
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
      width: dims.width,
      height: dims.height,
    }),
  ]);

  const normalizedCopy: GeneratedCopy = {
    headline: copy.headline?.trim() ?? "",
    primary_text: copy.primary_text?.trim() ?? "",
    cta: copy.cta?.trim() || "Learn More",
  };

  return {
    angleId: angle.id,
    angleName: angle.name,
    headline: normalizedCopy.headline,
    primaryText: normalizedCopy.primary_text,
    cta: normalizedCopy.cta,
    imageUrl: image.url,
    imagePrompt: image.prompt,
    design: buildAdDesign({
      brand,
      copy: normalizedCopy,
      angle,
      backgroundUrl: image.url,
      format,
    }),
  };
}
