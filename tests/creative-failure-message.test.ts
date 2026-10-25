import { describe, expect, it } from "vitest";
import { creativeFailureMessage } from "@/lib/creative/failure-message";
import { AllLLMProvidersFailedError } from "@/lib/llm/types";
import { CreativeImageError } from "@/lib/creative/generate";

// #449: when paid AI credit runs out and the free models can't help either, say so plainly.
const GENERIC = "This creative could not be generated or saved. Check saved results before trying again.";

describe("creativeFailureMessage (#449)", () => {
  it("explains a text failure caused by exhausted credit", () => {
    expect(creativeFailureMessage(new AllLLMProvidersFailedError("CREDIT_EXHAUSTED", 1))).toMatch(/AI credit has run out/);
  });

  it("explains a picture failure after the paid image credit ran out", () => {
    const error = new CreativeImageError(new Error("busy"), [], [
      { provider: "openrouter-image", model: "x", status: "error", errorCode: "IMAGE_CREDIT_EXHAUSTED" },
      { provider: "pollinations", model: "flux", status: "error", errorCode: "IMAGE_FREE_BUSY" },
    ] as never);
    expect(creativeFailureMessage(error)).toMatch(/image credit has run out.*free image model is busy/i);
  });

  it("keeps the generic message otherwise", () => {
    expect(creativeFailureMessage(new AllLLMProvidersFailedError("RATE_LIMIT", 2))).toBe(GENERIC);
    expect(creativeFailureMessage(new Error("boom"))).toBe(GENERIC);
  });
});
