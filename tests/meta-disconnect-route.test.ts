import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), owned: vi.fn(), primary: vi.fn(), revoke: vi.fn(), order: [] as string[] }));
vi.mock("@/lib/meta/revoke-grant", () => ({ revokeMetaGrant: mocks.revoke }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/queries", () => ({ getPrimaryBusiness: mocks.primary }));
vi.mock("@/lib/audit", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/meta/connection-access", () => ({
  requireOwnedBusiness: mocks.owned,
  ConnectionAccessError: class extends Error { constructor(public code: string, message: string) { super(message); } },
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.primary.mockResolvedValue({ id: "primary" });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.owned.mockImplementation(async businessId => ({ businessId }));
  mocks.order = [];
  mocks.revoke.mockImplementation(async () => { mocks.order.push("revoke"); return "revoked"; });
  mocks.rpc.mockImplementation(async (name: string) => { mocks.order.push(name); return { data: true, error: null }; });
});

describe("Meta disconnect target validation", () => {
  it.each(["{", "null", "[]", "{}", '{"businessId":42}', '{"businessId":""}', '{"businessId":"other"}'])("rejects supplied invalid body %s without falling back", async body => {
    const { POST } = await import("@/app/api/meta/disconnect/route");
    expect((await POST(new Request("https://app.test/api/meta/disconnect", { method: "POST", body }))).status).toBe(400);
    expect(mocks.primary).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("retains intentional no-body compatibility", async () => {
    const { POST } = await import("@/app/api/meta/disconnect/route");
    expect((await POST(new Request("https://app.test/api/meta/disconnect", { method: "POST" }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("meta_disconnect", { p_business_id: "primary", p_user_id: "owner" });
  });

  it("disconnects only the explicitly owned business", async () => {
    const { POST } = await import("@/app/api/meta/disconnect/route");
    const businessId = "11111111-1111-4111-8111-111111111111";
    expect((await POST(new Request("https://app.test/api/meta/disconnect", { method: "POST", body: JSON.stringify({ businessId }) }))).status).toBe(200);
    expect(mocks.primary).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("meta_disconnect", { p_business_id: businessId, p_user_id: "owner" });
  });

  it.each([["NOT_FOUND", 404], ["FORBIDDEN", 403], ["UNAVAILABLE", 503]] as const)("returns a controlled %s response", async (code, status) => {
    const { POST } = await import("@/app/api/meta/disconnect/route");
    const { ConnectionAccessError } = await import("@/lib/meta/connection-access");
    mocks.owned.mockRejectedValue(new ConnectionAccessError(code, "Access failed"));
    expect((await POST(new Request("https://app.test/api/meta/disconnect", { method: "POST", body: JSON.stringify({ businessId: "11111111-1111-4111-8111-111111111111" }) }))).status).toBe(status);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  // #1649: the grant is revoked at Meta (best effort) before the token is purged; a failed revoke never blocks it.
  it("revokes the Meta grant first, then disconnects, even when the revoke fails", async () => {
    const { POST } = await import("@/app/api/meta/disconnect/route");
    const businessId = "11111111-1111-4111-8111-111111111111";
    const request = () => new Request("https://app.test/api/meta/disconnect", { method: "POST", body: JSON.stringify({ businessId }) });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.revoke).toHaveBeenCalledWith(businessId);
    expect(mocks.order).toEqual(["revoke", "meta_disconnect"]);
    mocks.revoke.mockResolvedValue("failed");
    expect((await POST(request())).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("meta_disconnect", { p_business_id: businessId, p_user_id: "owner" });
  });
  it("disconnects within about 5 s when Meta's revoke hangs (#1649)", async () => {
    vi.useFakeTimers();
    try {
      mocks.revoke.mockImplementation(() => new Promise(() => {}));
      const { POST } = await import("@/app/api/meta/disconnect/route");
      const businessId = "11111111-1111-4111-8111-111111111111";
      const pending = POST(new Request("https://app.test/api/meta/disconnect", { method: "POST", body: JSON.stringify({ businessId }) }));
      await vi.advanceTimersByTimeAsync(4_900);
      expect(mocks.rpc).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      expect((await pending).status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledWith("meta_disconnect", { p_business_id: businessId, p_user_id: "owner" });
    } finally {
      vi.useRealTimers();
    }
  });
});
