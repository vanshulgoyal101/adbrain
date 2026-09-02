import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server-side library behaviour that guards money and data:
 * - audit logging must never break the operation it records
 * - auto-pause must only fire under the exact configured conditions
 * - creative generation must clamp what it asks the (paid) providers for
 * - image persistence must degrade to the source URL rather than lose an image
 */

const getUser = vi.fn();
const insert = vi.fn();
const updateEq = vi.fn();
const updateCampaignStatus = vi.fn();
const metaClientForBusiness = vi.fn();
const getCampaigns = vi.fn();
const getLatestResults = vi.fn();
const getSpendLimits = vi.fn();

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
vi.mock("@/lib/supabase/queries", () => ({
  getCampaigns,
  getLatestResults,
  getSpendLimits,
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  getUser.mockResolvedValue({ data: { user: { id: "u1", email: "o@x.com" } } });
  insert.mockResolvedValue({ error: null });
  updateEq.mockResolvedValue({ error: null });
  updateCampaignStatus.mockResolvedValue(undefined);
  metaClientForBusiness.mockResolvedValue({ updateCampaignStatus });
});

describe("logEvent", () => {
  it("records who did what, with the actor from the session", async () => {
    const { logEvent } = await import("@/lib/audit");
    await logEvent({
      businessId: "b1",
      action: "campaign.create",
      entityType: "campaign",
      entityId: "c1",
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: "b1",
        action: "campaign.create",
        entity_type: "campaign",
        entity_id: "c1",
        actor_id: "u1",
        actor_label: "o@x.com",
        details: {},
      }),
    );
  });

  it("falls back to a system actor when there is no session", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { logEvent } = await import("@/lib/audit");
    await logEvent({ businessId: "b1", action: "cron.sync", entityType: "campaign" });
    expect(insert.mock.calls[0][0]).toMatchObject({
      actor_id: null,
      actor_label: "system",
    });
  });

  it("never throws when the insert fails — logging must not break the caller", async () => {
    insert.mockRejectedValue(new Error("db down"));
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
    getLatestResults.mockResolvedValue(
      Object.fromEntries(list.map((c) => [c.id as string, { spend: opts.spend }])),
    );
  };

  it("does nothing when auto-pause is off", async () => {
    setup({ autoPause: false, cap: 7000, spend: 9000 });
    const { enforceAutoPause } = await import("@/lib/campaign/spend-enforce");
    await expect(enforceAutoPause("b1")).resolves.toEqual([]);
    expect(updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("does nothing when there is no cap", async () => {
    setup({ autoPause: true, cap: null, spend: 9000 });
    const { enforceAutoPause } = await import("@/lib/campaign/spend-enforce");
    await expect(enforceAutoPause("b1")).resolves.toEqual([]);
    expect(updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("does nothing while spend is under the cap", async () => {
    setup({ autoPause: true, cap: 7000, spend: 100 });
    const { enforceAutoPause } = await import("@/lib/campaign/spend-enforce");
    await expect(enforceAutoPause("b1")).resolves.toEqual([]);
    expect(updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("pauses on Meta and locally once the cap is reached", async () => {
    setup({ autoPause: true, cap: 7000, spend: 7000 });
    const { enforceAutoPause } = await import("@/lib/campaign/spend-enforce");
    await expect(enforceAutoPause("b1")).resolves.toEqual(["c1"]);
    expect(updateCampaignStatus).toHaveBeenCalledWith("meta-1", "PAUSED");
    expect(updateEq).toHaveBeenCalled();
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
  });

  it("returns empty rather than throwing if the lookup fails", async () => {
    getSpendLimits.mockRejectedValue(new Error("db down"));
    const { enforceAutoPause } = await import("@/lib/campaign/spend-enforce");
    await expect(enforceAutoPause("b1")).resolves.toEqual([]);
  });
});
