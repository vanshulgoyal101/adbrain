import { afterEach, describe, expect, it, vi } from "vitest";
import { monthlyTokenUsage, persistLLMUsage } from "@/lib/llm/persist";
import {
  recordUsage,
  resetUsage,
  usageSnapshot,
} from "@/lib/llm/usage";
import type { CompletionResult } from "@/lib/llm/types";

function result(
  over: Partial<CompletionResult> = {},
): CompletionResult {
  return {
    text: "x",
    provider: "google",
    model: "gemini",
    usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
    ...over,
  };
}

const { rpc, insert, abortSignal, browserFrom, adminFrom, recordProductEvent } = vi.hoisted(() => ({
  rpc: vi.fn(), insert: vi.fn(), abortSignal: vi.fn(), browserFrom: vi.fn(), adminFrom: vi.fn(), recordProductEvent: vi.fn(),
}));
vi.mock("@/lib/observability/logger", () => ({ recordProductEvent }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from: browserFrom }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: adminFrom }) }));

afterEach(() => {
  resetUsage();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe("persistent quota accounting", () => {
  it("reads the owner-scoped aggregate instead of a row-limited event list", async () => {
    rpc.mockResolvedValue({ data: 2200, error: null });
    expect(await monthlyTokenUsage("owned-business")).toBe(2200);
    expect(rpc).toHaveBeenCalledWith("monthly_token_usage", {
      p_business_id: "owned-business", p_since: expect.any(String),
    });
    expect(browserFrom).not.toHaveBeenCalled();
  });

  it.each([null, -1, "2200", Number.MAX_SAFE_INTEGER + 1])("rejects invalid aggregate %j", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    expect(await monthlyTokenUsage("owned-business")).toBeNull();
  });

  it("writes generated usage only through the trusted server client", async () => {
    adminFrom.mockReturnValue({ insert });
    insert.mockReturnValue({ abortSignal });
    abortSignal.mockResolvedValue({ error: null });
    expect(await persistLLMUsage([{
      businessId: "owned-business", userId: "owner", route: "test", provider: "test",
      model: "test", usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 }, requestId: "request",
    }])).toBe(true);
    expect(adminFrom).toHaveBeenCalledWith("llm_usage_events");
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({ business_id: "owned-business", total_tokens: 14 })]);
    expect(browserFrom).not.toHaveBeenCalled();
  });

  it("stores provider evidence without replacing the internal generation identity", async () => {
    adminFrom.mockReturnValue({ insert });
    insert.mockReturnValue({ abortSignal });
    abortSignal.mockResolvedValue({ error: null });
    expect(await persistLLMUsage([{
      businessId: "owned-business", userId: "owner", route: "creatives.generate",
      provider: "openrouter-image", model: "image-model", usageKind: "image",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      requestId: "internal-request", generationId: "generation-456", providerRequestId: "provider-image-123",
      providerFinalStatus: "unknown", status: "error", metadata: { angle: "local" },
    }])).toBe(true);
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({
      request_id: "internal-request", status: "error", total_tokens: 0,
      metadata: { angle: "local", generationId: "generation-456", providerRequestId: "provider-image-123", providerFinalStatus: "unknown" },
    })]);
  });

  it("links a later change's AI calls to the ad they changed (#451)", async () => {
    adminFrom.mockReturnValue({ insert });
    insert.mockReturnValue({ abortSignal });
    abortSignal.mockResolvedValue({ error: null });
    await persistLLMUsage([{
      businessId: "owned-business", userId: "owner", route: "creatives.regenerate", provider: "openrouter", model: "haiku",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }, requestId: "regenerate-request", creativeId: "creative-789",
    }]);
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({
      request_id: "regenerate-request", metadata: expect.objectContaining({ creativeId: "creative-789" }),
    })]);
  });

  it("estimates Claude Haiku 5.5 at its OpenRouter list price, so receipts aren't 10x high (#451)", async () => {
    adminFrom.mockReturnValue({ insert });
    insert.mockReturnValue({ abortSignal });
    abortSignal.mockResolvedValue({ error: null });
    await persistLLMUsage([{
      businessId: "owned-business", userId: "owner", route: "creatives.generate", provider: "openrouter", model: "anthropic/claude-haiku-5.5",
      usage: { promptTokens: 4_000, completionTokens: 1_000, totalTokens: 5_000 }, requestId: "generate-request",
    }]);
    // $0.10 and $0.50 per million tokens (openrouter.ai/api/v1/models, Oct 24).
    expect(insert.mock.calls.at(-1)![0][0].estimated_cost_usd).toBeCloseTo(0.0009, 6);
  });

  it("records the sanitized provider failure class for failed attempts", async () => {
    adminFrom.mockReturnValue({ insert });
    insert.mockReturnValue({ abortSignal });
    abortSignal.mockResolvedValue({ error: null });
    await persistLLMUsage([{
      businessId: "owned-business", userId: "owner", route: "creatives.generate", provider: "openrouter",
      model: "m", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, requestId: "request",
      status: "error", errorCode: "CreativeValidationError", failure: "HTTP_402",
    }]);
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({
      error_code: "CreativeValidationError", metadata: expect.objectContaining({ failure: "HTTP_402" }),
    })]);
    expect(recordProductEvent).toHaveBeenCalledWith(expect.objectContaining({
      name: "ai.completion", outcome: "failed", attributes: expect.objectContaining({ errorCode: "LLM_HTTP_402" }),
    }));
  });

  it("puts a rejected attempt's rule names on its ai.completion event (#378)", async () => {
    adminFrom.mockReturnValue({ insert });
    insert.mockReturnValue({ abortSignal });
    abortSignal.mockResolvedValue({ error: null });
    await persistLLMUsage([{
      businessId: "owned-business", userId: "owner", route: "creatives.assistant", provider: "groq",
      model: "qwen/qwen3.8-27b", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, requestId: "request",
      status: "error", errorCode: "INTERVIEW_VALIDATION", metadata: { validationRules: ["unsupported-commercial-claim", "repeated-question"] },
    }]);
    expect(recordProductEvent).toHaveBeenCalledWith(expect.objectContaining({
      name: "ai.completion", outcome: "failed",
      attributes: expect.objectContaining({ errorCode: "INTERVIEW_VALIDATION", validationRules: ["unsupported-commercial-claim", "repeated-question"] }),
    }));
  });

  it("bounds best-effort ledger writes without failing the completed operation", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    adminFrom.mockReturnValue({ insert });
    insert.mockReturnValue({ abortSignal });
    abortSignal.mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
    await expect(persistLLMUsage([{
      businessId: "owned-business", userId: "owner", route: "test", provider: "test",
      model: "test", usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 }, requestId: "request",
    }])).resolves.toBe(false);
    expect(timeout).toHaveBeenCalledWith(3_000);
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
});

describe("usage accounting", () => {
  it("aggregates token counts overall and per provider", () => {
    recordUsage(result());
    recordUsage(result({ provider: "groq" }));
    const snap = usageSnapshot();
    expect(snap.overall.calls).toBe(2);
    expect(snap.overall.totalTokens).toBe(28);
    expect(snap.byProvider.google.totalTokens).toBe(14);
    expect(snap.byProvider.groq.totalTokens).toBe(14);
  });

  it("counts cache hits as saved tokens, not spend", () => {
    recordUsage(result());
    recordUsage(result({ cached: true }));
    const snap = usageSnapshot();
    expect(snap.overall.calls).toBe(1);
    expect(snap.overall.cacheHits).toBe(1);
    expect(snap.overall.totalTokens).toBe(14);
    expect(snap.overall.savedTokens).toBe(14);
  });

  it("tolerates results without usage metadata", () => {
    recordUsage(result({ usage: undefined }));
    const snap = usageSnapshot();
    expect(snap.overall.calls).toBe(1);
    expect(snap.overall.totalTokens).toBe(0);
  });

  it("resets all counters", () => {
    recordUsage(result());
    resetUsage();
    expect(usageSnapshot().overall.calls).toBe(0);
  });
});
