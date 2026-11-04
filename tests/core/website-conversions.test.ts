import { afterEach, describe, expect, it, vi } from "vitest";
import provisional from "./fixtures/meta/website-conversions.provisional.json";
import visits from "./fixtures/meta/website-results.provisional.json";
import launch from "./fixtures/meta/launch-validate-website-conversions.json";
import deletedCampaign from "./fixtures/meta/campaign-deleted.json";
import whatsappRecorded from "./fixtures/meta/whatsapp-results.json";
import { MetaClient } from "@/lib/meta/client";
import { conversionGoalFromAdSets, decodeAdResults, decodeCampaignInsights } from "@/lib/meta/insights";
import { saveAdResults } from "@/lib/campaign/ad-results-store";

// #2716 (#2595 E2): a website leads/sales campaign's Meta-attributed pixel conversions, read beside its page views
// and never in place of them. Insights are labelled provisional (no conversion campaign has run); the ad-set reads
// that tell the goal apart are the recorded validate_only readbacks of #2746.
const creds = { adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" };
const CAMPAIGN = "120000000000200";

afterEach(() => vi.restoreAllMocks());

describe("core: the conversion goal comes from the ad sets' promoted pixel event (#2716)", () => {
  const readback = (goal: string) => launch.adSetReadbacks.find((entry) => entry.goal === goal)!.body;

  it("reads leads and sales from Meta's recorded ad-set readbacks", () => {
    expect(conversionGoalFromAdSets([readback("leads")])).toBe("leads");
    expect(conversionGoalFromAdSets([readback("sales")])).toBe("sales");
  });

  it("is null for visits, for events AdBrain doesn't build and for mixed ad sets", () => {
    expect(conversionGoalFromAdSets([{ promoted_object: { page_id: "PAGE" } } as never])).toBeNull();
    expect(conversionGoalFromAdSets([{ promoted_object: { custom_event_type: "COMPLETE_REGISTRATION" } }])).toBeNull();
    expect(conversionGoalFromAdSets([readback("leads"), readback("sales")])).toBeNull();
    expect(conversionGoalFromAdSets([])).toBeNull();
  });
});

describe("core: website conversions from Meta insights (#2716)", () => {
  it("leads: counts the pixel lead once, keeps page views and clicks, and has no value when Meta sends none", () => {
    const insights = decodeCampaignInsights(provisional.leads.payload, "website", { conversionGoal: "leads" });
    expect(insights).toMatchObject({ conversionGoal: "leads", conversions: 6, conversionValue: null, costPerConversion: 150, landingPageViews: 70, linkClicks: 96 });
  });

  it("sales: counts purchases and their value from action_values", () => {
    const insights = decodeCampaignInsights(provisional.sales.payload, "website", { conversionGoal: "sales" });
    expect(insights).toMatchObject({ conversionGoal: "sales", conversions: 3, conversionValue: 4497, costPerConversion: 400, landingPageViews: 84 });
  });

  it("a delivered run with no conversion reads a real zero; an undelivered one too, never a guessed value", () => {
    expect(decodeCampaignInsights(visits.payload, "website", { conversionGoal: "sales" })).toMatchObject({ conversions: 0, conversionValue: null, costPerConversion: null, landingPageViews: 55 });
    expect(decodeCampaignInsights({ data: [] }, "website", { conversionGoal: "leads" })).toMatchObject({ conversions: 0, conversionValue: null, costPerConversion: null, noDelivery: true });
  });

  it.each(["missing", "zero"])("does not report %s conversions when Meta reports a positive conversion value", (count) => {
    const removeCount = (actions: Array<{ action_type: string; value: string }>) => [
      ...actions.filter((action) => action.action_type !== "offsite_conversion.fb_pixel_purchase"),
      ...(count === "zero" ? [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "0" }] : []),
    ];
    const campaignRow = provisional.sales.payload.data[0];
    const campaign = decodeCampaignInsights({ data: [{ ...campaignRow, actions: removeCount(campaignRow.actions) }] }, "website", { conversionGoal: "sales" });
    expect(campaign).toMatchObject({ conversionsUnavailable: true, spend: 1200, landingPageViews: 84 });
    expect(campaign).not.toHaveProperty("conversions");

    const adRow = provisional.sales.ads.insights.data[0];
    const ads = decodeAdResults(provisional.sales.ads.list, { data: [{ ...adRow, actions: removeCount(adRow.actions) }] }, "website", "sales");
    expect(ads[0]).toMatchObject({ conversionsUnavailable: true, spend: 800, landingPageViews: 60 });
    expect(ads[0]).not.toHaveProperty("conversions");
  });

  it("does not turn missing spend into a free conversion, while observed zero spend remains zero", () => {
    const row = provisional.sales.payload.data[0];
    expect(decodeCampaignInsights({ data: [{ ...row, spend: undefined }] }, "website", { conversionGoal: "sales" }))
      .toMatchObject({ conversions: 3, conversionValue: 4497, costPerConversion: null });
    expect(decodeCampaignInsights({ data: [{ ...row, spend: "0" }] }, "website", { conversionGoal: "sales" }))
      .toMatchObject({ conversions: 3, conversionValue: 4497, costPerConversion: 0 });
  });

  it("an ambiguous or malformed conversion reads as unavailable, never a wrong number, and never fails spend or page views", () => {
    const row = provisional.sales.payload.data[0];
    const twice = { data: [{ ...row, action_values: [...row.action_values, { action_type: "offsite_conversion.fb_pixel_purchase", value: "1.00" }] }] };
    const bad = { data: [{ ...row, action_values: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "-5" }] }] };
    const fractional = { data: [{ ...row, actions: [...row.actions.filter((action) => !action.action_type.includes("purchase")), { action_type: "offsite_conversion.fb_pixel_purchase", value: "2.5" }] }] };
    for (const payload of [twice, bad, fractional]) {
      const read = decodeCampaignInsights(payload, "website", { conversionGoal: "sales", requireSpend: true });
      expect(read).toMatchObject({ conversionGoal: "sales", conversionsUnavailable: true, spend: 1200, landingPageViews: 84 });
      expect(read).not.toHaveProperty("conversions");
      expect(read).not.toHaveProperty("conversionValue");
    }
    const ads = decodeAdResults(provisional.sales.ads.list, { data: [{ ...provisional.sales.ads.insights.data[0], action_values: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "x" }] }] }, "website", "sales");
    expect(ads[0]).toMatchObject({ conversionsUnavailable: true, landingPageViews: 60, spend: 800 });
    expect(ads[0]).not.toHaveProperty("conversions");
  });

  it.each([
    ["null", null],
    ["a non-list", {}],
    ["a malformed entry", [null]],
    ["a non-string value", [{ action_type: "offsite_conversion.fb_pixel_purchase", value: null }]],
  ])("marks %s action_values unavailable without losing campaign or ad results", (_description, actionValues) => {
    const campaignRow = provisional.sales.payload.data[0];
    const campaign = decodeCampaignInsights({ data: [{ ...campaignRow, action_values: actionValues }] }, "website", { conversionGoal: "sales", requireSpend: true });
    expect(campaign).toMatchObject({ conversionsUnavailable: true, spend: 1200, landingPageViews: 84 });
    expect(campaign).not.toHaveProperty("conversions");

    const adRow = provisional.sales.ads.insights.data[0];
    const ads = decodeAdResults(provisional.sales.ads.list, { data: [{ ...adRow, action_values: actionValues }] }, "website", "sales");
    expect(ads[0]).toMatchObject({ conversionsUnavailable: true, spend: 800, landingPageViews: 60 });
    expect(ads[0]).not.toHaveProperty("conversions");
  });

  it.each([null, 3, undefined])("marks a malformed pixel count (%s) unavailable without losing other results", (value) => {
    const campaignRow = provisional.sales.payload.data[0];
    const campaignActions = campaignRow.actions.map((action) => action.action_type === "offsite_conversion.fb_pixel_purchase" ? { ...action, value } : action);
    const campaign = decodeCampaignInsights({ data: [{ ...campaignRow, actions: campaignActions }] }, "website", { conversionGoal: "sales", requireSpend: true });
    expect(campaign).toMatchObject({ conversionsUnavailable: true, spend: 1200, landingPageViews: 84 });
    expect(campaign).not.toHaveProperty("conversions");

    const adRow = provisional.sales.ads.insights.data[0];
    const adActions = adRow.actions.map((action) => action.action_type === "offsite_conversion.fb_pixel_purchase" ? { ...action, value } : action);
    const ads = decodeAdResults(provisional.sales.ads.list, { data: [{ ...adRow, actions: adActions }] }, "website", "sales");
    expect(ads[0]).toMatchObject({ conversionsUnavailable: true, spend: 800, landingPageViews: 60 });
    expect(ads[0]).not.toHaveProperty("conversions");
  });

  it("ignores unsolicited action_values on legacy reads but still rejects malformed headline actions", () => {
    const legacy = { data: [{ spend: "100", actions: [{ action_type: "lead", value: "5" }], action_values: null }] };
    expect(decodeCampaignInsights(legacy, "instant_form")).toMatchObject({ spend: 100, leads: 5 });
    const badHeadline = { data: [{ actions: [{ action_type: "landing_page_view", value: null }] }] };
    expect(() => decodeCampaignInsights(badHeadline, "website", { conversionGoal: "sales" })).toThrow("incomplete or invalid");
    const adRow = provisional.sales.ads.insights.data[0];
    expect(decodeAdResults(provisional.sales.ads.list, { data: [{ ...adRow, action_values: null }] }, "website")[0])
      .toMatchObject({ results: 60, spend: 800 });
    expect(() => decodeAdResults(provisional.sales.ads.list, { data: [{ ...adRow, actions: badHeadline.data[0].actions }] }, "website", "sales"))
      .toThrow("incomplete or invalid");
  });

  it("visits, WhatsApp and form reads are unchanged: no conversion fields", () => {
    expect(decodeCampaignInsights(visits.payload, "website")).toEqual(decodeCampaignInsights(visits.payload, "website", { conversionGoal: null }));
    for (const read of [decodeCampaignInsights(visits.payload, "website"), decodeCampaignInsights(whatsappRecorded.payload, "whatsapp", { conversionGoal: "sales" }), decodeCampaignInsights(whatsappRecorded.payload, "instant_form", { conversionGoal: "leads" })]) {
      for (const field of ["conversionGoal", "conversions", "conversionValue", "costPerConversion"]) expect(read).not.toHaveProperty(field);
    }
  });

  it("per ad: conversions and value beside each ad's page views, which stay its stored result", async () => {
    const ads = decodeAdResults(provisional.sales.ads.list, provisional.sales.ads.insights, "website", "sales");
    expect(ads.map((ad) => [ad.adId, ad.results, ad.landingPageViews, ad.conversions, ad.conversionValue])).toEqual([
      ["120000000000201", 60, 60, 3, 4497],
      ["120000000000202", 24, 24, 0, null],
    ]);
    let saved: Array<Record<string, unknown>> = [];
    const store = { from: () => ({ upsert: async (rows: Array<Record<string, unknown>>) => { saved = rows; return { error: null }; } }) };
    expect(await saveAdResults(store as never, { businessId: "b", campaignId: "c", ads })).toBe(true);
    expect(saved.map((row) => row.landing_page_views)).toEqual([60, 24]);
    for (const row of saved) expect(Object.keys(row).some((key) => key.includes("conversion"))).toBe(false);
  });
});

