import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("no db"); } }));
const { usageCostUsd } = await import("@/lib/llm/persist");

const usage = (promptTokens: number, completionTokens: number) => ({ promptTokens, completionTokens, totalTokens: promptTokens + completionTokens });
const base = { businessId: "b", userId: "u", route: "creatives.generate", provider: "openrouter" };

describe("usageCostUsd (#1468)", () => {
  it("sums the stored estimate per kind: recorded cost first, else the model's token rate", () => {
    expect(usageCostUsd([
      { ...base, model: "anthropic/claude-haiku-5.5", usage: usage(1_000_000, 1_000_000) },
      { ...base, model: "anthropic/claude-haiku-5.5", usage: usage(0, 0), estimatedCostUsd: 0.25 },
      { ...base, model: "openai/gpt-image-2.5-flare", usageKind: "image", usage: usage(0, 0), estimatedCostUsd: 0.04 },
    ] as never)).toEqual({ text: 0.85, image: 0.04 });
    expect(usageCostUsd([])).toEqual({ text: 0, image: 0 });
  });
});
