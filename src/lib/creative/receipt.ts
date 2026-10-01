import type { GeneratedVariant } from "./generate";
import { CreativeValidationError, CreativeImageError } from "./generate";
import { CONCEPT_VERSION, conceptValidationRules } from "./concept";
import type { Json } from "@/lib/types";
import { getEnv } from "@/lib/env";
import type { LLMUsageEvent } from "@/lib/llm/persist";
import type { ImageAttempt } from "@/lib/imageGen/types";
import { z } from "zod";

export function savedGenerationSettings(value: unknown) {
  return z
    .object({
      format: z
        .enum(["portrait", "square", "story", "landscape"])
        .default("portrait"),
      language: z.string().nullable().optional(),
      sourceFacts: z.array(z.string().max(2000)).max(12).default([]),
    })
    .catch({ format: "portrait", sourceFacts: [] })
    .parse(value);
}

export function generationReceipt(
  variant: GeneratedVariant,
  language?: string,
  referenceImages: string[] = [],
  sourceFacts: string[] = [],
): Json {
  return JSON.parse(
    JSON.stringify({
      version: CONCEPT_VERSION,
      concept: variant.concept,
      imagePrompt: variant.imagePrompt,
      format: variant.design.format,
      language: language ?? null,
      referenceImages,
      sourceFacts,
      composition: getEnv().AD_DESIGN_OVERLAY ? "overlay" : "image-only",
      textModels: variant.llmUsage.map(({ provider, model }) => ({
        provider,
        model,
      })),
      image: {
        ...variant.imageUsage,
        estimatedCostUsd: variant.imageUsage.estimatedCostUsd ?? null,
      },
      imageAttempts: variant.imageAttempts ?? [],
    }),
  ) as Json;
}

export function variantUsageEvents(
  variant: GeneratedVariant,
  context: Pick<LLMUsageEvent, "businessId" | "userId" | "route" | "requestId"> & Pick<LLMUsageEvent, "generationId">,
): LLMUsageEvent[] {
  return [
    ...variant.llmUsage.map(({ validation, ...entry }, index) => ({
      ...context,
      ...entry,
      promptVersion: CONCEPT_VERSION,
      attempt: index + 1,
      status: entry.status ?? "success",
      metadata: { angle: variant.angleId, ...(validation ? {
        validationStage: validation.stage, validationRules: validation.rules,
      } : {}) },
    })),
    ...(variant.imageAttempts?.length ? variant.imageAttempts.map((entry, index) => imageAttemptUsage(
      entry, context, index + 1, variant.angleId,
      index === variant.imageAttempts!.length - 1 && entry.status === "success" ? variant.imageUsage : undefined,
    )) : [{
      ...context,
      provider: variant.imageUsage.provider,
      model: variant.imageUsage.model,
      usageKind: "image" as const,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      estimatedCostUsd: variant.imageUsage.estimatedCostUsd,
      latencyMs: variant.imageUsage.latencyMs,
      imageWidth: variant.imageUsage.width,
      imageHeight: variant.imageUsage.height,
      status: variant.imageUsage.fallbackFrom ? "fallback" as const : "success" as const,
      providerRequestId: variant.imageUsage.providerRequestId,
      providerFinalStatus: variant.imageUsage.providerFinalStatus,
      promptVersion: CONCEPT_VERSION,
      metadata: {
        angle: variant.angleId,
        costKnown: variant.imageUsage.estimatedCostUsd !== undefined,
        fallbackFrom: variant.imageUsage.fallbackFrom ?? null,
      },
    }]),
  ];
}

function imageAttemptUsage(
  entry: ImageAttempt,
  context: Pick<LLMUsageEvent, "businessId" | "userId" | "route" | "requestId"> & Pick<LLMUsageEvent, "generationId">,
  attempt: number,
  angle?: string,
  completedImage?: GeneratedVariant["imageUsage"],
): LLMUsageEvent {
  return {
    ...context, ...entry, attempt,
    usageKind: "image",
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    promptVersion: CONCEPT_VERSION,
    status: completedImage?.fallbackFrom ? "fallback" : entry.status,
    imageWidth: completedImage?.width,
    imageHeight: completedImage?.height,
    latencyMs: completedImage?.latencyMs,
    metadata: { ...(angle ? { angle } : {}), costKnown: entry.estimatedCostUsd !== undefined,
      ...(completedImage?.fallbackFrom ? { fallbackFrom: completedImage.fallbackFrom } : {}) },
  };
}

export function failedVariantUsage(
  error: unknown,
  context: Pick<LLMUsageEvent, "businessId" | "userId" | "route" | "requestId"> & Pick<LLMUsageEvent, "generationId">,
): LLMUsageEvent[] {
  if (
    !(error instanceof CreativeValidationError) &&
    !(error instanceof CreativeImageError)
  )
    return [];
  const metadata = error instanceof CreativeValidationError ? {
    validationStage: error.stage,
    validationRules: conceptValidationRules(error.issues),
  } : undefined;
  const textEvents = error.usage.map(({ validation, ...entry }, index) => ({
    ...context,
    ...entry,
    promptVersion: CONCEPT_VERSION,
    attempt: index + 1,
    status: entry.status ?? "error",
    errorCode: error.name,
    ...(validation ? { metadata: { validationStage: validation.stage, validationRules: validation.rules } }
      : metadata && index === error.usage.length - 1 ? { metadata } : {}),
  }));
  return error instanceof CreativeImageError
    ? [...textEvents, ...error.imageAttempts.map((entry, index) => imageAttemptUsage(entry, context, index + 1))]
    : textEvents;
}
