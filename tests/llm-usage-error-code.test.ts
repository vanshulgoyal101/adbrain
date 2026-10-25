import { describe, expect, it } from "vitest";
import { CreativeValidationError } from "@/lib/creative/generate";
import { failedVariantUsage } from "@/lib/creative/receipt";
import { usageErrorCode } from "@/lib/llm/persist";

const context = { businessId: "b", userId: "u", route: "creatives.regenerate", requestId: "r" } as const;
const attempt = (provider: string, failure: string) => ({ provider, model: `${provider}-model`, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, status: "error" as const, failure });

describe("usage rows keep the provider's own failure (#614)", () => {
  it("records rate limits and refusals as LLM_HTTP_*, not CreativeValidationError", () => {
    // Production, Oct 24 12:10Z: openrouter 403 > google 429 ×4 > groq 429 ×4, all wrapped in one CreativeValidationError.
    const usage = [attempt("openrouter", "HTTP_403"), ...Array(4).fill(attempt("google", "HTTP_429")), ...Array(4).fill(attempt("groq", "HTTP_429"))];
    const error = new CreativeValidationError(["Provider attempt could not be confirmed"], usage as never, "provider");
    const codes = failedVariantUsage(error, context).map(usageErrorCode);
    expect(codes).toEqual(["LLM_HTTP_403", ...Array(4).fill("LLM_HTTP_429"), ...Array(4).fill("LLM_HTTP_429")]);
  });

  it("still records a real validation failure as CreativeValidationError", () => {
    const usage = [{ provider: "groq", model: "m", usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }, status: "success" as const }];
    const error = new CreativeValidationError(["Headline is too long"], usage as never, "concept");
    expect(failedVariantUsage(error, context).map(usageErrorCode)).toEqual(["CreativeValidationError"]);
  });

  it("prefers the provider failure, then the caller's code, else none", () => {
    expect(usageErrorCode({ failure: "TIMEOUT", errorCode: "CreativeValidationError" })).toBe("LLM_TIMEOUT");
    expect(usageErrorCode({ errorCode: "PLAN_X" })).toBe("PLAN_X");
    expect(usageErrorCode({})).toBeNull();
  });
});
