import { beforeEach, describe, expect, it, vi } from "vitest";
import { campaignAttention } from "@/lib/campaign/health";

const mocks = vi.hoisted(() => ({
  secret: "cron-secret" as string | undefined,
  campaigns: [] as Array<Record<string, unknown>>,
  latest: null as { fetched_at: string } | null,
  insights: vi.fn(),
  review: vi.fn(),
  pause: vi.fn(),
  updateStatus: vi.fn(),
  saveCampaign: vi.fn(),
  saveCampaignResult: vi.fn(),
  saveCampaignHealth: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ getEnv: () => ({ CRON_SECRET: mocks.secret }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      let after: string | null = null;
      const query = {
        select: () => query, eq: () => query, order: () => query, limit: () => query,
        gt: (_key: string, value: string) => { after = value; return query; },
        maybeSingle: async () => ({ data: mocks.latest, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: after ? [] : mocks.campaigns, error: null }),
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/campaign/trusted-write", () => ({
  saveCampaign: mocks.saveCampaign,
  saveCampaignResult: mocks.saveCampaignResult,
  saveCampaignHealth: mocks.saveCampaignHealth,
}));
vi.mock("@/lib/meta/connection-access", () => ({
  requireScheduledBusiness: async (id: string) => ({ businessId: id, userId: "owner-1" }),
  withMetaConnection: async (_context: unknown, _options: unknown, execute: (meta: unknown) => unknown) => execute({
    getCampaignInsights: mocks.insights, readAdReview: mocks.review,
    pauseCampaignTree: mocks.pause, updateCampaignStatus: mocks.updateStatus,
  }),
}));

const bound = (id: string, meta: string, raw: Record<string, unknown> = {}) => ({
  id, business_id: "business-1", status: "active", meta_campaign_id: meta,
  meta_ad_account_id: "act_1", meta_page_id: "page_1", meta_connection_generation: 1, raw,
});
const call = async (authorization = "Bearer cron-secret") => {
  const { GET } = await import("@/app/api/cron/refresh-results/route");
  const response = await GET(new Request("http://localhost/api/cron/refresh-results", { headers: { authorization } }));
  return { status: response.status, body: await response.json() };
};
const insights = { impressions: 120, clicks: 4, leads: 1, spend: 32.63, cpl: 32.63, destination: "instant_form", periodStart: "2026-10-01", periodEnd: "2026-10-23" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.secret = "cron-secret";
  mocks.latest = null;
  mocks.campaigns = [bound("c1", "m1"), bound("c2", "m2")];
  mocks.insights.mockResolvedValue(insights);
  mocks.review.mockResolvedValue([{ adId: "a1", state: "approved", effectiveStatus: "ACTIVE", reasons: [] }]);
  mocks.saveCampaignResult.mockResolvedValue({ data: {}, error: null });
  mocks.saveCampaignHealth.mockResolvedValue({ data: { id: "c1" }, error: null });
});

describe("GET /api/cron/refresh-results (#258)", () => {
  it("requires the cron secret", async () => {
    expect((await call("Bearer wrong")).status).toBe(401);
    mocks.secret = undefined;
    expect((await call()).status).toBe(404);
    expect(mocks.insights).not.toHaveBeenCalled();
  });

  it("saves a result row and health per campaign and never pauses or changes a campaign", async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, refreshed: 2, skipped: 0, failed: 0, hasMore: false, alerts: [] });
    expect(mocks.saveCampaignResult).toHaveBeenCalledWith({ businessId: "business-1", userId: "owner-1" }, expect.objectContaining({ campaign_id: "c1", impressions: 120, leads: 1 }));
    expect(mocks.saveCampaignHealth).toHaveBeenCalledWith(expect.anything(), "c1", expect.objectContaining({ flags: [] }));
    for (const write of [mocks.pause, mocks.updateStatus, mocks.saveCampaign]) expect(write).not.toHaveBeenCalled();
  });

  it("skips a campaign refreshed within the hour and one without a stored binding", async () => {
    mocks.latest = { fetched_at: new Date(Date.now() - 30 * 60_000).toISOString() };
    mocks.campaigns = [bound("c1", "m1"), { ...bound("c2", "m2"), meta_ad_account_id: null }];
    expect((await call()).body).toMatchObject({ refreshed: 0, skipped: 2 });
    expect(mocks.insights).not.toHaveBeenCalled();
  });

  it("keeps refreshing other campaigns when one Meta read fails, and reports 503", async () => {
    mocks.insights.mockRejectedValueOnce(new Error("Meta unavailable"));
    const { status, body } = await call();
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, refreshed: 1, failed: 1 });
    expect(mocks.saveCampaignResult).toHaveBeenCalledTimes(1);
  });

  it("keeps an earlier rejection when the ad review cannot be read", async () => {
    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    const rejected = { kind: "rejected", reason: "Meta rejected an ad.", since, key: "aaaaaaaaaaaa" };
    mocks.campaigns = [bound("c1", "m1", { health: { checkedAt: since, activeSince: since, flags: [rejected] } })];
    mocks.review.mockRejectedValue(new Error("review unavailable"));
    const { body } = await call();
    expect(mocks.saveCampaignHealth).toHaveBeenCalledWith(expect.anything(), "c1", expect.objectContaining({ flags: [rejected] }));
    expect(body.alerts).toEqual([{ kind: "rejected", key: "aaaaaaaaaaaa" }]);
  });

  it("still reports a problem first seen hours ago by an earlier run, but not one older than a day (#274)", async () => {
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
    const recent = { kind: "not_delivering", reason: "No impressions yet.", since: hoursAgo(5), key: "bbbbbbbbbbbb" };
    const old = { kind: "rejected", reason: "Meta rejected an ad.", since: hoursAgo(25), key: "cccccccccccc" };
    mocks.latest = { fetched_at: hoursAgo(0.5) };
    mocks.campaigns = [
      bound("c1", "m1", { health: { checkedAt: hoursAgo(0.5), activeSince: hoursAgo(12), flags: [recent] } }),
      bound("c2", "m2", { health: { checkedAt: hoursAgo(0.5), activeSince: hoursAgo(48), flags: [old] } }),
    ];
    const { body } = await call();
    expect(body).toMatchObject({ refreshed: 0, skipped: 2 });
    expect(body.alerts).toEqual([{ kind: "not_delivering", key: "bbbbbbbbbbbb" }]);
  });
});

describe("campaignAttention", () => {
  const raw = { health: { checkedAt: "2026-10-23T17:00:00.000Z", activeSince: "2026-10-23T10:00:00.000Z", flags: [
    { kind: "ended", reason: "This run's end date has passed. Pause it, or start a new run.", since: "2026-10-23T17:00:00.000Z", key: "abcdefabcdef" },
  ] } };

  it("shows the reason for an active campaign only", () => {
    expect(campaignAttention({ status: "active", raw })).toBe("This run's end date has passed. Pause it, or start a new run.");
    expect(campaignAttention({ status: "paused", raw })).toBeNull();
    expect(campaignAttention({ status: "active", raw: null })).toBeNull();
  });
});
