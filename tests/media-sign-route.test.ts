import { beforeEach, describe, expect, it, vi } from "vitest";

// #1209 + #784: no upload URL is signed until the owner has confirmed the current rights terms (#1248's record).
const m = vi.hoisted(() => ({ consent: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({ observeRoute: (_r: string, _m: string, handler: unknown) => handler }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/media/consent", () => ({ hasCurrentMediaConsent: m.consent }));
vi.mock("@/lib/media/store", () => ({ signUpload: m.sign }));
vi.mock("@/lib/media/route-helpers", () => ({
  mediaSession: async () => ({ user: { id: "u1" }, client: {} }),
  ownedBusiness: async () => ({ id: "11111111-1111-4111-8111-111111111111", vertical: "Dental clinic" }),
  mediaErrorResponse: () => new Response(null, { status: 500 }),
}));

const body = { businessId: "11111111-1111-4111-8111-111111111111", mime: "image/jpeg", bytes: 1000, sha256: "a".repeat(64), width: 1080, height: 1350 };
const post = async () => {
  const { POST } = await import("@/app/api/media/sign/route");
  return POST(new Request("https://adbrain.vanshul.com/api/media/sign", { method: "POST", body: JSON.stringify(body) })) as Promise<Response>;
};

beforeEach(() => { vi.clearAllMocks(); m.sign.mockResolvedValue({ duplicate: false, id: "x", path: "p", token: "t", fit: { level: "ready" } }); });

describe("POST /api/media/sign (#1209, #784)", () => {
  it("without the owner's current confirmation: 409 MEDIA_RIGHTS_REQUIRED, nothing signed", async () => {
    m.consent.mockResolvedValue(false);
    const response = await post();
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("MEDIA_RIGHTS_REQUIRED");
    expect(m.sign).not.toHaveBeenCalled();
    expect(m.consent).toHaveBeenCalledWith({}, { id: body.businessId, vertical: "Dental clinic" });
  });

  it("with it: signs, recording when the rights were checked", async () => {
    m.consent.mockResolvedValue(true);
    expect((await post()).status).toBe(200);
    expect(m.sign).toHaveBeenCalledWith({}, expect.objectContaining({ businessId: body.businessId, rightsConfirmedAt: expect.any(String) }));
  });
});
