import { afterEach, describe, expect, it, vi } from "vitest";
import account from "./fixtures/meta/safety/account.json";
import campaignSpendCap from "./fixtures/meta/safety/campaign-spend-cap.json";
import switchDailyToLifetime from "./fixtures/meta/safety/switch-daily-to-lifetime.json";
import adsetLifetimeBudget from "./fixtures/meta/safety/adset-lifetime-budget.json";
import reviewNewAd from "./fixtures/meta/safety/review-new-ad.json";
import reviewAccountExamples from "./fixtures/meta/safety/review-account-examples.json";
import pauseAll from "./fixtures/meta/safety/pause-all.json";
import insights from "./fixtures/meta/safety/insights.json";
import statusRateLimit from "./fixtures/meta/safety/status-rate-limit.json";
import cappedAdSet from "./fixtures/meta/safety/capped-adset.json";
import cappedAdSetDelete from "./fixtures/meta/safety/capped-adset-delete.json";
import { settleInVirtualTime, useVirtualDeadlines } from "./replay";
import { adReviewState, MetaClient } from "@/lib/meta/client";
import { decodeCampaignInsights } from "@/lib/meta/insights";
import { weeklySpendDecision } from "@/lib/campaign/spend";
import type { Campaign } from "@/lib/types";

// #157: Graph responses recorded from one PAUSED Solaride test campaign by
// scripts/record-meta-safety-fixtures.ts (never ACTIVE; archived afterwards).
type Exchange = { method: string; path: string; form?: Record<string, string>; status: number; body: unknown };
type Sent = { method: string; path: string; form: Record<string, string> };

const creds = { adAccountId: "act_2398686420592052", pageId: "885223068001054", accessToken: "test-token" };
const campaignId = "120253654207670526";
const adSetId = "120253654208240526";
const lifetimeAdSetId = "120253654209590526";
const adId = "120253654209040526";
const binding = (campaignSpendCap as Exchange[]).slice(0, 2);

