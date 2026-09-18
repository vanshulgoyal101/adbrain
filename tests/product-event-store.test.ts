import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistProductEvents } from "@/lib/observability/store";
import type { ProductEvent } from "@/lib/observability/events";

const mocks = vi.hoisted(() => ({ insert: vi.fn(), abortSignal: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ insert: mocks.insert }) }) }));
beforeEach(() => { vi.clearAllMocks(); mocks.insert.mockReturnValue({ abortSignal: mocks.abortSignal }); mocks.abortSignal.mockResolvedValue({ error: null }); });
const event: ProductEvent = {
  version: 1, eventId: "11111111-1111-4111-8111-111111111111", requestId: "22222222-2222-4222-8222-222222222222",
  occurredAt: "2026-09-18T10:00:00.000Z", kind: "request", name: "http.request", outcome: "success", userId: null, businessId: null, attributes: { status: 200 },
};

describe("product event persistence", () => {
  it("maps bounded events to the trusted table with a deadline", async () => {
    await persistProductEvents([event]);
    expect(mocks.insert).toHaveBeenCalledWith([expect.objectContaining({ event_id: event.eventId, request_id: event.requestId, user_id: null, attributes: { status: 200 } })]);
    expect(mocks.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
  it("reports resolved database errors without provider details", async () => {
    mocks.abortSignal.mockResolvedValue({ error: { message: "private database detail" } });
    await expect(persistProductEvents([event])).rejects.toThrow("Product events could not be persisted.");
  });
  it("does no work for empty batches", async () => {
    await persistProductEvents([]);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});