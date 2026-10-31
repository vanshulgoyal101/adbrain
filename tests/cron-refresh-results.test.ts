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
  // #1838 slice 2: throttles remembered by earlier runs.
  rpc: vi.fn(),
  throttledConnections: [] as Array<{ business_id: string; throttled_until: string }>,
  saveCampaignBudget: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ getEnv: () => ({ CRON_SECRET: mocks.secret }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      let after: string | null = null;
      const query = {
        select: () => query, eq: () => query, in: () => query, order: () => query, limit: () => query,
        gt: (_key: string, value: string) => { after = value; return query; },
        maybeSingle: async () => ({ data: mocks.latest, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: table === "meta_connections" ? mocks.throttledConnections : table === "audit_log" ? [] : after ? [] : mocks.campaigns, error: null }),
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/meta/managed-account", () => ({ getManagedAccount: async () => null }));
vi.mock("@/lib/campaign/trusted-write", () => ({
  saveCampaign: mocks.saveCampaign,
  saveCampaignResult: mocks.saveCampaignResult,
  saveCampaignHealth: mocks.saveCampaignHealth,
  saveCampaignBudget: mocks.saveCampaignBudget,
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
  mocks.throttledConnections = [];
  mocks.rpc.mockResolvedValue({ data: null, error: null });
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

  it("#758: a business on a dead Meta token is listed once by opaque key, and the run stays green", async () => {
    const { MetaError } = await import("@/lib/meta/client");
    const { createHash } = await import("node:crypto");
    mocks.campaigns = [{ ...bound("dead-1", "m-dead-1"), business_id: "business-dead" }, { ...bound("dead-2", "m-dead-2"), business_id: "business-dead" }, bound("c1", "m1")];
    // Meta's answer for a session invalidated by a password change (Graph 190/460).
    mocks.insights.mockImplementation(async (id: string) => {
      if (id.startsWith("m-dead")) throw new MetaError("Error validating access token: The session has been invalidated because the user changed their password.", 400, 190, 460);
      return insights;
    });
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, refreshed: 1, failed: 0 });
    expect(body.reauth).toEqual([{ key: createHash("sha256").update("business-dead").digest("hex").slice(0, 12), since: expect.any(String), activeCampaigns: 2 }]);
    expect(JSON.stringify(body)).not.toContain("business-dead");
    expect(mocks.saveCampaignResult).toHaveBeenCalledTimes(1);
  });

  // #1838: a throttled account gets no more calls this run; the app-wide limit stops the run. Neither is a failure.
  it("#1838: Meta throttling one account skips that business's other campaigns; the run stays green", async () => {
    const { MetaThrottledError } = await import("@/lib/meta/client");
    mocks.campaigns = [{ ...bound("t1", "m-t1"), business_id: "business-busy" }, { ...bound("t2", "m-t2"), business_id: "business-busy" }, bound("c1", "m1")];
    mocks.insights.mockImplementation(async (id: string) => {
      if (id === "m-t1") throw new MetaThrottledError("(#17) User request limit reached", 400, 17, 2446079, "account", 37 * 60_000);
      return insights;
    });
    const result = await call();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, failed: 0, refreshed: 1 });
    expect(result.body.throttled).toEqual([{ key: expect.stringMatching(/^[0-9a-f]{12}$/), scope: "account", retryAfterMs: 37 * 60_000 }]);
    expect(mocks.insights.mock.calls.map(([id]) => id)).toEqual(["m-t1", "m1"]);
  });

  it("#1838: a throttle is remembered for the next runs, which skip that business, or everything while the app is limited", async () => {
    const { MetaThrottledError } = await import("@/lib/meta/client");
    mocks.campaigns = [{ ...bound("t1", "m-t1"), business_id: "business-busy" }, bound("c1", "m1")];
    mocks.insights.mockRejectedValueOnce(new MetaThrottledError("(#17) User request limit reached", 400, 17, 2446079, "account", 37 * 60_000));
    await call();
    expect(mocks.rpc).toHaveBeenCalledWith("meta_throttle_record", { p_business_id: "business-busy", p_scope: "account", p_until: expect.any(String) });

    vi.clearAllMocks();
    mocks.insights.mockResolvedValue(insights);
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    mocks.throttledConnections = [{ business_id: "business-busy", throttled_until: new Date(Date.now() + 30 * 60_000).toISOString() }];
    const next = await call();
    expect(mocks.insights.mock.calls.map(([id]) => id)).toEqual(["m1"]);
    expect(next.body).toMatchObject({ ok: true, refreshed: 1, skipped: 1 });

    vi.clearAllMocks();
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "meta_app_throttled_until" ? new Date(Date.now() + 10 * 60_000).toISOString() : null, error: null }));
    const limited = await call();
    expect(mocks.insights).not.toHaveBeenCalled();
    expect(limited.body).toMatchObject({ ok: true, refreshed: 0, throttled: [{ key: "app", scope: "app" }] });
  });

  it("#1838: the app-wide limit (code 4) stops the run: no more Meta calls for anyone", async () => {
    const { MetaThrottledError } = await import("@/lib/meta/client");
    mocks.campaigns = [{ ...bound("t1", "m-t1"), business_id: "business-a" }, bound("c1", "m1"), bound("c2", "m2")];
    mocks.insights.mockRejectedValueOnce(new MetaThrottledError("(#4) Application request limit reached", 400, 4, undefined, "app", 15 * 60_000));
    const result = await call();
    expect(result.body).toMatchObject({ ok: true, failed: 0, refreshed: 0 });
    expect(result.body.throttled).toEqual([expect.objectContaining({ scope: "app" })]);
    expect(mocks.insights).toHaveBeenCalledTimes(1);
  });

  it("still fails the run on a real Meta failure", async () => {
    mocks.insights.mockRejectedValueOnce(new Error("Service temporarily unavailable"));
    const { status, body } = await call();
    expect(status).toBe(503);
    expect(body).toMatchObject({ failed: 1, reauth: [] });
  });

  it("saves a result row and health per campaign and never pauses or changes a campaign", async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, refreshed: 2, pausedReads: 0, skipped: 0, failed: 0, hasMore: false, alerts: [], reauth: [], failures: [], ended: [], unbound: [], throttled: [] });
    expect(mocks.saveCampaignResult).toHaveBeenCalledWith({ businessId: "business-1", userId: "owner-1" }, expect.objectContaining({ campaign_id: "c1", impressions: 120, leads: 1 }));
    expect(mocks.saveCampaignHealth).toHaveBeenCalledWith(expect.anything(), "c1", expect.objectContaining({ flags: [] }));
    for (const write of [mocks.pause, mocks.updateStatus, mocks.saveCampaign]) expect(write).not.toHaveBeenCalled();
  });

  describe("#1903: paused or daily budget changed in Meta Ads Manager", () => {
    const state = (status: string, dailyBudget: string) => ({ status, adSets: [{ id: "as1", status: "ACTIVE", dailyBudget }] });
    const write = () => mocks.saveCampaignBudget.mock.calls.map(([actor, id, mirror]) => ({ actor, id,
      update: (mirror as (row: Record<string, unknown>) => Record<string, unknown>)({ status: "active", daily_budget: 500, raw: {} }) }));
    // As the real write: the mirror runs on the row as it is at write time.
    beforeEach(() => {
      mocks.saveCampaignBudget.mockImplementation(async (_actor, id, mirror: (row: Record<string, unknown>) => unknown) => {
        mirror({ status: "active", daily_budget: 500, raw: {} });
        return { data: { id }, error: null };
      });
    });

    it("a raise is saved on the row (status kept) and alerts once, by a key from when it was seen", async () => {
      mocks.campaigns = [{ ...bound("c1", "m1"), daily_budget: 500 }];
      mocks.insights.mockResolvedValue({ ...insights, metaState: state("ACTIVE", "80000") });
      const { status, body } = await call();
      expect(status).toBe(200);
      const [saved] = write();
      expect(saved).toMatchObject({ id: "c1", update: { daily_budget: 800, raw: { metaBudgetChange: { wasRupees: 500, nowRupees: 800 } } } });
      expect(saved.update).not.toHaveProperty("status");
      const at = (saved.update.raw as { metaBudgetChange: { at: string } }).metaBudgetChange.at;
      const key = (await import("node:crypto")).createHash("sha256").update(`c1:budget_raised:${at}`).digest("hex").slice(0, 12);
      expect(body.alerts).toEqual([{ kind: "budget_raised", key }]);
      for (const other of [mocks.pause, mocks.updateStatus, mocks.saveCampaign]) expect(other).not.toHaveBeenCalled();
    });

    it("a lower budget is saved without an alert; a pause in Meta is marked, with no delivery health or alert", async () => {
      mocks.campaigns = [{ ...bound("c1", "m1"), daily_budget: 500 }, { ...bound("c2", "m2"), daily_budget: 500 }];
      mocks.insights.mockImplementation(async (id: string) => ({ ...insights, impressions: 0,
        metaState: id === "m1" ? state("ACTIVE", "30000") : state("PAUSED", "50000") }));
      const { body } = await call();
      expect(body).toMatchObject({ ok: true, refreshed: 2, alerts: [] });
      const [lower, paused] = write();
      expect(lower).toMatchObject({ id: "c1", update: { daily_budget: 300 } });
      expect(paused).toMatchObject({ id: "c2", update: { raw: { metaPausedAt: expect.any(String) } } });
      expect(paused.update).not.toHaveProperty("daily_budget");
      expect(mocks.saveCampaignHealth).toHaveBeenCalledTimes(1);
      expect(mocks.saveCampaignHealth).toHaveBeenCalledWith(expect.anything(), "c1", expect.anything());
    });

    it("leaves a row the owner changed after Meta was read to the next refresh: no budget write, no alert", async () => {
      const updates: unknown[] = [];
      mocks.saveCampaignBudget.mockImplementation(async (_actor, id, mirror: (row: Record<string, unknown>) => unknown) => {
        updates.push(mirror({ status: "active", daily_budget: 300, raw: { health: { flags: [] } } }));
        return { data: { id }, error: null };
      });
      mocks.campaigns = [{ ...bound("c1", "m1"), daily_budget: 500 }];
      mocks.insights.mockResolvedValue({ ...insights, metaState: state("ACTIVE", "80000") });
      const { body } = await call();
      expect(body).toMatchObject({ ok: true, refreshed: 1, alerts: [] });
      expect(updates).toEqual([{ raw: { health: { flags: [] } } }]);
    });

    it("writes nothing when Meta matches the row", async () => {
      mocks.campaigns = [{ ...bound("c1", "m1"), daily_budget: 500 }];
      mocks.insights.mockResolvedValue({ ...insights, metaState: state("ACTIVE", "50000") });
      const { body } = await call();
      expect(body).toMatchObject({ ok: true, refreshed: 1, alerts: [] });
      expect(mocks.saveCampaignBudget).not.toHaveBeenCalled();
    });
  });

  it("skips a campaign refreshed in the last 14 min and one without a stored binding", async () => {
    mocks.latest = { fetched_at: new Date(Date.now() - 13 * 60_000).toISOString() };
    mocks.campaigns = [bound("c1", "m1"), { ...bound("c2", "m2"), meta_ad_account_id: null }];
    expect((await call()).body).toMatchObject({ refreshed: 0, skipped: 2 });
    expect(mocks.insights).not.toHaveBeenCalled();
  });

  it("#992: refreshes a campaign last read by the previous 15-min run, so results stay ≤ 15 min old", async () => {
    mocks.latest = { fetched_at: new Date(Date.now() - 15 * 60_000).toISOString() };
    mocks.campaigns = [bound("c1", "m1")];
    expect((await call()).body).toMatchObject({ refreshed: 1, skipped: 0 });
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
    mocks.latest = { fetched_at: hoursAgo(0.1) };
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
    // #1903: paused in Meta Ads Manager; "Nothing is spending" says it, no stale delivery flag beside it.
    expect(campaignAttention({ status: "active", raw: { ...(raw as object), metaPausedAt: "2026-10-29T08:00:00Z" } })).toBeNull();
    expect(campaignAttention({ status: "active", raw: null })).toBeNull();
  });

  describe("#1592: a campaign that can't be read never keeps the job red forever", () => {
    const key = async (id: string) => (await import("node:crypto")).createHash("sha256").update(`refresh:${id}`).digest("hex").slice(0, 12);

    it("deleted in Meta (CampaignGoneError) is ended, as the manual refresh does, and the run stays green", async () => {
      const { CampaignGoneError } = await import("@/lib/meta/client");
      mocks.campaigns = [bound("gone", "m-gone", { cap: { days: 2 } }), bound("c1", "m1")];
      mocks.insights.mockImplementation(async (id: string) => { if (id === "m-gone") throw new CampaignGoneError("DELETED"); return insights; });
      mocks.saveCampaign.mockResolvedValue({ data: {}, error: null });
      const { status, body } = await call();
      expect(status).toBe(200);
      expect(body).toMatchObject({ ok: true, refreshed: 1, failed: 0, ended: [await key("gone")], failures: [] });
      // #1600: one 'ended' alert for the workflow, by opaque key.
      expect(body.alerts).toEqual([{ kind: "ended", key: await key("gone") }]);
      expect(mocks.saveCampaign).toHaveBeenCalledWith({ businessId: "business-1", userId: "owner-1" },
        { status: "completed", raw: { cap: { days: 2 }, metaStatus: "DELETED", metaGoneAt: expect.any(String) } }, "gone");
    });

    it("#1678: Meta's recorded 100/33 ('does not exist, or missing permissions') never ends a campaign: listed as unbound", async () => {
      const tape = (await import("./core/fixtures/meta/create-cleanup-refusals.json")).default as unknown as Array<{ status: number; body?: { error?: { message: string; code: number; error_subcode: number } } }>;
      const graph = tape.map((entry) => entry.body?.error).find((error) => error?.code === 100 && error.error_subcode === 33)!;
      expect(graph.message).toMatch(/does not exist, cannot be loaded due to missing permissions/);
      const { MetaError } = await import("@/lib/meta/client");
      mocks.campaigns = [bound("missing", "m-missing")];
      mocks.insights.mockRejectedValue(new MetaError(graph.message, 400, graph.code, graph.error_subcode));
      const { status, body } = await call();
      expect(status).toBe(200);
      expect(body).toMatchObject({ ok: true, failed: 0, ended: [], unbound: [await key("missing")], alerts: [] });
      // It stays active, so enforce-spend keeps guarding it.
      expect(mocks.saveCampaign).not.toHaveBeenCalled();
    });

    it("assets that no longer match the connection (CONFLICT) are listed, not failed", async () => {
      const { ConnectionAccessError } = await import("@/lib/meta/connection-access-error");
      mocks.campaigns = [bound("moved", "m-moved"), bound("c1", "m1")];
      mocks.insights.mockImplementation(async (id: string) => { if (id === "m-moved") throw new ConnectionAccessError("CONFLICT", "Campaign Meta assets no longer match the connection."); return insights; });
      const { status, body } = await call();
      expect(status).toBe(200);
      expect(body).toMatchObject({ ok: true, failed: 0, unbound: [await key("moved")] });
      expect(mocks.saveCampaign).not.toHaveBeenCalled();
    });

    it("any other failure still fails the run, now with its opaque key and code (never an id)", async () => {
      const { MetaError } = await import("@/lib/meta/client");
      mocks.campaigns = [bound("broken", "m-broken")];
      mocks.insights.mockRejectedValue(new MetaError("Service temporarily unavailable", 503, 2));
      const { status, body } = await call();
      expect(status).toBe(503);
      expect(body).toMatchObject({ ok: false, failed: 1, failures: [{ key: await key("broken"), code: "2" }] });
      expect(JSON.stringify(body)).not.toContain("broken");
    });
  });
});
