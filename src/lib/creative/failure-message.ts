import { AllLLMProvidersFailedError, NoLLMKeysError } from "@/lib/llm/types";
import { CreativeImageError, CreativeValidationError } from "./generate";
import { CreativeSaveError } from "./save";
import { ReferencePhotoPausedError } from "@/lib/imageGen/types";

const GENERIC_CREATIVE_FAILURE = "This creative could not be generated or saved. Check saved results before trying again.";

/** #449: the owner-facing reason one ad failed in Create; honest when paid AI credit ran out. */
export function creativeFailureMessage(error: unknown): string {
  if (error instanceof AllLLMProvidersFailedError && error.reason === "CREDIT_EXHAUSTED") {
    return "AdBrain's paid AI credit has run out and no free model could write this ad. Try again in a few minutes; AdBrain has been told.";
  }
  if (error instanceof CreativeImageError && error.cause instanceof ReferencePhotoPausedError && error.cause.reason === "allowance") {
    return "Your product photo needs our paid pictures, and this month's AI allowance is used. Ads without the product photo still work.";
  }
  if (error instanceof CreativeImageError && error.cause instanceof ReferencePhotoPausedError) {
    // #2222: the pause lasts until the credit is topped up, so no retry time; with a product photo the ad uses it as is.
    return "This ad needs our paid pictures to draw your product, and they're paused right now. Add a photo of your product in Brand and AdBrain uses it in the ad as it is.";
  }
  if (error instanceof CreativeImageError && error.imageAttempts.some((attempt) => attempt.errorCode === "IMAGE_CREDIT_EXHAUSTED")) {
    return "This picture couldn't be made: AdBrain's paid image credit has run out and the free image model is busy. Try again in a few minutes.";
  }
  return GENERIC_CREATIVE_FAILURE;
}

export const creativeFailureStages = ["text", "picture", "provider", "save", "timeout", "other"] as const;
export type CreativeFailureStage = (typeof creativeFailureStages)[number];

/** #2515: the step that lost an ad, so `creative.batch` tells text, picture, provider and save losses apart. */
export function creativeFailureStage(error: unknown): CreativeFailureStage {
  if (error instanceof CreativeValidationError) return error.stage === "provider" ? "provider" : "text";
  if (error instanceof AllLLMProvidersFailedError || error instanceof NoLLMKeysError) return "provider";
  if (error instanceof CreativeImageError) return "picture";
  if (error instanceof CreativeSaveError) return "save";
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return "timeout";
  return "other";
}
