import { buildAdDesign } from "@/lib/creative/design";
import type { ConceptInput, CreativeConcept } from "@/lib/creative/concept";
import { FreeImageBusyError, type ImageAttempt } from "@/lib/imageGen/types";
import type { GeneratedVariant } from "./generate";

export const BATCH_REUSE = "batch_reuse";

/** The fields of generate's CreativeImageError (imported as a value it would be a cycle). */
type ImageFailure = { cause?: unknown; usage: GeneratedVariant["llmUsage"]; imageAttempts: ImageAttempt[]; concept: CreativeConcept };

/** #2378: only a free picture that busied out (the queue parked, #2153) borrows a sibling's; credit, paused-photo and abort errors don't. */
export function freeBusyFailure(error: unknown): error is ImageFailure {
  const failure = error as Partial<ImageFailure> | undefined;
  return failure?.cause instanceof FreeImageBusyError && !!failure.concept && Array.isArray(failure.imageAttempts) && Array.isArray(failure.usage);
}

/**
 * Tracks each ad's own picture in a batch. Every ad settles its slot once its picture is made or has failed (never on
 * a borrowed one), so ads that busied out wait for the others without waiting on each other.
 */
export function batchPictures(size: number) {
  const settle: ((variant?: GeneratedVariant) => void)[] = [];
  const slots = Array.from({ length: size }, (_, index) =>
    new Promise<GeneratedVariant | undefined>((resolve) => { settle[index] = resolve; }));
  let borrowed = 0;
  const sibling = async (index: number) => {
    const made = (await Promise.all(slots.filter((_, other) => other !== index))).filter((v): v is GeneratedVariant => !!v);
    // A second borrower takes a different picture when there are two (CTO, #2378).
    return made.length ? made[borrowed++ % made.length] : undefined;
  };
  return {
    settle<T extends GeneratedVariant | undefined = undefined>(index: number, variant?: T): T {
      settle[index](variant);
      return variant as T;
    },
    /** Settles this ad's slot as failed, then reuses a sibling's picture on a free-busy failure; otherwise rethrows. */
    async borrow(index: number, input: ConceptInput, error: unknown, signal?: AbortSignal): Promise<GeneratedVariant> {
      settle[index]();
      if (!freeBusyFailure(error)) throw error;
      const picture = await sibling(index);
      if (!picture || signal?.aborted) throw error;
      return reuseSiblingPicture(input, error, picture);
    },
  };
}

/** This ad's own concept and copy over a sibling's picture: no new image call, $0, marked `batch_reuse`. */
export function reuseSiblingPicture(input: ConceptInput, failure: ImageFailure, sibling: GeneratedVariant): GeneratedVariant {
  const { concept } = failure;
  return {
    concept,
    angleId: input.angle.id,
    angleName: input.angle.name,
    headline: concept.headline,
    primaryText: concept.primary_text,
    cta: concept.cta,
    imageUrl: sibling.imageUrl,
    imagePrompt: sibling.imagePrompt,
    design: buildAdDesign({
      brand: input.brand, copy: concept, concept, angle: input.angle, backgroundUrl: sibling.imageUrl,
      format: input.format, language: input.language,
    }),
    llmUsage: failure.usage,
    imageUsage: {
      provider: sibling.imageUsage.provider,
      model: sibling.imageUsage.model,
      estimatedCostUsd: 0,
      width: sibling.imageUsage.width,
      height: sibling.imageUsage.height,
      fallbackFrom: BATCH_REUSE,
    },
    imageAttempts: failure.imageAttempts,
    ...(sibling.ownerPhotoUrl ? { ownerPhotoUrl: sibling.ownerPhotoUrl } : {}),
  };
}
