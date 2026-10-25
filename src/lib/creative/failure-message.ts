import { AllLLMProvidersFailedError } from "@/lib/llm/types";
import { CreativeImageError } from "./generate";

export const GENERIC_CREATIVE_FAILURE = "This creative could not be generated or saved. Check saved results before trying again.";

/** #449: the owner-facing reason one ad failed in Create; honest when paid AI credit ran out. */
export function creativeFailureMessage(error: unknown): string {
  if (error instanceof AllLLMProvidersFailedError && error.reason === "CREDIT_EXHAUSTED") {
    return "AdBrain's paid AI credit has run out and no free model could write this ad. Try again in a few minutes; AdBrain has been told.";
  }
  if (error instanceof CreativeImageError && error.imageAttempts.some((attempt) => attempt.errorCode === "IMAGE_CREDIT_EXHAUSTED")) {
    return "This picture couldn't be made: AdBrain's paid image credit has run out and the free image model is busy. Try again in a few minutes.";
  }
  return GENERIC_CREATIVE_FAILURE;
}
