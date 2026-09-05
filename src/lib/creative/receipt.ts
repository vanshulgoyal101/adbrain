import type { GeneratedVariant } from "./generate";
import { CreativeValidationError, CreativeImageError } from "./generate";
import { CONCEPT_VERSION } from "./concept";
import type { Json } from "@/lib/types";
import { getEnv } from "@/lib/env";
import type { LLMUsageEvent } from "@/lib/llm/persist";
import { z } from "zod";

export function savedGenerationSettings(value: unknown) {
  return z
    .object({
      format: z
        .enum(["portrait", "square", "story", "landscape"])
        .default("portrait"),
      language: z.string().nullable().optional(),
    })
    .catch({ format: "portrait" })
    .parse(value);
}

export function generationReceipt(
  variant: GeneratedVariant,
  language?: string,
  referenceImages: string[] = [],
): Json {
  return JSON.parse(
    JSON.stringify({
      version: CONCEPT_VERSION,
      concept: variant.concept,
      imagePrompt: variant.imagePrompt,
      format: variant.design.format,
      language: language ?? null,
      referenceImages,
      composition: getEnv().AD_DESIGN_OVERLAY ? "overlay" : "image-only",
      textModels: variant.llmUsage.map(({ provider, model }) => ({
        provider,
        model,
      })),
      image: {
        ...variant.imageUsage,
        estimatedCostUsd: variant.imageUsage.estimatedCostUsd ?? null,
      },
    }),
  ) as Json;
}

export function variantUsageEvents(
  variant: GeneratedVariant,
  context: Pick<LLMUsageEvent, "businessId" | "userId" | "route" | "requestId">,
): LLMUsageEvent[] {
  return [
    ...variant.llmUsage.map((entry, index) => ({
      ...context,
      ...entry,
      promptVersion: CONCEPT_VERSION,
      attempt: index + 1,
      metadata: { angle: variant.angleId },
    })),
    {
      ...context,
      provider: variant.imageUsage.provider,
      model: variant.imageUsage.model,
      usageKind: "image",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      estimatedCostUsd: variant.imageUsage.estimatedCostUsd,
      latencyMs: variant.imageUsage.latencyMs,
      imageWidth: variant.imageUsage.width,
      imageHeight: variant.imageUsage.height,
      status: variant.imageUsage.fallbackFrom ? "fallback" : "success",
      promptVersion: CONCEPT_VERSION,
      metadata: {
        angle: variant.angleId,
        costKnown: variant.imageUsage.estimatedCostUsd !== undefined,
        fallbackFrom: variant.imageUsage.fallbackFrom ?? null,
      },
    },
  ];
}

export function failedVariantUsage(
  error: unknown,
  context: Pick<LLMUsageEvent, "businessId" | "userId" | "route" | "requestId">,
): LLMUsageEvent[] {
  if (
    !(error instanceof CreativeValidationError) &&
    !(error instanceof CreativeImageError)
  )
    return [];
  return error.usage.map((entry, index) => ({
    ...context,
    ...entry,
    promptVersion: CONCEPT_VERSION,
    attempt: index + 1,
    status: "error",
    errorCode: error.name,
  }));
}
