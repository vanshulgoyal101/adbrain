import { beforeEach, describe, expect, it, vi } from "vitest";

// #1670: the owner's answer to "Make {business} yours?". The database checks the address, expiry, single use, one
// business per account and the pre-checks; the route adds that a team login can't take a business (it would stay internal).
const m = vi.hoisted(() => ({ user: null as null | Record<string, unknown>, rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: m.user } }) }, rpc: m.rpc }),
}));
vi.mock("@/lib/observability/logger", () => ({ observeRoute: (_route: string, _method: string, handler: unknown) => handler }));
vi.mock("@/lib/internal-accounts.json", () => ({ default: { domains: ["team.example"], userIds: [], smokeUserIds: [], exemptFromFreeProviders: [] } }));

const TRANSFER = "11111111-1111-4111-8111-111111111111";
const owner = { id: "u1", email: "owner@example.com", email_confirmed_at: "2026-10-28T00:00:00Z" };
async function post(body: unknown) {
  const { POST } = await import("@/app/api/prospect/claim/route");
  return POST(new Request("https://adbrain.vanshul.com/api/prospect/claim", { method: "POST", body: JSON.stringify(body) })) as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.user = owner;
  m.rpc.mockResolvedValue({ data: "22222222-2222-4222-8222-222222222222", error: null });
});

describe("POST /api/prospect/claim (#1670)", () => {
  it("accept claims the transfer for the signed-in owner", async () => {
    const response = await post({ transferId: TRANSFER, decision: "accept" });
    expect(response.status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith("business_transfer_claim", { p_transfer_id: TRANSFER });
  });

  it("decline turns it down", async () => {
    m.rpc.mockResolvedValueOnce({ data: true, error: null });
    expect((await post({ transferId: TRANSFER, decision: "decline" })).status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith("business_transfer_decline", { p_transfer_id: TRANSFER });
  });

  it("a team login can't take a business; signed out gets 401; nothing reaches the database", async () => {
    m.user = { id: "u2", email: "qa@team.example", email_confirmed_at: "2026-10-28T00:00:00Z" };
    expect((await post({ transferId: TRANSFER, decision: "accept" })).status).toBe(403);
    m.user = null;
    expect((await post({ transferId: TRANSFER, decision: "accept" })).status).toBe(401);
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("the database's refusal reaches the owner in its words", async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "This email already has an AdBrain business; use another email or ask AdBrain" } });
    const response = await post({ transferId: TRANSFER, decision: "accept" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/already has an AdBrain business/);
  });
});
