import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null, record: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user } }) } }) }));
vi.mock("@/lib/supabase/queries", () => ({ getPrimaryBusiness: async () => ({ id: "22222222-2222-4222-8222-222222222222" }) }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: mocks.limit }));
vi.mock("@/lib/observability/logger", () => ({ observeRoute: (_route: string, _method: string, handler: unknown) => handler, recordProductEvent: mocks.record }));
const request = (body: unknown, origin = "https://adbrain.example") => new Request("https://adbrain.example/api/events", { method: "POST", headers: { origin }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.user = { id: "11111111-1111-4111-8111-111111111111" }; mocks.limit.mockResolvedValue(null); });

describe("first-party client event ingestion", () => {
  it("accepts allowlisted activity and resolves the business server-side", async () => {
    const { POST } = await import("@/app/api/events/route");
    expect((await POST(request({ name: "page.view", page: "/studio" }))).status).toBe(204);
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ kind: "client", businessId: "22222222-2222-4222-8222-222222222222", name: "page.view" }));
  });
  it.each([
    { name: "page.view", page: "/studio", userId: "other" },
    { name: "page.view", page: "/studio?token=secret" },
    { name: "creative.approve", page: "/studio" },
    { name: "client.error", page: "/studio", message: "private prompt" },
  ])("rejects forged or sensitive fields: %j", async body => {
    const { POST } = await import("@/app/api/events/route");
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("rejects cross-origin and anonymous requests", async () => {
    const { POST } = await import("@/app/api/events/route");
    expect((await POST(request({}, "https://other.example"))).status).toBe(403);
    mocks.user = null;
    expect((await POST(request({})))).toHaveProperty("status", 401);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("bounds body bytes and event rates", async () => {
    const { POST } = await import("@/app/api/events/route");
    expect((await POST(request({ text: "x".repeat(3000) }))).status).toBe(413);
    mocks.limit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await POST(request({ name: "page.view", page: "/studio" }))).status).toBe(429);
    expect(mocks.record).not.toHaveBeenCalled();
  });
});