import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerBalanceError, getCustomerBalance, reserveCustomerCampaign } from "@/lib/payments/customer-balance";
import { ConnectionAccessError } from "@/lib/meta/connection-access";
import { GET, POST } from "@/app/api/payments/customer-balance/route";
import { customerRefundAllocationSchema } from "@/lib/payments/customer-balance-contracts";

const mocks = vi.hoisted(() => {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return { rpc: vi.fn(), owned: vi.fn(), getUser: vi.fn(), limited: vi.fn(), query };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/payments/production-config", () => ({ getProductionPaymentConfig: () => ({ accountId: "acc_fixture", origin: "https://adbrain.example" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser }, from: () => mocks.query }) }));
vi.mock("@/lib/meta/connection-access", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/meta/connection-access")>(), requireOwnedBusiness: mocks.owned }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: mocks.limited }));

const actor = { businessId: "22222222-2222-4222-8222-222222222222", userId: "33333333-3333-4333-8333-333333333333" };
const campaignId = "11111111-1111-4111-8111-111111111111";
const balance = { businessId: actor.businessId, currency: "INR", capturedPaise: 1_000_000, refundedPaise: 0,
  serviceAllocationPaise: 200_000, advertisingAllocationPaise: 800_000, mediaCostPaise: 0, taxCostPaise: 0,
  reservedPaise: 0, remainingPaise: 800_000, held: false, reason: null, reservations: [] };
const admission = { campaignId, adAccountId: "act_123", connectionGeneration: 1, dailyBudgetRupees: 200, requestKey: "a".repeat(64) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockReset();
  mocks.owned.mockResolvedValue(actor);
  mocks.getUser.mockResolvedValue({ data: { user: { id: actor.userId } } });
  mocks.limited.mockResolvedValue(null);
  mocks.query.maybeSingle.mockResolvedValue({ data: null, error: null });
});
function returns(data: unknown, error: unknown = null) {
  mocks.rpc.mockReturnValue({ abortSignal: async () => ({ data, error }) });
}

describe("customer advertising accounting boundary", () => {
  it("accepts configurable service allocations but retains integer and maximum bounds", () => {
    const evidence = { orderId: campaignId, serviceRefundedPaise: 0, advertisingRefundedPaise: 0,
      serviceEarnedPaise: 201, evidenceReference: campaignId };
    expect(customerRefundAllocationSchema.parse(evidence)).toEqual(evidence);
    for (const serviceEarnedPaise of [-1, 0.5, 200001, Number.NaN]) {
      expect(customerRefundAllocationSchema.safeParse({ ...evidence, serviceEarnedPaise }).success).toBe(false);
    }
  });
  it("uses authenticated tenant and configured merchant authority", async () => {
    returns(balance);
    expect(await getCustomerBalance(actor)).toEqual(balance);
    expect(mocks.rpc).toHaveBeenCalledWith("customer_ad_balance", {
      p_business_id: actor.businessId, p_user_id: actor.userId, p_account_id: "acc_fixture",
    });
  });
  it.each([null, { ...balance, remainingPaise: -1 }, { ...balance, businessId: campaignId }])("rejects malformed or foreign balances", async data => {
    returns(data);
    await expect(getCustomerBalance(actor)).rejects.toThrow(CustomerBalanceError);
  });
  it("never treats unavailable storage as zero cost", async () => {
    returns(null, new Error("storage offline"));
    await expect(getCustomerBalance(actor)).rejects.toThrow(CustomerBalanceError);
  });
  it("reserves checked integer paise under the reviewed campaign identity", async () => {
    returns({ reservationId: campaignId, mediaLimitPaise: 677966, balance });
    await reserveCustomerCampaign(actor, admission);
    expect(mocks.rpc).toHaveBeenCalledWith("customer_ad_reserve", expect.objectContaining({
      p_campaign_id: campaignId, p_daily_budget_paise: 20000, p_request_key: admission.requestKey,
      p_ad_account_id: "act_123", p_connection_generation: 1,
    }));
  });
  it("blocks held funds and invalid fractional paise", async () => {
    returns({ reservationId: campaignId, mediaLimitPaise: 677966, balance: { ...balance, held: true } });
    await expect(reserveCustomerCampaign(actor, admission)).rejects.toThrow(CustomerBalanceError);
    mocks.rpc.mockClear();
    await expect(reserveCustomerCampaign(actor, { ...admission, dailyBudgetRupees: 0.001 })).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("checks review without creating a reservation", async () => {
    returns({ reservationId: campaignId, mediaLimitPaise: 677966, balance });
    await reserveCustomerCampaign(actor, admission, true);
    expect(mocks.rpc).toHaveBeenCalledWith("customer_ad_reserve", expect.objectContaining({ p_review_only: true }));
  });
});

describe("customer balance API", () => {
  const url = `https://adbrain.example/api/payments/customer-balance?businessId=${actor.businessId}`;
  const evidence = { campaignId, adAccountId: "act_123", connectionGeneration: 1, mediaPaise: 0, taxPaise: 0,
    taxRateBps: 1800, observedAt: "2026-09-26T12:00:00.000Z", evidenceReference: campaignId, final: false, reservationId: null };
  const post = (body: unknown, origin = "https://adbrain.example") => new Request(url, {
    method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body),
  });
  it("reads only the verified owner's merchant-scoped balance without caching", async () => {
    returns(balance);
    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.owned).toHaveBeenCalledWith(actor.businessId);
    expect((await response.json()).balance).toEqual(balance);
  });
  it.each([["UNAUTHENTICATED", 401], ["FORBIDDEN", 403], ["NOT_FOUND", 404]] as const)("rejects %s without reading money", async (code, status) => {
    mocks.owned.mockRejectedValueOnce(new ConnectionAccessError(code, "Denied"));
    expect((await GET(new Request(url))).status).toBe(status);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects malformed IDs and rate-limits reads before the financial RPC", async () => {
    expect((await GET(new Request("https://adbrain.example/api/payments/customer-balance?businessId=bad"))).status).toBe(400);
    mocks.limited.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await GET(new Request(url))).status).toBe(429);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("reviews the owned stored campaign without reserving funds", async () => {
    mocks.query.maybeSingle.mockResolvedValueOnce({ data: { id: campaignId, daily_budget: 200,
      meta_ad_account_id: "act_123", meta_page_id: "page", meta_connection_generation: 1 }, error: null });
    returns({ reservationId: campaignId, mediaLimitPaise: 677966, balance });
    expect((await GET(new Request(`${url}&campaignId=${campaignId}`))).status).toBe(200);
    expect(mocks.query.eq).toHaveBeenCalledWith("business_id", actor.businessId);
    expect(mocks.rpc).toHaveBeenCalledWith("customer_ad_reserve", expect.objectContaining({ p_review_only: true, p_daily_budget_paise: 20000 }));
  });
  it("requires same-origin authenticated operator submissions", async () => {
    expect((await POST(post({ action: "costs", businessId: actor.businessId, evidence }, "https://foreign.example"))).status).toBe(403);
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await POST(post({ action: "costs", businessId: actor.businessId, evidence }))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses the session actor and lets SQL verify financial operator authority", async () => {
    returns(null);
    expect((await POST(post({ action: "costs", businessId: actor.businessId, evidence }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("customer_ad_reconcile_costs", expect.objectContaining({ p_actor_id: actor.userId, p_account_id: "acc_fixture" }));
    returns(null, { code: "42501" });
    expect((await POST(post({ action: "costs", businessId: actor.businessId, evidence }))).status).toBe(409);
  });
  it("rejects client actor overrides and invalid evidence", async () => {
    expect((await POST(post({ action: "costs", businessId: actor.businessId, evidence, userId: campaignId }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});