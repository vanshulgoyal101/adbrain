import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventContext, newEventContext, observeIdentity, observeVerifiedUser } from "@/lib/observability/context";

/**
 * Server-side library behaviour that guards money and data:
 * - audit logging must never break the operation it records
 * - auto-pause must only fire under the exact configured conditions
 * - creative generation must clamp what it asks the (paid) providers for
 * - image persistence must degrade to the source URL rather than lose an image
 */

const getUser = vi.fn();
const insert = vi.fn();
const auditAbortSignal = vi.fn();
const updateEq = vi.fn();
const updateCampaignStatus = vi.fn();
const metaClientForBusiness = vi.fn();
const requireOwnedBusiness = vi.fn();
const withMetaConnection = vi.fn();
const getCampaigns = vi.fn();
const getCampaignInsights = vi.fn();
const getSpendLimits = vi.fn();
const getCustomerBalance = vi.fn();
const confirmCustomerCampaign = vi.fn();

vi.mock("@/lib/payments/customer-balance", () => ({ getCustomerBalance, confirmCustomerCampaign }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: insert }) }));
vi.mock("@/lib/campaign/trusted-write", () => ({ saveCampaign: (...args: unknown[]) => updateEq(...args) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      insert,
      update: () => ({ eq: updateEq }),
    }),
  }),
}));
vi.mock("@/lib/meta/credentials", () => ({ metaClientForBusiness }));
vi.mock("@/lib/meta/connection-access", () => ({
  ConnectionAccessError: class ConnectionAccessError extends Error {},
  requireOwnedBusiness,
  withMetaConnection,
}));
vi.mock("@/lib/supabase/queries", () => ({
  getCampaigns,
  getSpendLimits,
}));

const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
}).formatToParts(new Date());
const part = (type: string) => parts.find(value => value.type === type)?.value;
const periodEnd = `${part("year")}-${part("month")}-${part("day")}`;
const monday = new Date(`${periodEnd}T00:00:00Z`);
monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
const periodStart = monday.toISOString().slice(0, 10);

beforeEach(() => {
  vi.clearAllMocks();
  getCustomerBalance.mockResolvedValue({ held: false, reservations: [] });
  confirmCustomerCampaign.mockResolvedValue(undefined);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  getUser.mockResolvedValue({ data: { user: { id: "u1", email: "o@x.com" } } });
  insert.mockReturnValue({ abortSignal: auditAbortSignal });
  auditAbortSignal.mockResolvedValue({ error: null });
  updateEq.mockResolvedValue({ error: null });
  updateCampaignStatus.mockResolvedValue(undefined);
  getCampaignInsights.mockResolvedValue({ spend: 0, periodStart, periodEnd });
  metaClientForBusiness.mockResolvedValue({ updateCampaignStatus });
  requireOwnedBusiness.mockResolvedValue({ businessId: "b1", userId: "u1" });
  withMetaConnection.mockImplementation(async (_context, _options, execute) =>
    execute({ updateCampaignStatus, getCampaignInsights }, {
      generation: 3,
      selected: {
        metaBusinessId: null,
        adAccountId: "act_1",
        accountName: "Account",
        pageId: "page_1",
        pageName: "Page",
        currency: "INR",
        timezoneName: "Asia/Kolkata",
      },
      capabilities: { canActivate: { state: "available", blockers: [] } },
    }),
  );
});

