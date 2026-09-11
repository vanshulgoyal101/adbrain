import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activationConfirmationPayload } from "@/lib/campaign/activation";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  requireOwnedBusiness: vi.fn(),
  withMetaConnection: vi.fn(),
  metaClientForBusiness: vi.fn(),
  getSpendLimits: vi.fn(),
  getCampaignSpend: vi.fn(),
  updateCampaignStatus: vi.fn(),
  verifyCampaignActivation: vi.fn(),
  recheckMetaConnection: vi.fn(),
  deleteCampaign: vi.fn(),
  dailyBudget: 500,
}));

class MockConnectionAccessError extends Error {
  code: "CONFLICT" | "UNAVAILABLE" = "CONFLICT";
}

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

function patch(body: unknown): Request {
  return new Request("http://localhost/api/campaigns/campaign-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dailyBudget = 500;
  mocks.verifyCampaignActivation.mockResolvedValue(undefined);
  mocks.recheckMetaConnection.mockResolvedValue(undefined);
  mocks.deleteCampaign.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.requireOwnedBusiness.mockResolvedValue({ businessId: "business-1", userId: "user-1" });
  mocks.getSpendLimits.mockResolvedValue({ weeklyCapRupees: null, alertPct: 80, autoPause: false });
  mocks.getCampaignSpend.mockResolvedValue([]);
  mocks.withMetaConnection.mockImplementation(async (_context, _options, execute) =>
    execute({ updateCampaignStatus: mocks.updateCampaignStatus, verifyCampaignActivation: mocks.verifyCampaignActivation }, {
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
  )).digest("hex");

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
    expect(mocks.verifyCampaignActivation).toHaveBeenCalledWith("meta-campaign-1", { dailyBudgetRupees: 500, status: "paused" });
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
    mocks.metaClientForBusiness.mockResolvedValue({ updateCampaignStatus: mocks.updateCampaignStatus });
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");

    const response = await PATCH(
      patch({ status: "paused" }),
      { params: Promise.resolve({ id: "campaign-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.updateCampaignStatus).toHaveBeenCalledWith("meta-campaign-1", "PAUSED");
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