import { z } from "zod";
import { conceptImagePrompt, type CreativeConcept } from "@/lib/creative/concept";
import type { AdDesignSpec, AdFormat } from "@/lib/creative/design";
import type { BrandContext } from "@/lib/templates/ads";

/**
 * What the owner wants behind the same words (#280 slice 3): a short description
 * for a new AI picture ("rooftop at sunset"), or one of their own Brand photos.
 */
export const backgroundRequestSchema = z.union([
  z.object({ instruction: z.string().trim().min(3).max(300) }).strict(),
  z.object({ photoUrl: z.string().url().max(2000) }).strict(),
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The image prompt for a new background: the owner's description replaces the
 * earlier scene, which only fills gaps; the no-text and quiet-area rules still win.
 */
export function backgroundImagePrompt(params: {
  generation: unknown;
  design: AdDesignSpec;
  brand: BrandContext;
  format: AdFormat;
  instruction: string;
  referenceImages?: string[];
}): string {
  const generation = isRecord(params.generation) ? params.generation : {};
  const concept = isRecord(generation.concept) ? generation.concept : {};
  const visual = isRecord(concept.visual) ? concept.visual : {};
  const earlier = typeof visual.direction === "string" ? visual.direction.trim() : "";
  const medium = typeof visual.medium === "string" && visual.medium.trim() ? visual.medium.trim() : "Photograph";
  const direction = [
    `New scene requested by the business owner; it replaces the earlier scene: ${params.instruction.trim()}`,
    earlier ? `Earlier scene for this ad, only where it doesn't conflict with the new scene: ${earlier}` : "",
  ].filter(Boolean).join("\n");
  const shaped = { visual: { medium, direction, textPlacement: params.design.layout } } as CreativeConcept;
  return [
    conceptImagePrompt(shaped, {
      brand: params.brand,
      format: params.format,
      referenceImages: params.referenceImages,
    } as Parameters<typeof conceptImagePrompt>[1]),
    `Whatever the scene description says, these rules win: no words, letters, numbers, signs with writing, logos or watermarks anywhere in the image, and keep the ${params.design.layout} area quiet for the separately rendered words.`,
  ].join("\n");
}
