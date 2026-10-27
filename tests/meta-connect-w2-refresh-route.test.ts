import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  requireOwnedBusiness: vi.fn(),
  withMetaConnection: vi.fn(),
  metaClientForBusiness: vi.fn(),
  summarizeInsights: vi.fn(),
  enforceAutoPauseWithStatus: vi.fn(),
  logEvent: vi.fn(),
  saveResult: vi.fn(),
  readAdReview: vi.fn(),
  getAdResults: vi.fn(),
  upsert: vi.fn(),
}));

const campaign = {
  id: "campaign-1",
  business_id: "business-1",
  meta_campaign_id: "meta-campaign-1",
  objective: "leads",
  name: "Campaign",
  daily_budget: 500,
  status: "paused",
  meta_ad_account_id: "act_123" as string | null,
  meta_page_id: "page_123",
  meta_connection_generation: 4,
};

vi.mock("@/lib/campaign/trusted-write", () => ({ saveCampaignResult: mocks.saveResult }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: (table: string) => {
      if (table === "campaigns") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: campaign }) }),
          }),
        };
      }
      return {
        insert: () => ({
          select: () => ({ single: mocks.saveResult }),
        }),
      };
    },
  }),
}));
vi.mock("@/lib/meta/connection-access", () => ({
  ConnectionAccessError: class ConnectionAccessError extends Error {
    code = "CONFLICT";
  },
  requireOwnedBusiness: mocks.requireOwnedBusiness,
  withMetaConnection: mocks.withMetaConnection,
}));
vi.mock("@/lib/meta/credentials", () => ({ metaClientForBusiness: mocks.metaClientForBusiness }));
vi.mock("@/lib/creative/summary", () => ({ summarizeInsights: mocks.summarizeInsights }));
vi.mock("@/lib/campaign/spend-enforce", () => ({ enforceAutoPauseWithStatus: mocks.enforceAutoPauseWithStatus }));
vi.mock("@/lib/audit", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => ({ upsert: (rows: unknown, options: unknown) => mocks.upsert(table, rows, options) }) }) }));