describe("core: the client asks for action_values only for a conversion goal (#2716)", () => {
  function graph(customEventType: string | null, options: {
    history?: unknown;
    historyError?: { code?: number; status: number };
    rejectActionValues?: number;
    rejectionStatus?: number;
    timeoutValues?: boolean;
    mixedDestinations?: boolean;
    campaignInsights?: unknown;
    adInsights?: unknown;
  } = {}) {
    const paths: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if ((init?.method ?? "GET") !== "GET") throw new Error("Results reads are read-only.");
      const url = new URL(String(input));
      url.searchParams.delete("access_token");
      const path = url.pathname.replace("/v26.0/", "") + decodeURIComponent(url.search);
      paths.push(path);
      if (path.startsWith(`${CAMPAIGN}?`)) return Response.json({ id: CAMPAIGN, account_id: "9000000000000001", status: "ACTIVE" });
      if (path.startsWith(`${CAMPAIGN}/adsets?`)) {
        const adSet = { id: "120000000000210", status: "ACTIVE", end_time: "2099-12-01T00:00:00Z", destination_type: "WEBSITE", promoted_object: { page_id: creds.pageId, ...(customEventType ? { pixel_id: "1", custom_event_type: customEventType } : {}) } };
        if (url.searchParams.has("filtering")) {
          if (options.historyError) {
            if (options.historyError.code === undefined) return new Response(null, { status: options.historyError.status });
            return Response.json({ error: { code: options.historyError.code, message: "Synthetic refusal" } }, { status: options.historyError.status });
          }
          return Response.json(options.history ?? { data: [adSet] });
        }
        return Response.json({ data: options.mixedDestinations ? [adSet, { ...adSet, id: "120000000000211", destination_type: "ON_AD" }] : [adSet] });
      }
      if (path.startsWith(`${CAMPAIGN}/ads?`)) return Response.json(provisional.sales.ads.list);
      if (path.includes("/insights?") && path.includes("action_values") && options.timeoutValues) {
        throw Object.assign(new Error("Synthetic timeout"), { name: "TimeoutError" });
      }
      if (path.includes("/insights?") && path.includes("action_values") && options.rejectActionValues) {
        return Response.json({ error: { code: options.rejectActionValues, message: "Synthetic refusal" } }, { status: options.rejectionStatus ?? 400 });
      }
      if (path.includes("level=ad")) return Response.json(options.adInsights ?? provisional.sales.ads.insights);
      if (path.startsWith(`${CAMPAIGN}/insights?`)) return Response.json(options.campaignInsights ?? provisional.sales.payload);
      throw new Error(`Unexpected Graph call: ${path}`);
    });
    return paths;
  }

  it("a sales campaign reads conversions and value for the campaign and each ad", async () => {
    const paths = graph("PURCHASE");
    const meta = new MetaClient(creds);
    expect(await meta.getCampaignInsights(CAMPAIGN)).toMatchObject({ destination: "website", conversionGoal: "sales", conversions: 3, conversionValue: 4497 });
    expect((await meta.getAdResults(CAMPAIGN)).map((ad) => ad.conversions)).toEqual([3, 0]);
    expect(paths.filter((path) => path.includes("/insights?"))).toEqual([
      `${CAMPAIGN}/insights?fields=impressions,clicks,spend,actions,action_values,date_start,date_stop&date_preset=maximum`,
      `${CAMPAIGN}/insights?level=ad&fields=ad_id,impressions,clicks,spend,actions,action_values&date_preset=maximum&limit=100`,
    ]);
  });

  it("the weekly spend check never asks for conversions, so a bad one can't pause anything", async () => {
    const paths = graph("PURCHASE");
    const weekly = await new MetaClient(creds).getCampaignInsights(CAMPAIGN, { weekly: true });
    expect(weekly).toMatchObject({ spend: 1200 });
    expect(weekly).not.toHaveProperty("conversionGoal");
    expect(paths.filter((path) => path.includes("/insights?"))).toEqual([
      `${CAMPAIGN}/insights?fields=impressions,clicks,spend,actions,date_start,date_stop&date_preset=this_week_mon_today`,
    ]);
  });

  it("keeps the spend and end-time read when Meta refuses only the optional value field", async () => {
    const paths = graph("PURCHASE", { rejectActionValues: 100 });
    const meta = new MetaClient(creds);
    const campaign = await meta.getCampaignInsights(CAMPAIGN);
    expect(campaign).toMatchObject({
      spend: 1200, landingPageViews: 84, conversionGoal: "sales", conversionsUnavailable: true,
      metaState: { adSets: [{ endTime: "2099-12-01T00:00:00Z" }] },
    });
    expect(campaign).not.toHaveProperty("conversions");
    const ads = await meta.getAdResults(CAMPAIGN);
    expect(ads[0]).toMatchObject({ spend: 800, landingPageViews: 60, conversionsUnavailable: true });
    expect(ads[0]).not.toHaveProperty("conversions");
    expect(paths.filter((path) => path.includes("/insights?"))).toHaveLength(4);
  });

  it.each(["mixed history", "rejected optional field"])("keeps malformed conversion counts separate from headline data with %s", async (reason) => {
    const campaignRow = provisional.sales.payload.data[0];
    const adRow = provisional.sales.ads.insights.data[0];
    const malformed = (actions: Array<{ action_type: string; value: string }>) =>
      actions.map(action => action.action_type === "offsite_conversion.fb_pixel_purchase" ? { ...action, value: null } : action);
    graph("PURCHASE", {
      ...(reason === "mixed history"
        ? { history: { data: [{ id: "120000000000211", destination_type: "WEBSITE", promoted_object: { page_id: creds.pageId, custom_event_type: "LEAD" } }] } }
        : { rejectActionValues: 100 }),
      campaignInsights: { data: [{ ...campaignRow, actions: malformed(campaignRow.actions) }] },
      adInsights: { data: [{ ...adRow, actions: malformed(adRow.actions) }] },
    });
    const meta = new MetaClient(creds);
    expect(await meta.getCampaignInsights(CAMPAIGN)).toMatchObject({ spend: 1200, landingPageViews: 84, conversionsUnavailable: true });
    expect(await meta.getCampaignInsights(CAMPAIGN, { weekly: true })).toMatchObject({ spend: 1200 });
    expect((await meta.getAdResults(CAMPAIGN))[0]).toMatchObject({ spend: 800, landingPageViews: 60, conversionsUnavailable: true });
  });

  it("keeps weekly spend readable for a mixed-destination campaign with a malformed pixel count", async () => {
    const row = provisional.sales.payload.data[0];
    graph("PURCHASE", {
      mixedDestinations: true,
      campaignInsights: { data: [{ ...row, actions: row.actions.map(action => action.action_type === "offsite_conversion.fb_pixel_purchase" ? { ...action, value: null } : action) }] },
    });
    expect(await new MetaClient(creds).getCampaignInsights(CAMPAIGN, { weekly: true })).toMatchObject({ destination: "mixed", spend: 1200 });
  });

  it.each([
    ["throttle", 4, 429, { reason: "rate_limited" }],
    ["expired token", 190, 400, { code: 190 }],
  ])("surfaces a %s from the optional history read", async (_reason, code, status, expected) => {
    graph("PURCHASE", { historyError: { code, status } });
    const meta = new MetaClient(creds);
    await expect(meta.getCampaignInsights(CAMPAIGN)).rejects.toMatchObject(expected);
    await expect(meta.getAdResults(CAMPAIGN)).rejects.toMatchObject(expected);
  });

  it("surfaces a bodyless HTTP 429 from the optional history read", async () => {
    graph("PURCHASE", { historyError: { status: 429 } });
    await expect(new MetaClient(creds).getCampaignInsights(CAMPAIGN)).rejects.toMatchObject({ status: 429, reason: "rate_limited" });
  });

  it("does not retry a timed-out optional value request without an execution deadline", async () => {
    const paths = graph("PURCHASE", { timeoutValues: true });
    await expect(new MetaClient(creds).getCampaignInsights(CAMPAIGN)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(paths.filter(path => path.includes("/insights?"))).toHaveLength(1);
  });

  it("does not turn an expired connection into a successful fallback", async () => {
    const paths = graph("PURCHASE", { rejectActionValues: 190 });
    await expect(new MetaClient(creds).getCampaignInsights(CAMPAIGN)).rejects.toMatchObject({ code: 190 });
    expect(paths.filter((path) => path.includes("/insights?"))).toHaveLength(1);
  });

  it("keeps the core read when optional values repeatedly receive a server error", async () => {
    const paths = graph("PURCHASE", { rejectActionValues: 2, rejectionStatus: 503 });
    const campaign = await new MetaClient(creds).getCampaignInsights(CAMPAIGN);
    expect(campaign).toMatchObject({ spend: 1200, landingPageViews: 84, conversionsUnavailable: true });
    expect(campaign).not.toHaveProperty("conversions");
    expect(paths.filter((path) => path.includes("/insights?"))).toHaveLength(3);
  });

  it("does not bypass provider throttling with a fallback read", async () => {
    const paths = graph("PURCHASE", { rejectActionValues: 4, rejectionStatus: 429 });
    await expect(new MetaClient(creds).getCampaignInsights(CAMPAIGN)).rejects.toMatchObject({ reason: "rate_limited" });
    expect(paths.filter((path) => path.includes("/insights?"))).toHaveLength(1);
  });

  it("checks deleted and archived ad sets before attributing lifetime results", async () => {
    const previous = {
      id: "120000000000209", status: "DELETED", destination_type: "WEBSITE",
      promoted_object: { page_id: creds.pageId, custom_event_type: "LEAD" },
    };
    const paths = graph("PURCHASE", { history: { data: [previous] } });
    const meta = new MetaClient(creds);
    const campaign = await meta.getCampaignInsights(CAMPAIGN);
    expect(campaign).toMatchObject({ conversionsUnavailable: true, spend: 1200, landingPageViews: 84 });
    expect(campaign).not.toHaveProperty("conversions");
    expect(campaign).not.toHaveProperty("conversionGoal");
    const ads = await meta.getAdResults(CAMPAIGN);
    expect(ads[0]).toMatchObject({ conversionsUnavailable: true, spend: 800, landingPageViews: 60 });
    expect(ads[0]).not.toHaveProperty("conversions");
    const historyPath = paths.find((path) => path.includes("/adsets?") && path.includes("filtering="));
    expect(historyPath).toBeDefined();
    const requestedFilter = new URLSearchParams(historyPath!.split("?")[1]).get("filtering");
    const recordedFilter = new URLSearchParams(deletedCampaign.tape[3].path.split("?")[1]).get("filtering");
    expect(requestedFilter).toBe(recordedFilter);
  });

  it.each([
    ["a missing event", { data: [{ id: "120000000000209", destination_type: "WEBSITE", promoted_object: { page_id: creds.pageId } }] }],
    ["another Page", { data: [{ id: "120000000000209", destination_type: "WEBSITE", promoted_object: { page_id: "other-page", custom_event_type: "PURCHASE" } }] }],
    ["an incomplete page", { data: [], paging: { next: "more" } }],
    ["malformed history", { data: null }],
  ])("keeps conversions unavailable when historical ad sets have %s", async (_reason, history) => {
    graph("PURCHASE", { history });
    const campaign = await new MetaClient(creds).getCampaignInsights(CAMPAIGN);
    expect(campaign).toMatchObject({ conversionsUnavailable: true, spend: 1200, landingPageViews: 84 });
    expect(campaign).not.toHaveProperty("conversions");
    expect(campaign).not.toHaveProperty("conversionGoal");
  });

  it("a visits campaign sends the same requests as before and reads no conversions", async () => {
    const paths = graph(null);
    const meta = new MetaClient(creds);
    expect(await meta.getCampaignInsights(CAMPAIGN)).not.toHaveProperty("conversions");
    expect((await meta.getAdResults(CAMPAIGN)).every((ad) => !("conversions" in ad))).toBe(true);
    expect(paths.filter((path) => path.includes("/insights?"))).toEqual([
      `${CAMPAIGN}/insights?fields=impressions,clicks,spend,actions,date_start,date_stop&date_preset=maximum`,
      `${CAMPAIGN}/insights?level=ad&fields=ad_id,impressions,clicks,spend,actions&date_preset=maximum&limit=100`,
    ]);
  });
});
