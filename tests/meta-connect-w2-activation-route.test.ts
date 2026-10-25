import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activationConfirmationPayload } from "@/lib/campaign/activation";
import { CampaignDeliveryError } from "@/lib/meta/client";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getActivationLearning: vi.fn(),
  requireOwnedBusiness: vi.fn(),
  withMetaConnection: vi.fn(),
  metaClientForBusiness: vi.fn(),
  getSpendLimits: vi.fn(),
  getCampaignSpend: vi.fn(),
  updateCampaignStatus: vi.fn(),
  pauseCampaignTree: vi.fn(),
  verifyCampaignActivation: vi.fn(),
  readCampaignDelivery: vi.fn(),
  saveCampaign: vi.fn(),
  enforceCampaignSpendCap: vi.fn(),
  createCappedAdSet: vi.fn(),
  activateCappedTree: vi.fn(),
  recheckMetaConnection: vi.fn(),
  deleteCampaign: vi.fn(),
  reserveCustomerCampaign: vi.fn(),
  confirmCustomerCampaign: vi.fn(),
  getCustomerBalance: vi.fn(),
  readLifetimeSpendPaise: vi.fn(),
  observeCustomerCosts: vi.fn(),
  isOperatorFunded: vi.fn(),
  readAccountFunding: vi.fn(),
  dailyBudget: 500,
  storedAdSetIds: ["set-1"],
  storedAdIds: ["ad-1"],
  storedCap: {} as Record<string, unknown>,
}));

class MockConnectionAccessError extends Error {
  code: "CONFLICT" | "UNAVAILABLE" = "CONFLICT";
}

vi.mock("@/lib/campaign/trusted-write", () => ({
  saveCampaign: (...args: unknown[]) => mocks.saveCampaign(...args),
  deleteVerifiedCampaign: (...args: unknown[]) => mocks.deleteCampaign(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: (table: string) => {
      if (table === "campaigns") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "campaign-1",
                  business_id: "business-1",
                  meta_campaign_id: "meta-campaign-1",
                  meta_adset_id: "set-1",
                  meta_ad_ids: mocks.storedAdIds,
                  raw: { source: "campaign_operation", metaResult: { campaignId: "meta-campaign-1", adSetIds: mocks.storedAdSetIds, adIds: mocks.storedAdIds }, ...mocks.storedCap },
                  daily_budget: mocks.dailyBudget,
                  status: "paused",
                  name: "Campaign",
                  meta_ad_account_id: "act_123",
                  meta_page_id: "page_123",
                  meta_connection_generation: 4,
                },
              }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
          delete: () => ({ eq: mocks.deleteCampaign }),
        };
      }
      return { update: () => ({ eq: async () => ({ error: null }) }) };
    },
  }),
}));

vi.mock("@/lib/meta/connection-access", () => ({
  ConnectionAccessError: MockConnectionAccessError,
  requireOwnedBusiness: mocks.requireOwnedBusiness,
  withMetaConnection: mocks.withMetaConnection,
  recheckMetaConnection: mocks.recheckMetaConnection,
}));
vi.mock("@/lib/meta/credentials", () => ({ metaClientForBusiness: mocks.metaClientForBusiness }));
vi.mock("@/lib/supabase/queries", () => ({
  getSpendLimits: mocks.getSpendLimits,
  getCampaignSpend: mocks.getCampaignSpend,
}));
vi.mock("@/lib/audit", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/payments/customer-balance", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/payments/customer-balance")>(),
  reserveCustomerCampaign: mocks.reserveCustomerCampaign,
  confirmCustomerCampaign: mocks.confirmCustomerCampaign,
  getCustomerBalance: mocks.getCustomerBalance,
  observeCustomerCosts: mocks.observeCustomerCosts,
}));
vi.mock("@/lib/payments/operator-funding", () => ({ isOperatorFunded: mocks.isOperatorFunded }));
vi.mock("@/lib/campaign/activation-learning", () => ({ getActivationLearning: mocks.getActivationLearning }));

