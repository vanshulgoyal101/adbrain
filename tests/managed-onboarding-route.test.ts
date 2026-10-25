import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ enabled: true, row: null as unknown, balance: vi.fn(), owned: vi.fn(), user: { id: "u-customer", email: "owner@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" } as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: m.user } }) } }) }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ MANAGED_ACCOUNTS_ENABLED: m.enabled }) }));
vi.mock("@/lib/meta/connection-access", () => ({ requireOwnedBusiness: m.owned, ConnectionAccessError: class extends Error {} }));
vi.mock("@/lib/payments/customer-balance", () => ({ getCustomerBalance: m.balance }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.row, error: null }) }) }) }) }),
}));

const businessId = "11111111-1111-4111-8111-111111111111";
const get = async () => {
  const { GET } = await import("@/app/api/managed/onboarding/route");
  return GET(new NextRequest(`http://localhost/api/managed/onboarding?businessId=${businessId}`));
};

beforeEach(() => {
  vi.clearAllMocks();
  m.enabled = true; vi.stubEnv("MANAGED_ACCOUNTS_ENABLED", "true");
  m.row = null;
  m.owned.mockResolvedValue({ businessId, userId: "u" });
});

describe("GET /api/managed/onboarding (#526)", () => {
  it("is off unless MANAGED_ACCOUNTS_ENABLED", async () => {
    m.enabled = false; vi.stubEnv("MANAGED_ACCOUNTS_ENABLED", "false");
    expect((await get()).status).toBe(404);
    expect(m.owned).not.toHaveBeenCalled();
  });

  it("returns the owner's ledger row and whether captured payments exceed refunds", async () => {
    m.row = { state: "page_linked", page_id: "1" };
    m.balance.mockResolvedValue({ capturedPaise: 100_000, refundedPaise: 0 });
    expect((await (await get()).json()).data).toEqual({ row: { state: "page_linked", page_id: "1" }, paid: true });
    m.balance.mockResolvedValue({ capturedPaise: 100_000, refundedPaise: 100_000 });
    expect((await (await get()).json()).data.paid).toBe(false);
  });

  it("counts an unreadable balance as not paid yet, rather than failing the screen", async () => {
    m.balance.mockRejectedValue(new Error("not configured"));
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ row: null, paid: false });
  });
});