function replay(...tapes: Exchange[][]) {
  const pending = tapes.flat();
  const sent: Sent[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/v21.0/", "") + url.search;
    const form = init?.body instanceof URLSearchParams
      ? Object.fromEntries([...init.body].filter(([key]) => key !== "access_token")) : {};
    sent.push({ method, path, form });
    const index = pending.findIndex(exchange => exchange.method === method && exchange.path === path);
    if (index < 0) throw new Error(`Unrecorded Graph call: ${method} ${path}`);
    const [exchange] = pending.splice(index, 1);
    return Response.json(exchange.body, { status: exchange.status });
  });
  return { sent, pending };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("core: first-activation safety against recorded Graph responses (#157)", () => {
  it("cap: Meta refuses a ₹600 campaign spend cap (₹5,000 minimum), so the existing cap path keeps the campaign paused", async () => {
    expect((account as Exchange[])[0].body).toMatchObject({ currency: "INR", min_campaign_group_spend_cap: "500000" });
    const tape = replay(campaignSpendCap as Exchange[]);
    await expect(new MetaClient(creds).enforceCampaignSpendCap(campaignId, 60_000)).rejects.toThrow(/₹5,000/);
    expect(tape.pending).toEqual([]);
    expect(tape.sent.filter(call => call.method === "POST")).toEqual([{ method: "POST", path: campaignId, form: { spend_cap: "60000" } }]);
  });

  it("cap: a daily ad set cannot become lifetime, but a new lifetime ad set reads back the exact ₹600 and end date", () => {
    const [refused] = switchDailyToLifetime as Exchange[];
    expect(refused).toMatchObject({ status: 400, body: { error: { code: 100, error_subcode: 1885257 } } });
    const [created, readBack] = adsetLifetimeBudget as Exchange[];
    expect(created.form).toMatchObject({ status: "PAUSED", lifetime_budget: "60000" });
    expect(readBack.body).toMatchObject({ id: lifetimeAdSetId, status: "PAUSED", daily_budget: "0", lifetime_budget: "60000", budget_remaining: "60000" });
    const { start_time: start, end_time: end } = readBack.body as { start_time: string; end_time: string };
    expect(Date.parse(end) - Date.parse(start)).toBeGreaterThan(2.9 * 86_400_000);
  });

  it("review: a new ad reads as in review", async () => {
    const tape = replay(binding, reviewNewAd as Exchange[]);
    expect(await new MetaClient(creds).readAdReview(campaignId)).toEqual([
      { adId, state: "in_review", effectiveStatus: "IN_PROCESS", reasons: [] },
    ]);
    expect(tape.pending).toEqual([]);
    expect(tape.sent.every(call => call.method === "GET")).toBe(true);
  });

  it("review: a real disapproved ad reads as rejected with Meta's reason; paused ads read as approved", () => {
    const ads = ((reviewAccountExamples as Exchange[])[0].body as { data: Parameters<typeof adReviewState>[0][] }).data;
    const reviews = ads.map(adReviewState);
    const rejected = reviews.find(review => review.effectiveStatus === "DISAPPROVED")!;
    expect(rejected.state).toBe("rejected");
    expect(rejected.reasons).toHaveLength(1);
    expect(rejected.reasons[0]).toContain("Meta");
    expect(reviews.filter(review => ["PAUSED", "CAMPAIGN_PAUSED"].includes(review.effectiveStatus!)).map(review => review.state))
      .toEqual(["approved", "approved"]);
  });

  it("pause: one call pauses campaign, ad set and ad, reads all three back, and never writes anything but PAUSED", async () => {
    const tape = replay(binding, pauseAll as Exchange[]);
    const result = await new MetaClient(creds).pauseCampaignTree(campaignId, { adSetIds: [adSetId], adIds: [adId] });
    expect(tape.pending).toEqual([]);
    expect(tape.sent.filter(call => call.method === "POST")).toEqual([campaignId, adSetId, adId]
      .map(path => ({ method: "POST", path, form: { status: "PAUSED" } })));
    expect(result.confirmed).toBe(true);
    expect(result.objects.map(({ level, status }) => [level, status])).toEqual([
      ["campaign", "PAUSED"], ["adset", "PAUSED"], ["adset", "PAUSED"], ["ad", "PAUSED"],
    ]);
  });

  it("pause: waits out Meta's 613 status rate limit and retries instead of leaving delivery running", async () => {
    const [limited] = statusRateLimit as Exchange[];
    expect(limited.body).toMatchObject({ error: { code: 613 } });
    const tape = replay(binding, [{ ...limited, form: { status: "PAUSED" } }], pauseAll as Exchange[]);
    const meta = new MetaClient(creds);
    useVirtualDeadlines();
    const result = await settleInVirtualTime(meta.pauseCampaignTree(campaignId, { adSetIds: [adSetId], adIds: [adId] }));
    expect(result.confirmed).toBe(true);
    expect(tape.sent.filter(call => call.method === "POST").map(call => call.path)).toEqual([campaignId, campaignId, adSetId, adId]);
  });

  it("pause: is not confirmed when an intended ad is missing from the read-back", async () => {
    replay(binding, pauseAll as Exchange[], [{ method: "POST", path: "999", status: 200, body: { success: true } }]);
    const result = await new MetaClient(creds).pauseCampaignTree(campaignId, { adSetIds: [adSetId], adIds: [adId, "999"] });
    expect(result.confirmed).toBe(false);
  });

  it("spend: real ad-account insight rows decode to rupees, and a campaign with no delivery returns no rows", () => {
    const [lifetime, daily, newCampaign] = insights as Exchange[];
    const rows = (lifetime.body as { data: Array<Record<string, unknown>> }).data;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toMatchObject({ account_currency: "INR", spend: expect.stringMatching(/^\d+(\.\d+)?$/) });
      const decoded = decodeCampaignInsights({ data: [row] }, "instant_form");
      expect(decoded.spend).toBe(Number(row.spend));
      expect(decoded.periodStart).toBe(row.date_start);
    }
    expect(daily.body).toEqual({ data: [] });
    expect(newCampaign.body).toEqual({ data: [] });
  });

  describe("cap below the ₹5,000 campaign minimum: a ₹600 lifetime ad set with an end date", () => {
    const capped = { campaignId: "120253655093920526", sourceAdSetId: "120253655094860526", sourceAdId: "120253655095660526", adSetId: "120253655095920526", adId: "120253655096690526" };
    const endTime = new Date("2026-10-25T06:08:28.000Z");
    const create = (meta: MetaClient) => meta.createCappedAdSet(capped.campaignId, {
      sourceAdSetId: capped.sourceAdSetId, sourceAdIds: [capped.sourceAdId], lifetimeBudgetPaise: 60_000, endTime,
    });
    const recordedAt = () => vi.useFakeTimers({ toFake: ["Date"], now: endTime.getTime() - 3 * 86_400_000 });

    it("creates it PAUSED with PAUSED ad copies and returns it only after Meta reads back the exact amount and end date", async () => {
      recordedAt();
      const tape = replay(cappedAdSet as Exchange[]);
      await expect(create(new MetaClient(creds))).resolves.toEqual({
        adSetId: capped.adSetId, adIds: [capped.adId], lifetimeBudgetPaise: 60_000, endTime: endTime.toISOString(),
      });
      expect(tape.pending).toEqual([]);
      const posts = tape.sent.filter(call => call.method === "POST");
      expect(posts.map(call => call.path)).toEqual([`${creds.adAccountId}/adsets`, `${capped.sourceAdId}/copies`]);
      expect(posts[0].form).toMatchObject({ campaign_id: capped.campaignId, status: "PAUSED", lifetime_budget: "60000", end_time: endTime.toISOString() });
      expect(posts[0].form).not.toHaveProperty("daily_budget");
      expect(posts[1].form).toEqual({ adset_id: capped.adSetId, status_option: "PAUSED" });
      expect(JSON.stringify(tape.sent)).not.toContain("ACTIVE");
    });

    it("refuses and removes the new ad set when Meta reads back a different amount", async () => {
      recordedAt();
      const changed = (cappedAdSet as Exchange[]).map(exchange => exchange.method === "GET" && exchange.path.startsWith(`${capped.adSetId}?`)
        ? { ...exchange, body: { ...(exchange.body as object), lifetime_budget: "600000", budget_remaining: "600000" } }
        : exchange);
      const tape = replay(changed, cappedAdSetDelete as Exchange[]);
      await expect(create(new MetaClient(creds))).rejects.toThrow("Meta did not confirm the approved spending limit. The campaign stays paused.");
      expect(tape.pending).toEqual([]);
      expect(tape.sent.at(-1)).toMatchObject({ method: "DELETE", path: capped.adSetId });
    });

    it("refuses and removes the new ad set when the read-back end date differs", async () => {
      recordedAt();
      const changed = (cappedAdSet as Exchange[]).map(exchange => exchange.method === "GET" && exchange.path.startsWith(`${capped.adSetId}?`)
        ? { ...exchange, body: { ...(exchange.body as object), end_time: "2026-11-25T11:38:28+0530" } }
        : exchange);
      const tape = replay(changed, cappedAdSetDelete as Exchange[]);
      await expect(create(new MetaClient(creds))).rejects.toThrow(/did not confirm/);
      expect(tape.sent.at(-1)).toMatchObject({ method: "DELETE", path: capped.adSetId });
    });
  });

  it("spend: a just-activated campaign with no delivery yet (no insight rows) counts as ₹0, not as an unverifiable reading", async () => {
    const [lifetime, , newCampaign] = insights as Exchange[];
    const limits = { weeklyCapRupees: 600, alertPct: 80, autoPause: true };
    const active = { id: "c1", status: "active", daily_budget: 200, meta_campaign_id: campaignId } as unknown as Campaign;
    const now = new Date("2026-10-22T06:00:00Z");
    const observe = (body: unknown) => async () => ({
      insights: decodeCampaignInsights(body, "instant_form", { requireSpend: true }), currency: "INR", timezoneName: "Asia/Kolkata",
    });

    expect(decodeCampaignInsights(newCampaign.body, "instant_form", { requireSpend: true })).toMatchObject({ spend: 0, noDelivery: true });
    expect(await weeklySpendDecision([active], limits, observe(newCampaign.body), now)).toEqual({ toPause: [], verified: true });

    // A real row (with Meta's dates) over the cap still pauses; a row with no spend field is still unverified.
    const row = (lifetime.body as { data: Array<Record<string, unknown>> }).data[0];
    const thisWeek = { ...row, spend: "650.00", date_start: "2026-10-19", date_stop: "2026-10-22" };
    expect(await weeklySpendDecision([active], limits, observe({ data: [thisWeek] }), now)).toEqual({ toPause: ["c1"], verified: true });
    const noSpend = Object.fromEntries(Object.entries(thisWeek).filter(([key]) => key !== "spend"));
    expect(await weeklySpendDecision([active], limits, observe({ data: [noSpend] }), now)).toEqual({ toPause: ["c1"], verified: false });
  });
});
