import { describe, expect, it } from "vitest";
import { CreativeImageError, CreativeValidationError } from "@/lib/creative/generate";
import { failedVariantUsage } from "@/lib/creative/receipt";

// #687: a failed ad's usage rows name the step that failed. Copy that passed our checks is not an error
// because its image failed (production Oct 24-25: 7 successful text rows logged as CreativeImageError).
const context = { businessId: "b", userId: "u", route: "creatives.generate", requestId: "r", generationId: "g" };
const tokens = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
const text = (extra: Record<string, unknown> = {}) => ({ provider: "openrouter", model: "anthropic/claude-haiku-5.5", usage: tokens,
  providerFinalStatus: "completed" as const, status: "success" as const, ...extra });

describe("failedVariantUsage error codes (#687)", () => {
  it("leaves copy that passed without an error code when only the image failed", () => {
    const error = new CreativeImageError(new Error("404"), [
      text({ validation: { stage: "concept", rules: ["sourceQuotes"] } }),
      text(),
    ], [{ provider: "pollinations", model: "pollinations", status: "error", providerFinalStatus: "unknown", errorCode: "IMAGE_HTTP_404" }]);
    const rows = failedVariantUsage(error, context);
    expect(rows.map((row) => [row.usageKind ?? "text", row.status, row.errorCode])).toEqual([
      ["text", "success", undefined],
      ["text", "success", undefined],
      ["image", "error", "IMAGE_HTTP_404"],
    ]);
    // The repaired first attempt still says which rule it broke.
    expect(rows[0].metadata).toMatchObject({ validationRules: ["sourceQuotes"] });
  });

  it("keeps a provider failure's own code and a rule failure's CreativeValidationError", () => {
    const providerFailure = failedVariantUsage(new CreativeValidationError(["Provider attempt could not be confirmed"], [
      text({ status: "error", failure: "HTTP_429", validation: { stage: "provider", rules: ["other"] } }),
    ], "provider"), context);
    expect(providerFailure.map((row) => row.errorCode)).toEqual(["LLM_HTTP_429"]);

    const ruleFailure = failedVariantUsage(new CreativeValidationError(["unsupported-commercial-claim"], [
      text({ validation: { stage: "concept", rules: ["unsupported-commercial-claim"] } }),
      text({ validation: { stage: "concept", rules: ["unsupported-commercial-claim"] } }),
    ]), context);
    expect(ruleFailure.map((row) => row.errorCode)).toEqual(["CreativeValidationError", "CreativeValidationError"]);
  });
});
