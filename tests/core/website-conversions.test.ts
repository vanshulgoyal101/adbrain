import { afterEach, describe, expect, it, vi } from "vitest";
import provisional from "./fixtures/meta/website-conversions.provisional.json";
import visits from "./fixtures/meta/website-results.provisional.json";
import launch from "./fixtures/meta/launch-validate-website-conversions.json";
import whatsappRecorded from "./fixtures/meta/whatsapp-results.json";
import { MetaClient } from "@/lib/meta/client";
import { decodeAdResults, decodeCampaignInsights } from "@/lib/meta/insights";
import { conversionGoalFromAdSets } from "@/lib/campaign/outcomes";
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
  function graph(customEventType: string | null) {
    const paths: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if ((init?.method ?? "GET") !== "GET") throw new Error("Results reads are read-only.");
      const url = new URL(String(input));
      url.searchParams.delete("access_token");
      const path = url.pathname.replace("/v26.0/", "") + decodeURIComponent(url.search);
      paths.push(path);
      if (path.startsWith(`${CAMPAIGN}?`)) return Response.json({ id: CAMPAIGN, account_id: "9000000000000001", status: "ACTIVE" });
      if (path.startsWith(`${CAMPAIGN}/adsets?`)) {
        return Response.json({ data: [{ id: "120000000000210", destination_type: "WEBSITE", promoted_object: { page_id: creds.pageId, ...(customEventType ? { pixel_id: "1", custom_event_type: customEventType } : {}) } }] });
      }
      if (path.startsWith(`${CAMPAIGN}/ads?`)) return Response.json(provisional.sales.ads.list);
      if (path.includes("level=ad")) return Response.json(provisional.sales.ads.insights);
      if (path.startsWith(`${CAMPAIGN}/insights?`)) return Response.json(provisional.sales.payload);
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