function patch(body: unknown): Request {
  return new Request("http://localhost/api/campaigns/campaign-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const reviewedDelivery = {
  campaign: { id: "meta-campaign-1", status: "PAUSED", effectiveStatus: "CAMPAIGN_PAUSED" },
  adSets: [{ id: "set-1", status: "ACTIVE", effectiveStatus: "CAMPAIGN_PAUSED", dailyBudgetPaise: 50000, pageId: "page_123", destinationType: "ON_AD", targeting: null }],
  ads: [{ id: "ad-1", status: "ACTIVE", effectiveStatus: "CAMPAIGN_PAUSED", adSetId: "set-1", creativeId: "creative-1" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dailyBudget = 500;
  mocks.storedAdSetIds = ["set-1"];
  mocks.storedAdIds = ["ad-1"];
  mocks.storedCap = {};
  mocks.updateCampaignStatus.mockResolvedValue(undefined);
  mocks.pauseCampaignTree.mockResolvedValue({ confirmed: true, objects: [{ id: "meta-campaign-1", level: "campaign", status: "PAUSED", effectiveStatus: "PAUSED" }] });
  mocks.reserveCustomerCampaign.mockResolvedValue({ reservationId: "reservation-1", mediaLimitPaise: 677966 });
  mocks.enforceCampaignSpendCap.mockResolvedValue(undefined);
  mocks.confirmCustomerCampaign.mockResolvedValue(undefined);
  mocks.getCustomerBalance.mockResolvedValue({ reservations: [{ campaignId: "campaign-1", reservationId: "reservation-1", state: "active" }] });
  mocks.verifyCampaignActivation.mockImplementation(async (_id: string, expected: { status: string }) => ({
    ...reviewedDelivery, campaign: { ...reviewedDelivery.campaign, status: expected.status.toUpperCase() },
  }));
  mocks.saveCampaign.mockResolvedValue({ error: null });
  mocks.readLifetimeSpendPaise.mockResolvedValue(3263);
  mocks.observeCustomerCosts.mockResolvedValue(undefined);
  mocks.isOperatorFunded.mockResolvedValue(false);
  mocks.readAccountFunding.mockResolvedValue({ spendCapPaise: 88983, amountSpentPaise: 4237, roomPaise: 84746, prepay: true });
  mocks.readCampaignDelivery.mockResolvedValue(reviewedDelivery);
  mocks.recheckMetaConnection.mockResolvedValue(undefined);
  mocks.getActivationLearning.mockResolvedValue({ costPerResultRupees: null, pausedAt: null });
  mocks.deleteCampaign.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.requireOwnedBusiness.mockResolvedValue({ businessId: "business-1", userId: "user-1" });
  mocks.getSpendLimits.mockResolvedValue({ weeklyCapRupees: null, alertPct: 80, autoPause: false });
  mocks.getCampaignSpend.mockResolvedValue([]);
  mocks.withMetaConnection.mockImplementation(async (_context, _options, execute) =>
    execute({ updateCampaignStatus: mocks.updateCampaignStatus, pauseCampaignTree: mocks.pauseCampaignTree, verifyCampaignActivation: mocks.verifyCampaignActivation, readCampaignDelivery: mocks.readCampaignDelivery, enforceCampaignSpendCap: mocks.enforceCampaignSpendCap, createCappedAdSet: mocks.createCappedAdSet, activateCappedTree: mocks.activateCappedTree, readLifetimeSpendPaise: mocks.readLifetimeSpendPaise, readAccountFunding: mocks.readAccountFunding }, {
      generation: 4,
      selected: { metaBusinessId: null, adAccountId: "act_123", accountName: "Account", pageId: "page_123", pageName: "Page", currency: "INR", timezoneName: "Asia/Kolkata" },
      capabilities: { canActivate: { state: "available", blockers: [] } },
    }),
  );
});

describe("campaign activation generation fence", () => {
  const confirmationDigest = () => createHash("sha256").update(activationConfirmationPayload(
    { id: "campaign-1", meta_campaign_id: "meta-campaign-1", daily_budget: 500, status: "paused" },
    { generation: 4, selected: { metaBusinessId: null, adAccountId: "act_123", accountName: "Account", pageId: "page_123", pageName: "Page", currency: "INR", timezoneName: "Asia/Kolkata" } },
    reviewedDelivery,
  )).digest("hex");

  it("returns a tenant-scoped, read-only child review without reserving funds", async () => {
    const { GET } = await import("@/app/api/campaigns/[id]/route");
    mocks.getActivationLearning.mockResolvedValueOnce({ costPerResultRupees: 10.69, pausedAt: "2026-10-15T09:00:00Z" });
    const response = await GET(new Request("http://localhost/api/campaigns/campaign-1"), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.delivery).toEqual(reviewedDelivery);
    // #419 item 2: the learning-restart inputs ride along, outside the confirmation digest.
    expect(body.learning).toEqual({ costPerResultRupees: 10.69, pausedAt: "2026-10-15T09:00:00Z" });
    expect(mocks.getActivationLearning).toHaveBeenCalledWith(expect.objectContaining({ id: "campaign-1", business_id: "business-1", status: "paused" }));
    expect(mocks.readCampaignDelivery).toHaveBeenCalledWith("meta-campaign-1", { dailyBudgetRupees: 500, status: "paused", adSetIds: ["set-1"], adIds: ["ad-1"], cappedAdSetIds: [] });
    expect(mocks.reserveCustomerCampaign).not.toHaveBeenCalled();
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("does not read delivery for a campaign whose owner check fails", async () => {
    mocks.requireOwnedBusiness.mockRejectedValueOnce(new MockConnectionAccessError("Business access changed."));
    const { GET } = await import("@/app/api/campaigns/[id]/route");
    const response = await GET(new Request("http://localhost/api/campaigns/campaign-1"), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(409);
    expect(mocks.readCampaignDelivery).not.toHaveBeenCalled();
    expect(mocks.reserveCustomerCampaign).not.toHaveBeenCalled();
  });

  it("checks campaign ownership before exposing an incomplete child binding", async () => {
    mocks.storedAdSetIds = ["set-unexpected"];
    mocks.requireOwnedBusiness.mockRejectedValue(new MockConnectionAccessError("Business access changed."));
    const { GET } = await import("@/app/api/campaigns/[id]/route");
    const response = await GET(new Request("http://localhost/api/campaigns/campaign-1"), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(mocks.requireOwnedBusiness).toHaveBeenCalledWith("business-1");
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("Campaign children or account need reconciliation");
    expect(mocks.readCampaignDelivery).not.toHaveBeenCalled();
  });

  it.each(["paused", "active"] as const)("checks ownership before %s campaign details or spend", async status => {
    mocks.storedAdSetIds = ["set-unexpected"];
    mocks.requireOwnedBusiness.mockRejectedValue(new MockConnectionAccessError("Business access changed."));
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const body = status === "active" ? { status, confirmationDigest: confirmationDigest(), connectionGeneration: 4 } : { status };
    const response = await PATCH(patch(body), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(mocks.requireOwnedBusiness).toHaveBeenCalledWith("business-1");
    expect(response.status).toBe(409);
    expect(await response.text()).not.toMatch(/children|account reconciliation|spend limits/i);
    expect(mocks.getSpendLimits).not.toHaveBeenCalled();
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
  });

  it("rejects an incomplete stored child binding before review or activation", async () => {
    mocks.storedAdSetIds = ["set-unexpected"];
    const { GET, PATCH } = await import("@/app/api/campaigns/[id]/route");
    const context = { params: Promise.resolve({ id: "campaign-1" }) };
    const review = await GET(new Request("http://localhost/api/campaigns/campaign-1"), context);
    const activation = await PATCH(patch({ status: "active", confirmationDigest: confirmationDigest(), connectionGeneration: 4 }), context);
    expect(review.status).toBe(409);
    expect(activation.status).toBe(409);
    expect(mocks.readCampaignDelivery).not.toHaveBeenCalled();
    expect(mocks.verifyCampaignActivation).not.toHaveBeenCalled();
    expect(mocks.reserveCustomerCampaign).not.toHaveBeenCalled();
  });

  it("rejects a child setting change after review without reserving or activating", async () => {
    mocks.verifyCampaignActivation.mockResolvedValueOnce({
      ...reviewedDelivery, adSets: [{ ...reviewedDelivery.adSets[0], targeting: { geo_locations: { countries: ["IN"] } } }],
    });
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const response = await PATCH(patch({ status: "active", confirmationDigest: confirmationDigest(), connectionGeneration: 4 }), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(409);
    expect(mocks.reserveCustomerCampaign).not.toHaveBeenCalled();
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("holds a partial provider outcome for reconciliation instead of mirroring active", async () => {
    mocks.verifyCampaignActivation.mockResolvedValueOnce(reviewedDelivery)
      .mockRejectedValueOnce(new CampaignDeliveryError("An intended ad is paused after the parent request."));
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const response = await PATCH(patch({ status: "active", confirmationDigest: confirmationDigest(), connectionGeneration: 4 }), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(409);
    expect(mocks.updateCampaignStatus).toHaveBeenCalledWith("meta-campaign-1", "ACTIVE");
    expect(mocks.confirmCustomerCampaign).toHaveBeenCalledWith(expect.anything(), "campaign-1", "reservation-1", "uncertain");
    expect(mocks.saveCampaign).not.toHaveBeenCalled();
  });

  it("rejects an arbitrary well-formed digest without activating", async () => {
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const response = await PATCH(patch({ status: "active", confirmationDigest: "a".repeat(64), connectionGeneration: 4 }), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(409);
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("accepts a confirmation matching the current campaign and connection", async () => {
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const response = await PATCH(patch({ status: "active", confirmationDigest: confirmationDigest(), connectionGeneration: 4 }), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.updateCampaignStatus).toHaveBeenCalledWith("meta-campaign-1", "ACTIVE");
    expect(mocks.recheckMetaConnection).toHaveBeenCalledWith({ businessId: "business-1", userId: "user-1" }, 4);
    expect(mocks.verifyCampaignActivation).toHaveBeenCalledWith("meta-campaign-1", { dailyBudgetRupees: 500, status: "paused", adSetIds: ["set-1"], adIds: ["ad-1"], cappedAdSetIds: [] });
    expect(mocks.reserveCustomerCampaign.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateCampaignStatus.mock.invocationCallOrder[0]);
    expect(mocks.enforceCampaignSpendCap).toHaveBeenCalledWith("meta-campaign-1", 677966);
    expect(mocks.enforceCampaignSpendCap.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateCampaignStatus.mock.invocationCallOrder[0]);
    expect(mocks.confirmCustomerCampaign).toHaveBeenCalledWith({ businessId: "business-1", userId: "user-1" }, "campaign-1", "reservation-1", "active");
    expect(mocks.reserveCustomerCampaign.mock.calls[0][1].lifetimeCapPaise).toBeUndefined();
  });

  it("records Meta lifetime spend as cost evidence before reserving, without an operator (#216)", async () => {
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const response = await PATCH(patch({ status: "active", confirmationDigest: confirmationDigest(), connectionGeneration: 4 }), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.readLifetimeSpendPaise).toHaveBeenCalledWith("meta-campaign-1");
    expect(mocks.observeCustomerCosts).toHaveBeenCalledWith({ businessId: "business-1", userId: "user-1" }, {
      campaignId: "campaign-1", adAccountId: "act_123", connectionGeneration: 4, mediaPaise: 3263,
    });
    expect(mocks.observeCustomerCosts.mock.invocationCallOrder[0]).toBeLessThan(mocks.reserveCustomerCampaign.mock.invocationCallOrder[0]);
    expect(mocks.reserveCustomerCampaign.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateCampaignStatus.mock.invocationCallOrder[0]);
  });

  it("leaves the reserve as the gate when the Meta spend read fails (#216)", async () => {
    const { CustomerBalanceError } = await import("@/lib/payments/customer-balance");
    mocks.readLifetimeSpendPaise.mockRejectedValueOnce(new Error("Meta unavailable"));
    mocks.reserveCustomerCampaign.mockRejectedValueOnce(new CustomerBalanceError());
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const response = await PATCH(patch({ status: "active", confirmationDigest: confirmationDigest(), connectionGeneration: 4 }), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(409);
    expect(mocks.observeCustomerCosts).not.toHaveBeenCalled();
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("pauses the uncapped tree when saving active fails after Meta activation (#208)", async () => {
    mocks.saveCampaign.mockResolvedValueOnce({ error: new Error("guard rejected") });
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const response = await PATCH(patch({ status: "active", confirmationDigest: confirmationDigest(), connectionGeneration: 4 }), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(409);
    expect(mocks.pauseCampaignTree).toHaveBeenCalledWith("meta-campaign-1", { adSetIds: ["set-1"], adIds: ["ad-1"] });
    expect(mocks.confirmCustomerCampaign).toHaveBeenLastCalledWith(expect.anything(), "campaign-1", "reservation-1", "paused");
  });

  it("blocks direct activation when customer allowance is insufficient or held", async () => {
    const { CustomerBalanceError } = await import("@/lib/payments/customer-balance");
    mocks.reserveCustomerCampaign.mockRejectedValueOnce(new CustomerBalanceError());
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const response = await PATCH(patch({ status: "active", confirmationDigest: confirmationDigest(), connectionGeneration: 4 }), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(409);
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("retains an uncertain reservation after a lost provider activation result", async () => {
    mocks.updateCampaignStatus.mockRejectedValueOnce(new Error("Unconfirmed provider result"));
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const response = await PATCH(patch({ status: "active", confirmationDigest: confirmationDigest(), connectionGeneration: 4 }), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(500);
    expect(mocks.reserveCustomerCampaign).toHaveBeenCalledOnce();
    expect(mocks.confirmCustomerCampaign).toHaveBeenCalledWith(expect.anything(), "campaign-1", "reservation-1", "uncertain");
  });

  it("never activates if Meta cannot honor the customer-funded cap", async () => {
    mocks.enforceCampaignSpendCap.mockRejectedValueOnce(new Error("Minimum cap exceeds customer allowance"));
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const response = await PATCH(patch({ status: "active", confirmationDigest: confirmationDigest(), connectionGeneration: 4 }), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(500);
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
    expect(mocks.confirmCustomerCampaign).toHaveBeenCalledWith(expect.anything(), "campaign-1", "reservation-1", "uncertain");
  });

  it("allows pause with unavailable accounting and fences its confirmation to the original reservation", async () => {
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const response = await PATCH(patch({ status: "paused" }), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.getCustomerBalance.mock.invocationCallOrder[0]).toBeLessThan(mocks.pauseCampaignTree.mock.invocationCallOrder[0]);
    expect(mocks.confirmCustomerCampaign).toHaveBeenCalledWith({ businessId: "business-1", userId: "user-1" }, "campaign-1", "reservation-1", "paused");
    mocks.getCustomerBalance.mockRejectedValueOnce(new Error("Accounting unavailable"));
    expect((await PATCH(patch({ status: "paused" }), { params: Promise.resolve({ id: "campaign-1" }) })).status).toBe(200);
  });

  it.each(["getSpendLimits", "getCampaignSpend"] as const)("blocks activation when %s fails", async (query) => {
    mocks[query].mockRejectedValueOnce(new Error("database unavailable"));
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const response = await PATCH(patch({ status: "active", confirmationDigest: confirmationDigest(), connectionGeneration: 4 }), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(503);
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it.each([null, 0, -1, NaN, Infinity])("blocks capped activation when another active budget is %s", async dailyBudget => {
    mocks.getSpendLimits.mockResolvedValue({ weeklyCapRupees: 7000, alertPct: 80, autoPause: false });
    mocks.getCampaignSpend.mockResolvedValue([{ id: "other", status: "active", dailyBudget, spend: 0 }]);
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const response = await PATCH(patch({ status: "active", confirmationDigest: confirmationDigest(), connectionGeneration: 4 }), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(503);
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it.each([0, -1, NaN, Infinity])("does not interpret invalid cap %s as unlimited", async weeklyCapRupees => {
    mocks.getSpendLimits.mockResolvedValue({ weeklyCapRupees, alertPct: 80, autoPause: false });
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const response = await PATCH(patch({ status: "active", confirmationDigest: confirmationDigest(), connectionGeneration: 4 }), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(503);
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("allows pausing even when spend evidence cannot be loaded", async () => {
    mocks.getSpendLimits.mockRejectedValue(new Error("Unavailable"));
    mocks.getCampaignSpend.mockRejectedValue(new Error("Unavailable"));
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const response = await PATCH(patch({ status: "paused" }), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.getSpendLimits).not.toHaveBeenCalled();
    expect(mocks.getCampaignSpend).not.toHaveBeenCalled();
    expect(mocks.pauseCampaignTree).toHaveBeenCalledWith("meta-campaign-1", { adSetIds: ["set-1"], adIds: ["ad-1"] });
  });

  it("does not record a pause Meta did not confirm on the campaign", async () => {
    mocks.pauseCampaignTree.mockResolvedValueOnce({ confirmed: false, objects: [{ id: "meta-campaign-1", level: "campaign", status: "ACTIVE", effectiveStatus: "ACTIVE" }] });
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const response = await PATCH(patch({ status: "paused" }), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/Ads Manager/);
    expect(mocks.saveCampaign).not.toHaveBeenCalled();
    expect(mocks.confirmCustomerCampaign).not.toHaveBeenCalled();
  });

  it("does not activate when fresh provider verification fails", async () => {
    mocks.verifyCampaignActivation.mockRejectedValueOnce(new Error("Provider data changed"));
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const response = await PATCH(patch({ status: "active", confirmationDigest: confirmationDigest(), connectionGeneration: 4 }), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(500);
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("does not activate when fresh capability verification fails", async () => {
    mocks.recheckMetaConnection.mockRejectedValueOnce(new MockConnectionAccessError("Meta access changed"));
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const response = await PATCH(patch({ status: "active", confirmationDigest: confirmationDigest(), connectionGeneration: 4 }), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(409);
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("rejects a budget changed since confirmation", async () => {
    mocks.dailyBudget = 900;
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    const response = await PATCH(patch({ status: "active", confirmationDigest: confirmationDigest(), connectionGeneration: 4 }), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(409);
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("rejects a stale generation before any activation or legacy credential call", async () => {
    const stale = new MockConnectionAccessError("Meta connection changed; review again.");
    mocks.withMetaConnection.mockRejectedValue(stale);
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");

    const response = await PATCH(
      patch({ status: "active", confirmationDigest: "a".repeat(64), connectionGeneration: 3 }),
      { params: Promise.resolve({ id: "campaign-1" }) },
    );

    expect(response.status).toBe(409);
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
    expect(mocks.metaClientForBusiness).not.toHaveBeenCalled();
  });

  it("keeps pause compatible without requiring an activation confirmation", async () => {
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");

    const response = await PATCH(
      patch({ status: "paused" }),
      { params: Promise.resolve({ id: "campaign-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.pauseCampaignTree).toHaveBeenCalledWith("meta-campaign-1", { adSetIds: ["set-1"], adIds: ["ad-1"] });
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
    expect(mocks.recheckMetaConnection).not.toHaveBeenCalled();
    expect(mocks.verifyCampaignActivation).not.toHaveBeenCalled();
  });

  it("blocks unknown activation capability before the ACTIVE provider call", async () => {
    const unavailable = new MockConnectionAccessError("Meta has not confirmed campaign activation access.");
    unavailable.code = "UNAVAILABLE";
    mocks.withMetaConnection.mockImplementationOnce(async (_context, _options, execute) =>
      execute({ updateCampaignStatus: mocks.updateCampaignStatus }, {
        generation: 4,
        selected: { currency: "INR" },
        capabilities: { canActivate: { state: "unknown", blockers: [] } },
      }).catch(() => {
        throw unavailable;
      }),
    );
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");

    const response = await PATCH(
      patch({ status: "active", confirmationDigest: "a".repeat(64), connectionGeneration: 4 }),
      { params: Promise.resolve({ id: "campaign-1" }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("deletes through the stored binding instead of the legacy resolver", async () => {
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    mocks.withMetaConnection.mockImplementationOnce(async (_context, _options, execute) =>
      execute({ deleteObject }, {
        generation: 4,
        selected: { currency: "INR" },
        capabilities: { canActivate: { state: "available", blockers: [] } },
      }),
    );
    const { DELETE } = await import("@/app/api/campaigns/[id]/route");

    const response = await DELETE(
      new Request("http://localhost/api/campaigns/campaign-1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "campaign-1" }) },
    );

    expect(response.status).toBe(200);
    expect(deleteObject).toHaveBeenCalledWith("meta-campaign-1");
    expect(mocks.metaClientForBusiness).not.toHaveBeenCalled();
  });

  it("retains the local record when Meta deletion is unconfirmed", async () => {
    mocks.withMetaConnection.mockRejectedValueOnce(new Error("Provider timeout"));
    const { DELETE } = await import("@/app/api/campaigns/[id]/route");
    const response = await DELETE(new Request("http://localhost/api/campaigns/campaign-1", { method: "DELETE" }), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(502);
    expect(mocks.deleteCampaign).not.toHaveBeenCalled();
  });
});

describe("capped activation: the owner approves daily budget × days and Meta holds that total (#157)", () => {
  const capped = { adSetId: "capped-set", adIds: ["capped-ad"], lifetimeBudgetPaise: 150_000, endTime: "2026-10-25T06:00:00.000Z" };
  const pausedDelivery = {
    ...reviewedDelivery,
    adSets: reviewedDelivery.adSets.map(adSet => ({ ...adSet, status: "PAUSED" })),
    ads: reviewedDelivery.ads.map(ad => ({ ...ad, status: "PAUSED" })),
  };
  const selected = { metaBusinessId: null, adAccountId: "act_123", accountName: "Account", pageId: "page_123", pageName: "Page", currency: "INR", timezoneName: "Asia/Kolkata" };
  const digest = (capDays?: number) => createHash("sha256").update(activationConfirmationPayload(
    { id: "campaign-1", meta_campaign_id: "meta-campaign-1", daily_budget: 500, status: "paused" },
    { generation: 4, selected }, pausedDelivery, capDays,
  )).digest("hex");
  const activate = async (body: Record<string, unknown> = { capDays: 3, confirmationDigest: digest(3) }) => {
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    return PATCH(patch({ status: "active", connectionGeneration: 4, ...body }), { params: Promise.resolve({ id: "campaign-1" }) });
  };

  beforeEach(() => {
    mocks.readCampaignDelivery.mockResolvedValue(pausedDelivery);
    mocks.createCappedAdSet.mockResolvedValue(capped);
    mocks.activateCappedTree.mockResolvedValue({ campaign: { id: "meta-campaign-1", status: "ACTIVE", effectiveStatus: "ACTIVE" }, adSet: { ...capped, id: capped.adSetId, status: "ACTIVE", effectiveStatus: "IN_PROCESS", budgetRemainingPaise: 150_000 }, ads: [] });
  });

  it("caps ₹500 × 3 days on Meta, records the capped children before anything turns on, and never uses the campaign spend cap", async () => {
    const response = await activate();
    expect(response.status).toBe(200);
    expect((await response.json()).cap.adSet).toMatchObject({ lifetimeBudgetPaise: 150_000 });
    expect(mocks.createCappedAdSet).toHaveBeenCalledWith("meta-campaign-1", expect.objectContaining({
      sourceAdSetId: "set-1", sourceAdIds: ["ad-1"], lifetimeBudgetPaise: 150_000,
    }));
    const days = (mocks.createCappedAdSet.mock.calls[0][1].endTime.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(2.99);
    expect(days).toBeLessThanOrEqual(3);
    expect(mocks.saveCampaign.mock.calls[0][1]).toMatchObject({
      meta_ad_ids: ["ad-1", "capped-ad"],
      raw: { metaResult: { adSetIds: ["set-1", "capped-set"], adIds: ["ad-1", "capped-ad"] }, cap: { ...capped, days: 3 } },
    });
    expect(mocks.saveCampaign.mock.invocationCallOrder[0]).toBeLessThan(mocks.activateCappedTree.mock.invocationCallOrder[0]);
    expect(mocks.reserveCustomerCampaign.mock.invocationCallOrder[0]).toBeLessThan(mocks.createCappedAdSet.mock.invocationCallOrder[0]);
    expect(mocks.activateCappedTree).toHaveBeenCalledWith("meta-campaign-1", capped);
    expect(mocks.enforceCampaignSpendCap).not.toHaveBeenCalled();
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
    // #208: the reservation is bounded by the Meta lifetime budget, not 7 × daily.
    expect(mocks.reserveCustomerCampaign).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ lifetimeCapPaise: 150000 }));
    expect(mocks.confirmCustomerCampaign).toHaveBeenCalledWith(expect.anything(), "campaign-1", "reservation-1", "active");
    expect(mocks.saveCampaign).toHaveBeenLastCalledWith(expect.anything(), { status: "active" }, "campaign-1");
  });

  it("rejects a digest reviewed for a different number of days", async () => {
    expect((await activate({ capDays: 7, confirmationDigest: digest(3) })).status).toBe(409);
    expect((await activate({ capDays: 3, confirmationDigest: digest() })).status).toBe(409);
    expect(mocks.reserveCustomerCampaign).not.toHaveBeenCalled();
    expect(mocks.createCappedAdSet).not.toHaveBeenCalled();
  });

  it.each([0, 8, 2.5])("rejects %s days", async capDays => {
    expect((await activate({ capDays, confirmationDigest: digest(3) })).status).toBe(400);
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
  });

  it("refuses while an original ad set or ad is still on in Meta, before reserving", async () => {
    mocks.readCampaignDelivery.mockResolvedValue(reviewedDelivery);
    const response = await activate();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/Pause the reviewed ad sets and ads/);
    expect(mocks.reserveCustomerCampaign).not.toHaveBeenCalled();
  });

  it("refuses a total above the customer's available media funds without creating anything", async () => {
    mocks.reserveCustomerCampaign.mockResolvedValueOnce({ reservationId: "reservation-1", mediaLimitPaise: 149_999 });
    expect((await activate()).status).toBe(409);
    expect(mocks.createCappedAdSet).not.toHaveBeenCalled();
    expect(mocks.confirmCustomerCampaign).toHaveBeenCalledWith(expect.anything(), "campaign-1", "reservation-1", "uncertain");
  });

  it("does not turn anything on when the capped children cannot be recorded", async () => {
    mocks.saveCampaign.mockResolvedValueOnce({ error: new Error("write failed") });
    expect((await activate()).status).toBe(409);
    expect(mocks.activateCappedTree).not.toHaveBeenCalled();
    expect(mocks.confirmCustomerCampaign).toHaveBeenCalledWith(expect.anything(), "campaign-1", "reservation-1", "uncertain");
  });

  it("pauses the whole tree, including the capped copy, when activation is not confirmed", async () => {
    const { CampaignDeliveryError } = await import("@/lib/meta/client");
    mocks.activateCappedTree.mockRejectedValueOnce(new CampaignDeliveryError("Meta did not confirm the capped activation."));
    const response = await activate();
    expect(response.status).toBe(409);
    expect(mocks.pauseCampaignTree).toHaveBeenCalledWith("meta-campaign-1", { adSetIds: ["set-1", "capped-set"], adIds: ["ad-1", "capped-ad"] });
    expect(mocks.confirmCustomerCampaign).toHaveBeenCalledWith(expect.anything(), "campaign-1", "reservation-1", "uncertain");
    expect(mocks.saveCampaign).not.toHaveBeenCalledWith(expect.anything(), { status: "active" }, "campaign-1");
  });

  it("pauses Meta and records paused when saving active fails after activation (#208)", async () => {
    mocks.saveCampaign.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: new Error("guard rejected") });
    const response = await activate();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/paused again in Meta/);
    expect(mocks.pauseCampaignTree).toHaveBeenCalledWith("meta-campaign-1", { adSetIds: ["set-1", "capped-set"], adIds: ["ad-1", "capped-ad"] });
    expect(mocks.activateCappedTree.mock.invocationCallOrder[0]).toBeLessThan(mocks.pauseCampaignTree.mock.invocationCallOrder[0]);
    expect(mocks.confirmCustomerCampaign).toHaveBeenLastCalledWith(expect.anything(), "campaign-1", "reservation-1", "paused");
    expect(mocks.saveCampaign).toHaveBeenCalledTimes(2);
  });

  it("keeps the reservation uncertain when the compensating pause is not confirmed (#208)", async () => {
    mocks.saveCampaign.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: new Error("guard rejected") });
    mocks.pauseCampaignTree.mockRejectedValueOnce(new Error("Meta down"));
    const response = await activate();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/Pause the campaign in Ads Manager now/);
    expect(mocks.confirmCustomerCampaign).toHaveBeenLastCalledWith(expect.anything(), "campaign-1", "reservation-1", "uncertain");
  });

  it("after one capped run, reviews the stored capped set and copies only the original ads into the next capped run (#197)", async () => {
    mocks.storedAdSetIds = ["set-1", "capped-set"];
    mocks.storedAdIds = ["ad-1", "capped-ad"];
    mocks.storedCap = { cap: { ...capped, days: 3 } };
    const rerunDelivery = {
      ...pausedDelivery,
      adSets: [...pausedDelivery.adSets, { ...pausedDelivery.adSets[0], id: "capped-set", dailyBudgetPaise: 0 }],
      ads: [...pausedDelivery.ads, { ...pausedDelivery.ads[0], id: "capped-ad", adSetId: "capped-set" }],
    };
    mocks.readCampaignDelivery.mockResolvedValue(rerunDelivery);
    const next = { adSetId: "capped-set-2", adIds: ["capped-ad-2"], lifetimeBudgetPaise: 100_000, endTime: "2026-10-24T06:00:00.000Z" };
    mocks.createCappedAdSet.mockResolvedValue(next);
    const rerunDigest = createHash("sha256").update(activationConfirmationPayload(
      { id: "campaign-1", meta_campaign_id: "meta-campaign-1", daily_budget: 500, status: "paused" },
      { generation: 4, selected }, rerunDelivery, 2,
    )).digest("hex");

    expect((await activate({ capDays: 2, confirmationDigest: rerunDigest })).status).toBe(200);
    expect(mocks.readCampaignDelivery).toHaveBeenCalledWith("meta-campaign-1", expect.objectContaining({
      adSetIds: ["set-1", "capped-set"], adIds: ["ad-1", "capped-ad"], cappedAdSetIds: ["capped-set"],
    }));
    expect(mocks.createCappedAdSet).toHaveBeenCalledWith("meta-campaign-1", expect.objectContaining({
      sourceAdSetId: "set-1", sourceAdIds: ["ad-1"], lifetimeBudgetPaise: 100_000,
    }));
    expect(mocks.saveCampaign.mock.calls[0][1]).toMatchObject({
      meta_ad_ids: ["ad-1", "capped-ad", "capped-ad-2"],
      raw: {
        metaResult: { adSetIds: ["set-1", "capped-set", "capped-set-2"], adIds: ["ad-1", "capped-ad", "capped-ad-2"] },
        cap: { ...next, days: 2 }, cappedAdSetIds: ["capped-set", "capped-set-2"],
      },
    });
    expect(mocks.activateCappedTree).toHaveBeenCalledWith("meta-campaign-1", next);
  });

  it("pause after a capped run stops the original and every capped child", async () => {
    mocks.storedAdSetIds = ["set-1", "capped-set"];
    mocks.storedAdIds = ["ad-1", "capped-ad"];
    mocks.storedCap = { cap: { ...capped, days: 3 } };
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    expect((await PATCH(patch({ status: "paused" }), { params: Promise.resolve({ id: "campaign-1" }) })).status).toBe(200);
    expect(mocks.pauseCampaignTree).toHaveBeenCalledWith("meta-campaign-1", { adSetIds: ["set-1", "capped-set"], adIds: ["ad-1", "capped-ad"] });
  });

  describe("operator-funded business: Meta-side cap only, no AdBrain payment (#245)", () => {
    const roomy = { spendCapPaise: 204237, amountSpentPaise: 4237, roomPaise: 200000, prepay: true };
    const metaWrites = () => [mocks.createCappedAdSet, mocks.activateCappedTree, mocks.updateCampaignStatus, mocks.enforceCampaignSpendCap];

    beforeEach(() => {
      mocks.isOperatorFunded.mockResolvedValue(true);
      mocks.readAccountFunding.mockResolvedValue(roomy);
    });

    it("activates the capped tree with no reservation or cost evidence when Meta's room covers the cap", async () => {
      expect((await activate()).status).toBe(200);
      expect(mocks.readAccountFunding.mock.invocationCallOrder[0]).toBeLessThan(mocks.createCappedAdSet.mock.invocationCallOrder[0]);
      expect(mocks.createCappedAdSet).toHaveBeenCalledWith("meta-campaign-1", expect.objectContaining({ lifetimeBudgetPaise: 150_000 }));
      expect(mocks.activateCappedTree).toHaveBeenCalledWith("meta-campaign-1", capped);
      expect(mocks.reserveCustomerCampaign).not.toHaveBeenCalled();
      expect(mocks.confirmCustomerCampaign).not.toHaveBeenCalled();
      expect(mocks.readLifetimeSpendPaise).not.toHaveBeenCalled();
      expect(mocks.observeCustomerCosts).not.toHaveBeenCalled();
      expect(mocks.saveCampaign).toHaveBeenLastCalledWith(expect.anything(), { status: "active" }, "campaign-1");
    });

    it("refuses when Meta's room is below the cap, before any Meta write", async () => {
      mocks.readAccountFunding.mockResolvedValue({ spendCapPaise: 88983, amountSpentPaise: 4237, roomPaise: 84746, prepay: true });
      const response = await activate();
      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/Meta has ₹847\.46 left .* this run needs ₹1,500\.00/);
      for (const write of metaWrites()) expect(write).not.toHaveBeenCalled();
      expect(mocks.saveCampaign).not.toHaveBeenCalled();
    });

    it("refuses when the ad account has no spending limit", async () => {
      mocks.readAccountFunding.mockResolvedValue({ spendCapPaise: 0, amountSpentPaise: 4237, roomPaise: 0, prepay: false });
      const response = await activate();
      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/Set a spending limit on the Meta ad account/);
      for (const write of metaWrites()) expect(write).not.toHaveBeenCalled();
    });

    it("refuses an uncapped activation before reading funds or writing to Meta", async () => {
      mocks.readCampaignDelivery.mockResolvedValue(reviewedDelivery);
      const uncapped = createHash("sha256").update(activationConfirmationPayload(
        { id: "campaign-1", meta_campaign_id: "meta-campaign-1", daily_budget: 500, status: "paused" },
        { generation: 4, selected }, reviewedDelivery,
      )).digest("hex");
      const response = await activate({ confirmationDigest: uncapped });
      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/runs only with a total limit/);
      expect(mocks.readAccountFunding).not.toHaveBeenCalled();
      for (const write of metaWrites()) expect(write).not.toHaveBeenCalled();
      expect(mocks.reserveCustomerCampaign).not.toHaveBeenCalled();
    });

    it("pauses Meta again when saving active fails, with no reservation to confirm", async () => {
      mocks.saveCampaign.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: new Error("write failed") });
      const response = await activate();
      expect(response.status).toBe(409);
      expect(mocks.pauseCampaignTree).toHaveBeenCalledWith("meta-campaign-1", { adSetIds: ["set-1", "capped-set"], adIds: ["ad-1", "capped-ad"] });
      expect(mocks.confirmCustomerCampaign).not.toHaveBeenCalled();
    });

    it("refuses activation when operator funding cannot be verified", async () => {
      mocks.isOperatorFunded.mockRejectedValue(new Error("database unavailable"));
      expect((await activate()).status).toBe(503);
      expect(mocks.withMetaConnection).not.toHaveBeenCalled();
    });

    it("keeps a customer business gated by its reservation and never reads Meta funding", async () => {
      mocks.isOperatorFunded.mockResolvedValue(false);
      expect((await activate()).status).toBe(200);
      expect(mocks.reserveCustomerCampaign).toHaveBeenCalled();
      expect(mocks.readAccountFunding).not.toHaveBeenCalled();
    });

    it("shows the live Meta funding in the review only for an operator-funded business", async () => {
      const { GET } = await import("@/app/api/campaigns/[id]/route");
      const review = () => GET(new Request("http://localhost/api/campaigns/campaign-1"), { params: Promise.resolve({ id: "campaign-1" }) });
      const learning = { costPerResultRupees: null, pausedAt: null };
      expect(await (await review()).json()).toEqual({ delivery: pausedDelivery, funding: roomy, learning });
      mocks.isOperatorFunded.mockResolvedValue(false);
      expect(await (await review()).json()).toEqual({ delivery: pausedDelivery, learning });
      expect(mocks.readAccountFunding).toHaveBeenCalledTimes(1);
    });
  });
});