function request(): Request {
  return new Request("http://localhost/api/campaigns/campaign-1/refresh", { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.requireOwnedBusiness.mockResolvedValue({ businessId: "business-1", userId: "user-1" });
  mocks.withMetaConnection.mockImplementation(async (_context, _options, execute) =>
    execute({
      getCampaignInsights: vi.fn().mockResolvedValue({ impressions: 1, clicks: 2, leads: 1, spend: 3, cpl: 3 }),
      readAdReview: mocks.readAdReview,
      getAdResults: mocks.getAdResults,
    }),
  );
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.getAdResults.mockResolvedValue([{ adId: "120253710068180526", name: "Lower bills", effectiveStatus: "ACTIVE", creativeId: "1", delivered: true, impressions: 1, clicks: 2, spend: 3, results: 1, costPerResult: 3, replaced: false }]);
  vi.unstubAllEnvs();
  mocks.readAdReview.mockResolvedValue([{ adId: "ad-1", state: "in_review", effectiveStatus: "IN_PROCESS", reasons: [] }]);
  mocks.summarizeInsights.mockResolvedValue("Summary");
  mocks.enforceAutoPauseWithStatus.mockResolvedValue({ paused: [], confirmed: true });
  mocks.saveResult.mockResolvedValue({ data: { id: "result-1" }, error: null });
});

describe("campaign refresh binding boundary", () => {
  it("runs spend enforcement and audit without waiting for the optional summary", async () => {
    let resolveSummary!: (summary: string) => void;
    mocks.summarizeInsights.mockReturnValue(new Promise<string>(resolve => { resolveSummary = resolve; }));
    const { POST } = await import("@/app/api/campaigns/[id]/refresh/route");
    const response = POST(request(), { params: Promise.resolve({ id: "campaign-1" }) });
    await vi.waitFor(() => expect(mocks.enforceAutoPauseWithStatus).toHaveBeenCalledWith("business-1"));
    expect(mocks.logEvent).toHaveBeenCalled();
    resolveSummary("Summary");
    expect((await response).status).toBe(200);
  });

  it("does not summarize or enforce against an unsaved result", async () => {
    mocks.saveResult.mockResolvedValue({ data: null, error: { message: "Private database error" } });
    const { POST } = await import("@/app/api/campaigns/[id]/refresh/route");
    const response = await POST(request(), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(503);
    expect(mocks.summarizeInsights).not.toHaveBeenCalled();
    expect(mocks.enforceAutoPauseWithStatus).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("Private database error");
  });

  it("uses the stored account, page, and generation for insight reads", async () => {
    const { POST } = await import("@/app/api/campaigns/[id]/refresh/route");
    const response = await POST(request(), { params: Promise.resolve({ id: "campaign-1" }) });

    expect(response.status).toBe(200);
    expect(mocks.withMetaConnection).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: "business-1" }),
      {
        purpose: "read_insights",
        binding: { adAccountId: "act_123", pageId: "page_123" },
        expectedGeneration: 4,
      },
      expect.any(Function),
    );
    expect(mocks.metaClientForBusiness).not.toHaveBeenCalled();
    // #649: the summary names the campaign, not its objective.
    expect(mocks.summarizeInsights).toHaveBeenCalledWith("Campaign", expect.objectContaining({ impressions: 1 }));
  });

  it("keeps refreshed results distinct from unconfirmed spend protection", async () => {
    mocks.enforceAutoPauseWithStatus.mockResolvedValue({ paused: ["campaign-1"], confirmed: false });
    const { POST } = await import("@/app/api/campaigns/[id]/refresh/route");
    const response = await POST(request(), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ autoPaused: ["campaign-1"], protectionConfirmed: false });
  });

  it("returns Meta's ad review status, and still refreshes results when the review read fails", async () => {
    const { POST } = await import("@/app/api/campaigns/[id]/refresh/route");
    expect(await (await POST(request(), { params: Promise.resolve({ id: "campaign-1" }) })).json())
      .toMatchObject({ review: [{ adId: "ad-1", state: "in_review" }] });
    mocks.readAdReview.mockRejectedValueOnce(new Error("Meta review read failed"));
    const response = await POST(request(), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { id: "result-1" }, review: null });
  });

  it("still attempts protective enforcement when the provider read fails", async () => {
    mocks.withMetaConnection.mockRejectedValueOnce(new Error("Meta reporting unavailable"));
    mocks.enforceAutoPauseWithStatus.mockResolvedValue({ paused: ["campaign-1"], confirmed: false });
    const { POST } = await import("@/app/api/campaigns/[id]/refresh/route");
    const response = await POST(request(), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ autoPaused: ["campaign-1"], protectionConfirmed: false });
    expect(mocks.enforceAutoPauseWithStatus).toHaveBeenCalledWith("business-1");
    expect(mocks.saveResult).not.toHaveBeenCalled();
  });

  it("blocks an old row without binding before any provider access", async () => {
    const { POST } = await import("@/app/api/campaigns/[id]/refresh/route");
    const original = campaign.meta_ad_account_id;
    campaign.meta_ad_account_id = null;

    const response = await POST(request(), { params: Promise.resolve({ id: "campaign-1" }) });

    campaign.meta_ad_account_id = original;
    expect(response.status).toBe(409);
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
    expect(mocks.metaClientForBusiness).not.toHaveBeenCalled();
  });

  // #783: per-ad results ride along on a refresh only behind AD_RESULTS_ENABLED, and never fail it.
  it("stores per-ad results with the refresh when enabled, and never reads them when off", async () => {
    const { POST } = await import("@/app/api/campaigns/[id]/refresh/route");
    await POST(request(), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(mocks.getAdResults).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    vi.stubEnv("AD_RESULTS_ENABLED", "true");
    const response = await POST(request(), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.getAdResults).toHaveBeenCalledWith("meta-campaign-1");
    expect(mocks.upsert).toHaveBeenCalledWith("ad_results", [expect.objectContaining({
      business_id: "business-1", campaign_id: "campaign-1", meta_ad_id: "120253710068180526", ad_name: "Lower bills", effective_status: "ACTIVE",
      period_start: null, period_end: null, delivered: true, leads: 1, spend_paise: 300,
    })], { onConflict: "campaign_id,meta_ad_id,period_start,period_end" });
  });

  it("still refreshes the campaign when the per-ad read or save fails", async () => {
    vi.stubEnv("AD_RESULTS_ENABLED", "true");
    const { POST } = await import("@/app/api/campaigns/[id]/refresh/route");
    mocks.getAdResults.mockRejectedValueOnce(new Error("Meta per-ad read failed"));
    const failedRead = await POST(request(), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(failedRead.status).toBe(200);
    expect(mocks.upsert).not.toHaveBeenCalled();
    mocks.upsert.mockResolvedValueOnce({ error: { message: "relation does not exist" } });
    const failedSave = await POST(request(), { params: Promise.resolve({ id: "campaign-1" }) });
    expect(failedSave.status).toBe(200);
    expect(await failedSave.json()).toMatchObject({ result: { id: "result-1" } });
  });
});