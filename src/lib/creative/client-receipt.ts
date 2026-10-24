import type { Creative, Json } from "@/lib/types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

/**
 * The part of a generation receipt the browser reads (#360): Generation details,
 * the link description and the words-on-picture spec. Prompts, source facts and
 * image attempts stay on the server; edits and redraws re-read the full row there.
 */
export function clientReceipt(generation: unknown): Json | null {
  if (!isRecord(generation)) return null;
  const concept = isRecord(generation.concept) ? generation.concept : null;
  const visual = concept && isRecord(concept.visual) ? concept.visual : null;
  const image = isRecord(generation.image) ? generation.image : null;
  return JSON.parse(JSON.stringify({
    // photoUrl lets the editor preview new words on the same background (#387).
    ...pick(generation, ["version", "format", "composition", "textModels", "design", "photoUrl"]),
    ...(image ? { image: pick(image, ["provider", "model", "fallbackFrom", "estimatedCostUsd"]) } : {}),
    ...(concept ? {
      concept: {
        ...pick(concept, ["headline", "description", "cta", "rationale", "supportingText"]),
        ...(visual ? { visual: pick(visual, ["textPlacement"]) } : {}),
      },
    } : {}),
  })) as Json;
}

export function clientCreative<T extends Pick<Creative, "generation">>(creative: T): T {
  return { ...creative, generation: clientReceipt(creative.generation) };
}
