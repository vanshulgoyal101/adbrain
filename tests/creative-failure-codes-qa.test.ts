import { describe, expect, it } from "vitest";
import { CreativeValidationError } from "@/lib/creative/generate";
import { failedVariantUsage } from "@/lib/creative/receipt";

// QA red test for #614, from production (Oct 24 12:10Z, one regenerate request): OpenRouter answered
// 403, Gemini 429 ×4, Groq 429 ×4, and every attempt was stored with error_code
// "CreativeValidationError". A provider failure must be recorded as the provider failure
// (LLM_HTTP_429, like campaigns.plan and creatives.assistant), so it isn't read as "our validator is wrong".
const zero = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
const context = { businessId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", route: "creatives.regenerate", requestId: "82520c9f-f37f-4582-95e3-fe67a0c712d9" };

describe("QA #614: failed creative attempts keep their real cause", () => {
  it("records provider 403/429 attempts as LLM_HTTP_403/LLM_HTTP_429, not CreativeValidationError", () => {
    const recorded = new CreativeValidationError(["Provider attempt could not be confirmed"], [
      { provider: "openrouter", model: "anthropic/claude-haiku-5.5", usage: zero, status: "error", failure: "HTTP_403", providerFinalStatus: "unknown" },
      { provider: "google", model: "gemini-3.6-flash", usage: zero, status: "error", failure: "HTTP_429", providerFinalStatus: "unknown" },
      { provider: "groq", model: "qwen/qwen3.8-27b", usage: zero, status: "error", failure: "HTTP_429", providerFinalStatus: "unknown",
        validation: { stage: "provider", rules: ["other"] } },
    ], "provider");
    const events = failedVariantUsage(recorded, context);
    expect(events.map((event) => [event.provider, event.errorCode])).toEqual([
      ["openrouter", "LLM_HTTP_403"], ["google", "LLM_HTTP_429"], ["groq", "LLM_HTTP_429"],
    ]);
  });

  it("still records a reply that failed our concept checks as CreativeValidationError", () => {
    const rejected = new CreativeValidationError(["Headline is too long"], [
      { provider: "groq", model: "qwen/qwen3.8-27b", usage: { promptTokens: 900, completionTokens: 300, totalTokens: 1200 }, status: "success",
        providerFinalStatus: "completed", validation: { stage: "concept", rules: ["headline-length"] } },
    ], "concept");
    expect(failedVariantUsage(rejected, context).map((event) => event.errorCode)).toEqual(["CreativeValidationError"]);
  });
});
