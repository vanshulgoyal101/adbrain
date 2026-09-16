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

const { rpc, insert, browserFrom, adminFrom } = vi.hoisted(() => ({
  rpc: vi.fn(), insert: vi.fn(), browserFrom: vi.fn(), adminFrom: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from: browserFrom }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: adminFrom }) }));

afterEach(() => {
  resetUsage();
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
    insert.mockResolvedValue({ error: null });
    await persistLLMUsage([{
      businessId: "owned-business", userId: "owner", route: "test", provider: "test",
      model: "test", usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 }, requestId: "request",
    }]);
    expect(adminFrom).toHaveBeenCalledWith("llm_usage_events");
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({ business_id: "owned-business", total_tokens: 14 })]);
    expect(browserFrom).not.toHaveBeenCalled();
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
