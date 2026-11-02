import { describe, expect, it } from "vitest";
import { creativeFailureMessage, creativeFailureStage } from "@/lib/creative/failure-message";
import { AllLLMProvidersFailedError, NoLLMKeysError } from "@/lib/llm/types";
import { CreativeImageError, CreativeValidationError } from "@/lib/creative/generate";
import { CreativeSaveError } from "@/lib/creative/save";
import { ReferencePhotoPausedError } from "@/lib/imageGen/types";

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

  it("#1593: says the product photo needs the paused paid pictures, not that the free model is busy", () => {
    const error = new CreativeImageError(new ReferencePhotoPausedError(), [], [
      { provider: "openrouter-image", model: "x", status: "error", errorCode: "IMAGE_CREDIT_EXHAUSTED" },
    ] as never);
    expect(creativeFailureMessage(error)).toBe("This ad needs our paid pictures to draw your product, and they're paused right now. Add a photo of your product in Brand and AdBrain uses it in the ad as it is.");
  });

  it("keeps the generic message otherwise", () => {
    expect(creativeFailureMessage(new AllLLMProvidersFailedError("RATE_LIMIT", 2))).toBe(GENERIC);
    expect(creativeFailureMessage(new Error("boom"))).toBe(GENERIC);
  });
});

describe("creativeFailureStage (#2515)", () => {
  it("names the step that lost each ad", () => {
    expect(creativeFailureStage(new CreativeValidationError(["no subject"], [], "concept"))).toBe("text");
    expect(creativeFailureStage(new CreativeValidationError(["bad json"], [], "parse"))).toBe("text");
    expect(creativeFailureStage(new CreativeValidationError(["down"], [], "provider"))).toBe("provider");
    expect(creativeFailureStage(new AllLLMProvidersFailedError("RATE_LIMIT", 3))).toBe("provider");
    expect(creativeFailureStage(new NoLLMKeysError())).toBe("provider");
    expect(creativeFailureStage(new CreativeImageError(new Error("busy"), []))).toBe("picture");
    expect(creativeFailureStage(new CreativeSaveError("08006"))).toBe("save");
    expect(creativeFailureStage(new DOMException("t", "TimeoutError"))).toBe("timeout");
    expect(creativeFailureStage(new DOMException("a", "AbortError"))).toBe("timeout");
    expect(creativeFailureStage(new Error("?"))).toBe("other");
    expect(creativeFailureStage("?")).toBe("other");
  });
});
