import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// #523 (CTO): before 2-Tier opens, internal accounts (#379) use the managed screens and routes; customers get 404.
const m = vi.hoisted(() => ({ user: null as unknown, metaConnect: true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: m.user } }) } }) }));
vi.mock("@/lib/meta/pilot-access", () => ({ canUseMetaConnect: () => m.metaConnect }));
vi.mock("@/lib/meta/connection-access", () => ({
  requireOwnedBusiness: async (businessId: string) => ({ businessId, userId: "u" }),
  ConnectionAccessError: class extends Error {},
}));
vi.mock("@/lib/payments/customer-balance", () => ({ getCustomerBalance: async () => ({ capturedPaise: 0, refundedPaise: 0 }) }));
vi.mock("@/lib/meta/managed-whatsapp", () => ({ checkManagedWhatsApp: async () => ({ status: "waiting_setup" }) }));
vi.mock("@/lib/supabase/queries", () => ({ getPrimaryBusiness: async () => ({ id: "11111111-1111-4111-8111-111111111111" }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    rpc: async () => ({ data: [{ business_id: "11111111-1111-4111-8111-111111111111", expires_at: "2099-01-01T00:00:00Z", discovered_assets: {}, token_id: null }], error: null }),
  }),
}));

const customer = { id: "c0ffee00-0000-4000-8000-000000000001", email: "owner@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
const internal = { id: "da0771ca-c07f-4e86-b6da-023aaf517d74", email: "owner@gmail.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
const team = { id: "c0ffee00-0000-4000-8000-000000000002", email: "qa@adbrain.vanshul.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
const businessId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => { vi.stubEnv("MANAGED_ACCOUNTS_ENABLED", "false"); m.metaConnect = true; });
afterEach(() => vi.unstubAllEnvs());

describe("managed accounts for internal accounts only, until the flag is on (#523)", () => {
  it("decides per user: internal ids and confirmed team emails yes, customers no; everyone once the flag is on", async () => {
    const { managedAccountsEnabledFor } = await import("@/lib/meta/managed-account");
    expect(managedAccountsEnabledFor(customer)).toBe(false);
    expect(managedAccountsEnabledFor(null)).toBe(false);
    expect(managedAccountsEnabledFor(internal)).toBe(true);
    expect(managedAccountsEnabledFor(team)).toBe(true);
    expect(managedAccountsEnabledFor({ ...team, email_confirmed_at: null })).toBe(false);
    vi.stubEnv("MANAGED_ACCOUNTS_ENABLED", "true");
    expect(managedAccountsEnabledFor(customer)).toBe(true);
  });

  it("/onboarding is a 404 for a customer and opens for an internal account", async () => {
    const { default: OnboardingPage } = await import("@/app/(app)/onboarding/page");
    m.user = customer;
    await expect(OnboardingPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    m.user = internal;
    await expect(OnboardingPage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy();
  });

  it("/api/managed/onboarding is a 404 for a customer and answers an internal account", async () => {
    const { GET } = await import("@/app/api/managed/onboarding/route");
    const get = () => GET(new NextRequest(`http://localhost/api/managed/onboarding?businessId=${businessId}`));
    m.user = customer;
    expect((await get()).status).toBe(404);
    m.user = internal;
    expect((await get()).status).toBe(200);
  });

  it("/api/managed/whatsapp is a 404 for a customer and checks for an internal account (#524)", async () => {
    const { POST } = await import("@/app/api/managed/whatsapp/route");
    const post = () => POST(new Request("http://localhost/api/managed/whatsapp", { method: "POST", body: JSON.stringify({ businessId }) }));
    m.user = customer;
    expect((await post()).status).toBe(404);
    m.user = internal;
    expect((await post()).status).not.toBe(404);
  });

  it("the attempt-based managed routes (Page, provision) refuse a customer and let an internal account through", async () => {
    const { ownedManagedAttempt } = await import("@/lib/meta/managed-attempt");
    m.user = customer;
    const refused = await ownedManagedAttempt("22222222-2222-4222-8222-222222222222");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.response.status).toBe(404);
    m.user = internal;
    expect((await ownedManagedAttempt("22222222-2222-4222-8222-222222222222")).ok).toBe(true);
  });

  // Reviewer #625: one gate for every managed route: enabled for the user, signed in, Meta Connect allowed.
  it("every managed route refuses a user Meta Connect isn't open to, and a signed-out caller", async () => {
    vi.stubEnv("MANAGED_ACCOUNTS_ENABLED", "true");
    const { GET } = await import("@/app/api/managed/onboarding/route");
    const { POST } = await import("@/app/api/managed/whatsapp/route");
    const { ownedManagedAttempt } = await import("@/lib/meta/managed-attempt");
    const calls = {
      onboarding: async () => (await GET(new NextRequest(`http://localhost/api/managed/onboarding?businessId=${businessId}`))).status,
      whatsapp: async () => (await POST(new Request("http://localhost/api/managed/whatsapp", { method: "POST", body: JSON.stringify({ businessId }) }))).status,
      attempt: async () => { const result = await ownedManagedAttempt("22222222-2222-4222-8222-222222222222"); return result.ok ? 200 : result.response.status; },
    };
    m.user = customer;
    m.metaConnect = false;
    for (const [name, call] of Object.entries(calls)) expect(await call(), name).toBe(403);
    m.user = null;
    m.metaConnect = true;
    for (const [name, call] of Object.entries(calls)) expect(await call(), name).toBe(401);
  });
});
