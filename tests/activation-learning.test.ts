import { beforeEach, describe, expect, it, vi } from "vitest";

// #419 item 2: what the activation review reads to warn about edits that restart Meta's learning.
const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ action: string; created_at: string }>,
  error: null as unknown,
  calls: [] as unknown[][],
  cost: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      mocks.calls.push(["from", table]);
      const query = {
        select: (...args: unknown[]) => (mocks.calls.push(["select", ...args]), query),
        eq: (...args: unknown[]) => (mocks.calls.push(["eq", ...args]), query),
        in: (...args: unknown[]) => (mocks.calls.push(["in", ...args]), query),
        order: (...args: unknown[]) => (mocks.calls.push(["order", ...args]), query),
        limit: async (n: number) => (mocks.calls.push(["limit", n]), { data: mocks.rows, error: mocks.error }),
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/campaign/result-evidence-store", () => ({ getCostPerResult: mocks.cost }));

const paused = { id: "campaign-1", business_id: "business-1", status: "paused", destination: "whatsapp" };

beforeEach(() => {
  mocks.rows = [];
  mocks.error = null;
  mocks.calls = [];
  mocks.cost.mockReset().mockResolvedValue(10.69);
});

describe("getActivationLearning (#419 item 2)", () => {
  it("returns the business's cost per result and when AdBrain last paused this campaign, through the owner's session", async () => {
    mocks.rows = [{ action: "campaign.pause", created_at: "2026-10-15T09:00:00Z" }];
    const { getActivationLearning } = await import("@/lib/campaign/activation-learning");
    expect(await getActivationLearning(paused)).toEqual({ costPerResultRupees: 10.69, pausedAt: "2026-10-15T09:00:00Z" });
    expect(mocks.cost).toHaveBeenCalledWith("business-1", "whatsapp");
    expect(mocks.calls).toEqual([
      ["from", "audit_log"], ["select", "action, created_at"],
      ["eq", "business_id", "business-1"], ["eq", "entity_type", "campaign"], ["eq", "entity_id", "campaign-1"],
      ["in", "action", ["campaign.pause", "campaign.resume"]], ["order", "created_at", { ascending: false }], ["limit", 1],
    ]);
  });

  it("has no pause time when the latest AdBrain action was a resume, or the campaign isn't paused", async () => {
    mocks.rows = [{ action: "campaign.resume", created_at: "2026-10-15T09:00:00Z" }];
    const { getActivationLearning } = await import("@/lib/campaign/activation-learning");
    expect((await getActivationLearning(paused)).pausedAt).toBeNull();
    mocks.rows = [{ action: "campaign.pause", created_at: "2026-10-15T09:00:00Z" }];
    mocks.calls = [];
    expect((await getActivationLearning({ ...paused, status: "active" })).pausedAt).toBeNull();
    expect(mocks.calls).toEqual([]);
  });

  it("fails soft: a read error means no warning, never a broken review", async () => {
    mocks.error = { message: "permission denied" };
    mocks.cost.mockRejectedValue(new Error("results unavailable"));
    const { getActivationLearning } = await import("@/lib/campaign/activation-learning");
    expect(await getActivationLearning(paused)).toEqual({ costPerResultRupees: null, pausedAt: null });
  });

  it("skips the cost lookup for a campaign whose kind isn't known", async () => {
    const { getActivationLearning } = await import("@/lib/campaign/activation-learning");
    expect((await getActivationLearning({ ...paused, destination: null })).costPerResultRupees).toBeNull();
    expect(mocks.cost).not.toHaveBeenCalled();
  });
});
