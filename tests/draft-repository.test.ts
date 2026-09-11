import { describe, expect, it, vi } from "vitest";
import { listEditableDrafts } from "@/lib/campaign/draft-repository";

describe("saved draft listing", () => {
  it("scopes owner/business and excludes drafts already submitted as operations", async () => {
    const businessId = "b123b123-b123-4123-8123-b123b123b123";
    const input = { businessId, name: "Saved", goal: "Leads", mode: "manual", creativeIds: [], dailyBudgetRupees: 100, leadFormId: null, targeting: {}, abTest: false };
    const unsentId = "d123d123-d123-4123-8123-d123d123d123";
    const submittedId = "e123e123-e123-4123-8123-e123e123e123";
    const drafts = [unsentId, submittedId].map((id) => ({ id, business_id: businessId, owner_id: "owner", version: 1, input, expires_at: "2099-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }));
    const query = { select: vi.fn(), eq: vi.fn(), gt: vi.fn(), order: vi.fn(), in: vi.fn() };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.gt.mockReturnValue(query);
    query.order.mockResolvedValue({ data: drafts, error: null });
    query.in.mockResolvedValue({ data: [{ draft_id: submittedId }], error: null });
    const supabase = { from: vi.fn(() => query) };
    const result = await listEditableDrafts(supabase as unknown as Parameters<typeof listEditableDrafts>[0], { businessId, userId: "owner" });
    expect(result.map((draft) => draft.draftId)).toEqual([unsentId]);
    expect(query.eq).toHaveBeenCalledWith("owner_id", "owner");
    expect(query.eq).toHaveBeenCalledWith("business_id", businessId);
  });
});