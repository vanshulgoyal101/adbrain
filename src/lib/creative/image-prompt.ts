import type { BrandContext } from "@/lib/templates/ads";
import { formatDimensions } from "@/lib/creative/design";
import type { ConceptInput, CreativeConcept } from "@/lib/creative/concept";

/** The image model's prompt for a validated concept (Create, and a new scene from the owner via background.ts). */
export function conceptImagePrompt(
  concept: CreativeConcept,
  input: ConceptInput,
): string {
  const dims = formatDimensions(input.format ?? "portrait");
  const brand = input.brand;
  const business = brand.vertical?.trim() || "local business";
  // #2441: FLUX-schnell has no negative prompt and letters a named business onto the picture as signage, so the
  // rule leads, the name never reaches the prompt, and only the brand's visual fields go (no phone, offers or site).
  return [
    `A text-free ${concept.visual.medium} for a ${business}: no words, letters, numbers, signs with writing, logos or watermarks anywhere in the image.`,
    withoutBrandName(concept.visual.direction, brand),
    `Business context (for the scene only): ${JSON.stringify(visualBrandContext(brand))}`,
    input.advisoryPreferences ? `Style advisory only (not claims or requirements; current visual direction and Brand facts win): ${withoutBrandName(input.advisoryPreferences, brand)}` : "",
    `Composition: ${dims.width}:${dims.height}; keep the ${concept.visual.textPlacement} area quiet for separately rendered copy.`,
    input.referenceImages?.length
      ? "Use supplied references for product identity, materials and proportions. Do not reproduce text or layouts from past ads."
      : "No reference images supplied; use an illustrative representation, not purported documentary evidence of this business.",
    "Do not render words, letters, logos, watermarks or interface elements. Do not depict unverified claims or before/after health outcomes.",
  ].join("\n");
}

function visualBrandContext(brand: BrandContext): Record<string, unknown> {
  const context: Record<string, unknown> = {
    business: brand.vertical,
    description: brand.description ? withoutBrandName(brand.description, brand) : undefined,
    audience: brand.target_audience,
    locations: brand.locations,
    colors: [brand.primary_color, brand.secondary_color].filter(Boolean),
  };
  return Object.fromEntries(Object.entries(context).filter(([, value]) => Array.isArray(value) ? value.length : value));
}

/**
 * The business name becomes "the <vertical>". A multi-word name matches in any case, with ' / ’, & / "and" and spacing
 * treated alike. A one-word name ("Golden", "Bloom") matches only as written and not at a sentence start, so
 * "Golden hour light" or "a soft bloom of light" stay. No short forms: "San Antonio Roofing" must not eat the skyline.
 */
function withoutBrandName(text: string, brand: BrandContext): string {
  const words = brand.name.trim().split(/\s+/).filter(Boolean);
  if (!words.length || brand.name.trim().length < 3) return text;
  const stand = `the ${brand.vertical?.trim() || "business"}`;
  const pattern = words.map((word) => word
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/['’]/g, "['’]")
    .replace(/^&$|^and$/i, "(?:&|and)")).join("\\s+");
  const edge = "(?![\\p{L}\\p{M}\\p{N}])";
  if (words.length > 1) return text.replace(new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${pattern}${edge}`, "giu"), stand);
  return text.replace(new RegExp(`(?<![\\p{L}\\p{M}\\p{N}]|^|[.!?]\\s+)(?<=[\\s(“"'])${pattern}${edge}`, "gu"), stand);
}
