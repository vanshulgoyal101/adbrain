import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  run: vi.fn(), owned: vi.fn(),
  gate: { ok: true } as { ok: true } | { ok: false; response: Response },
}));
vi.mock("@/services/business-access", () => ({
  managedRouteUser: async () => m.gate,
  requireOwnedBusiness: m.owned,
  ConnectionAccessError: class extends Error {},
}));
vi.mock("@/services/managed-billing", () => ({ runManagedBilling: m.run }));

const businessId = "11111111-1111-4111-8111-111111111111";
const post = async (body: unknown) => {
  const { POST } = await import("@/app/api/managed/billing/route");
  return POST(new Request("http://localhost/api/managed/billing", { method: "POST", body: JSON.stringify(body) }) as never);
};

beforeEach(() => {
  vi.clearAllMocks();
  m.gate = { ok: true };
  m.owned.mockResolvedValue({ businessId, userId: "u" });
});

describe("POST /api/managed/billing (#2359)", () => {
  it("stays behind the managed-route gate", async () => {
    m.gate = { ok: false, response: new Response(null, { status: 404 }) };
    expect((await post({ action: "check", businessId })).status).toBe(404);
    expect(m.run).not.toHaveBeenCalled();
  });

  it("rejects a malformed body before checking ownership or calling Meta", async () => {
    for (const body of [null, { action: "check" }, { action: "pay", businessId }, { action: "invite", businessId }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(m.owned).not.toHaveBeenCalled();
    expect(m.run).not.toHaveBeenCalled();
  });

  it("runs the step for the owned business only", async () => {
    m.run.mockResolvedValue({ ok: true, data: { status: "invited" } });
    const response = await post({ action: "invite", businessId, email: "owner@example.in" });
    expect(await response.json()).toMatchObject({ ok: true, data: { status: "invited" } });
    expect(m.owned).toHaveBeenCalledWith(businessId);
    expect(m.run).toHaveBeenCalledWith(businessId, { action: "invite", email: "owner@example.in" });
  });

  it("words Meta failures for the owner, never Meta's own text", async () => {
    m.run.mockResolvedValue({ ok: false, code: "META_BUSY", retryable: true });
    const busy = await post({ action: "check", businessId });
    expect(busy.status).toBe(503);
    expect((await busy.json()).error).toMatchObject({ code: "META_BUSY", message: "Facebook is busy right now. Try again in a few minutes." });
    m.run.mockResolvedValue({ ok: false, code: "META_100_33", retryable: false });
    const unknown = await post({ action: "check", businessId });
    expect(unknown.status).toBe(409);
    expect((await unknown.json()).error.message).toMatch(/AdBrain has been told/);
  });
});
