import { beforeEach, describe, expect, it, vi } from "vitest";

// #778 slice 3b (#784): the upload sheet saves the owner's rights tick here before the first sign.
const m = vi.hoisted(() => ({ record: vi.fn(), business: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({ observeRoute: (_r: string, _m: string, handler: unknown) => handler }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/media/consent", () => ({ recordMediaConsent: m.record }));
vi.mock("@/lib/media/route-helpers", () => ({
  mediaSession: async () => ({ user: { id: "u1" }, client: { rls: true } }),
  ownedBusiness: m.business,
}));

const id = "11111111-1111-4111-8111-111111111111";
const post = async (body: unknown) => {
  const { POST } = await import("@/app/api/media/consent/route");
  return POST(new Request("https://adbrain.vanshul.com/api/media/consent", { method: "POST", body: JSON.stringify(body) })) as Promise<Response>;
};

beforeEach(() => { vi.clearAllMocks(); m.business.mockResolvedValue({ id, vertical: "Salon" }); m.record.mockResolvedValue(undefined); });

describe("POST /api/media/consent (#778, #784)", () => {
  it("records the tick with the owner's own client (the RPC checks ownership again)", async () => {
    const response = await post({ businessId: id, rights: true, people: true });
    expect(response.status).toBe(200);
    expect(m.record).toHaveBeenCalledWith({ rls: true }, { id, vertical: "Salon" }, { rights: true, people: true });
  });

  it("another owner's business: 404, nothing recorded", async () => {
    m.business.mockResolvedValue(null);
    expect((await post({ businessId: id, rights: true, people: false })).status).toBe(404);
    expect(m.record).not.toHaveBeenCalled();
  });

  it("an unticked or incomplete confirmation: 400 with the reason", async () => {
    m.record.mockRejectedValue(new Error("Confirm that everyone recognisable has agreed to appear in your ads."));
    const response = await post({ businessId: id, rights: true, people: false });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/everyone recognisable/);
    expect((await post({ businessId: "nope", rights: true })).status).toBe(400);
    m.record.mockRejectedValue(new Error("Your confirmation couldn't be saved. Try again."));
    expect((await post({ businessId: id, rights: true })).status).toBe(503);
  });
});