describe("logEvent", () => {
  it("reuses only the actor verified in this request without repeating authentication", async () => {
    const { logEvent } = await import("@/lib/audit");
    await eventContext.run(newEventContext(), async () => {
      observeVerifiedUser({ id: "verified-owner", email: "verified@example.test" });
      await logEvent({ businessId: "b1", action: "x", entityType: "creative" });
      expect(getUser).not.toHaveBeenCalled();
      expect(insert).toHaveBeenCalledWith("append_verified_audit_event", expect.objectContaining({ p_actor_id: "verified-owner" }));
      observeIdentity(null);
      await logEvent({ businessId: "b1", action: "x", entityType: "creative" });
      expect(getUser).toHaveBeenCalledOnce();
    });
    getUser.mockClear();
    await eventContext.run(newEventContext(), () => logEvent({ businessId: "b1", action: "x", entityType: "creative" }));
    expect(getUser).toHaveBeenCalledOnce();
  });

  it("records who did what, with the actor from the session", async () => {
    const { logEvent } = await import("@/lib/audit");
    await logEvent({
      businessId: "b1",
      action: "campaign.create",
      entityType: "campaign",
      entityId: "c1",
    });
    expect(insert).toHaveBeenCalledWith(
      "append_verified_audit_event",
      expect.objectContaining({
        p_business_id: "b1",
        p_action: "campaign.create",
        p_entity_type: "campaign",
        p_entity_id: "c1",
        p_actor_id: "u1",
        p_details: {},
      }),
    );
  });

  it("does not invent a system actor when there is no session", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { logEvent } = await import("@/lib/audit");
    await logEvent({ businessId: "b1", action: "cron.sync", entityType: "campaign" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("never throws when the insert fails — logging must not break the caller", async () => {
    auditAbortSignal.mockRejectedValue(new Error("db down"));
    const { logEvent } = await import("@/lib/audit");
    await expect(
      logEvent({ businessId: "b1", action: "x", entityType: "campaign" }),
    ).resolves.toBeUndefined();
  });

  it("never throws when the client itself blows up", async () => {
    getUser.mockRejectedValue(new Error("no session"));
    const { logEvent } = await import("@/lib/audit");
    await expect(
      logEvent({ businessId: "b1", action: "x", entityType: "campaign" }),
    ).resolves.toBeUndefined();
  });
});

describe("enforceAutoPause", () => {
  const campaign = (over: Record<string, unknown> = {}) => ({
    id: "c1",
    status: "active",
    daily_budget: 500,
    meta_campaign_id: "meta-1",
    meta_ad_account_id: "act_1",
    meta_page_id: "page_1",
    meta_connection_generation: 3,
    ...over,
  });

  const setup = (opts: {
    autoPause: boolean;
    cap: number | null;
    spend: number;
    campaigns?: Record<string, unknown>[];
  }) => {
    getSpendLimits.mockResolvedValue({
      weeklyCapRupees: opts.cap,
      alertPct: 80,
      autoPause: opts.autoPause,
    });
    const list = opts.campaigns ?? [campaign()];
    getCampaigns.mockResolvedValue(list);
    getCampaignInsights.mockResolvedValue({ spend: opts.spend, periodStart, periodEnd });
  };

  it("does nothing when auto-pause is off", async () => {
    setup({ autoPause: false, cap: 7000, spend: 9000 });
    const { enforceAutoPause } = await import("@/lib/campaign/spend-enforce");
    await expect(enforceAutoPause("b1")).resolves.toEqual([]);
    expect(updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("pauses held customer funds even when the optional weekly guard is off", async () => {
    setup({ autoPause: false, cap: null, spend: 100 });
    getCampaignInsights.mockRejectedValue(new Error("Reporting unavailable"));
    getCustomerBalance.mockResolvedValue({ held: true, reservations: [{ campaignId: "c1", reservationId: "r1", state: "active" }] });
    const { enforceAutoPause } = await import("@/lib/campaign/spend-enforce");
    await expect(enforceAutoPause("b1")).resolves.toEqual(["c1"]);
    expect(confirmCustomerCampaign).toHaveBeenCalledWith({ businessId: "b1", userId: "u1" }, "c1", "r1", "paused");
    expect(getCampaignInsights).not.toHaveBeenCalled();
  });

  it("does not treat unavailable customer costs as zero spend", async () => {
    setup({ autoPause: false, cap: null, spend: 0 });
    getCustomerBalance.mockRejectedValueOnce(new Error("Cost reconciliation unavailable"));
    const { enforceAutoPause } = await import("@/lib/campaign/spend-enforce");
    await expect(enforceAutoPause("b1")).resolves.toEqual(["c1"]);
    expect(confirmCustomerCampaign).not.toHaveBeenCalled();
  });

  it("does nothing when there is no cap", async () => {
    setup({ autoPause: true, cap: null, spend: 9000 });
    const { enforceAutoPause } = await import("@/lib/campaign/spend-enforce");
    await expect(enforceAutoPause("b1")).resolves.toEqual([]);
    expect(updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("does nothing while spend is under the cap", async () => {
    setup({ autoPause: true, cap: 7000, spend: 100 });
    const { enforceAutoPauseWithStatus } = await import("@/lib/campaign/spend-enforce");
    const outcome = await enforceAutoPauseWithStatus("b1");
    expect(getCampaignInsights).toHaveBeenCalledWith("meta-1", { weekly: true });
    expect(outcome).toEqual({ paused: [], confirmed: true });
    expect(updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("does not pause a funded active campaign because an unrelated draft has no Meta ID", async () => {
    setup({ autoPause: true, cap: 7000, spend: 100, campaigns: [
      campaign(),
      campaign({ id: "draft", status: "draft", meta_campaign_id: null }),
    ] });
    const { enforceAutoPauseWithStatus } = await import("@/lib/campaign/spend-enforce");
    await expect(enforceAutoPauseWithStatus("b1")).resolves.toEqual({ paused: [], confirmed: true });
    expect(updateCampaignStatus).not.toHaveBeenCalled();
  });

  it.each(["draft", "paused"])("counts spend from a launched %s campaign", async status => {
    setup({ autoPause: true, cap: 7000, spend: 0, campaigns: [
      campaign(),
      campaign({ id: "other", status, meta_campaign_id: "meta-other" }),
    ] });
    getCampaignInsights.mockImplementation(async (id: string) => ({
      spend: id === "meta-other" ? 6900 : 100, periodStart, periodEnd,
    }));
    const { enforceAutoPauseWithStatus } = await import("@/lib/campaign/spend-enforce");
    await expect(enforceAutoPauseWithStatus("b1")).resolves.toEqual({ paused: ["c1"], confirmed: true });
    expect(getCampaignInsights).toHaveBeenCalledWith("meta-other", { weekly: true });
  });

  it("fails closed when an active campaign has no Meta ID", async () => {
    setup({ autoPause: true, cap: 7000, spend: 100, campaigns: [
      campaign(),
      campaign({ id: "other", status: "active", meta_campaign_id: null }),
    ] });
    const { enforceAutoPauseWithStatus } = await import("@/lib/campaign/spend-enforce");
    await expect(enforceAutoPauseWithStatus("b1")).resolves.toEqual({ paused: ["c1"], confirmed: false });
    expect(updateCampaignStatus).toHaveBeenCalledWith("meta-1", "PAUSED");
  });

  it("does not treat a missing active spend observation as zero", async () => {
    setup({ autoPause: true, cap: 7000, spend: 100 });
    getCampaignInsights.mockResolvedValue({ spend: 0, periodStart: null, periodEnd: null });
    const { enforceAutoPauseWithStatus } = await import("@/lib/campaign/spend-enforce");
    await expect(enforceAutoPauseWithStatus("b1")).resolves.toEqual({ paused: ["c1"], confirmed: false });
    expect(updateCampaignStatus).toHaveBeenCalledWith("meta-1", "PAUSED");
  });

  it.each([
    ["stale", { spend: 100, periodStart: "2020-01-01", periodEnd: "2020-01-07" }],
    ["partial", { spend: 100, periodStart, periodEnd: null }],
    ["invalid", { spend: Number.NaN, periodStart, periodEnd }],
  ])("pauses rather than trusting %s weekly insights", async (_label, insights) => {
    setup({ autoPause: true, cap: 7000, spend: 100 });
    getCampaignInsights.mockResolvedValue(insights);
    const { enforceAutoPauseWithStatus } = await import("@/lib/campaign/spend-enforce");
    await expect(enforceAutoPauseWithStatus("b1")).resolves.toEqual({ paused: ["c1"], confirmed: false });
  });

  it("does not trust an account whose currency is not rupees", async () => {
    setup({ autoPause: true, cap: 7000, spend: 100 });
    withMetaConnection.mockImplementation(async (_context, _options, execute) => execute(
      { updateCampaignStatus, getCampaignInsights },
      { selected: { currency: "USD", timezoneName: "Asia/Kolkata" } },
    ));
    const { enforceAutoPauseWithStatus } = await import("@/lib/campaign/spend-enforce");
    await expect(enforceAutoPauseWithStatus("b1")).resolves.toEqual({ paused: ["c1"], confirmed: false });
  });

  it("pauses on Meta and locally once the cap is reached", async () => {
    setup({ autoPause: true, cap: 7000, spend: 7000 });
    const { enforceAutoPause } = await import("@/lib/campaign/spend-enforce");
    await expect(enforceAutoPause("b1")).resolves.toEqual(["c1"]);
    expect(updateCampaignStatus).toHaveBeenCalledWith("meta-1", "PAUSED");
    expect(metaClientForBusiness).not.toHaveBeenCalled();
    expect(withMetaConnection).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: "b1" }),
      expect.objectContaining({ purpose: "pause", binding: { adAccountId: "act_1", pageId: "page_1" } }),
      expect.any(Function),
    );
    expect(updateEq).toHaveBeenCalled();
  });

  it("skips old campaigns without a verified binding", async () => {
    setup({
      autoPause: true,
      cap: 7000,
      spend: 8000,
      campaigns: [campaign({ meta_ad_account_id: null })],
    });
    const { enforceAutoPause } = await import("@/lib/campaign/spend-enforce");
    await expect(enforceAutoPause("b1")).resolves.toEqual([]);
    expect(updateCampaignStatus).not.toHaveBeenCalled();
    expect(metaClientForBusiness).not.toHaveBeenCalled();
  });

  it("skips campaigns that were never launched to Meta", async () => {
    setup({
      autoPause: true,
      cap: 7000,
      spend: 8000,
      campaigns: [campaign({ meta_campaign_id: null })],
    });
    const { enforceAutoPause } = await import("@/lib/campaign/spend-enforce");
    await expect(enforceAutoPause("b1")).resolves.toEqual([]);
    expect(updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("keeps going when one pause fails, and never throws", async () => {
    setup({
      autoPause: true,
      cap: 7000,
      spend: 8000,
      campaigns: [campaign(), campaign({ id: "c2", meta_campaign_id: "meta-2" })],
    });
    updateCampaignStatus
      .mockRejectedValueOnce(new Error("meta 500"))
      .mockResolvedValueOnce(undefined);

    const { enforceAutoPause } = await import("@/lib/campaign/spend-enforce");
    await expect(enforceAutoPause("b1")).resolves.toEqual(["c2"]);
    const { enforceAutoPauseWithStatus } = await import("@/lib/campaign/spend-enforce");
    updateCampaignStatus.mockRejectedValueOnce(new Error("meta 500"));
    await expect(enforceAutoPauseWithStatus("b1")).resolves.toMatchObject({ confirmed: false });
  });

  it("returns empty rather than throwing if the lookup fails", async () => {
    getSpendLimits.mockRejectedValue(new Error("db down"));
    const { enforceAutoPause } = await import("@/lib/campaign/spend-enforce");
    await expect(enforceAutoPause("b1")).resolves.toEqual([]);
  });
});
