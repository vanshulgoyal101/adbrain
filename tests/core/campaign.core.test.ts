import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaClient } from "@/lib/meta/client";
import run4 from "./fixtures/create-cedar-ridge-run4.json";
import graph from "./fixtures/graph-v21-lead-campaign.json";
import { requestBody, requestUrl } from "./replay";

// Core regression gate (#110): launch PAUSED, sync, read results and pause through the real
// Meta client against a Graph v21.0 replay. Nothing may ask Meta to deliver.

const GRAPH = "https://graph.facebook.com/v21.0/";
const SUPABASE = "https://core-test.supabase.co";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

type Call = { method: string; url: URL; form: URLSearchParams };

function stubGraph() {
  const calls: Call[] = [];
  const served = new Map<object, number>();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(requestUrl(input));
    const method = init?.method ?? "GET";
    calls.push({ method, url, form: new URLSearchParams(requestBody(init)) });
    if (url.origin === SUPABASE) return new Response(PNG, { headers: { "content-type": "image/png" } });
    if (!url.href.startsWith(GRAPH)) throw new Error(`Unexpected request: ${url.origin}`);
    const path = decodeURIComponent(url.pathname.slice("/v21.0/".length));
    const route = graph.routes.find((candidate) => candidate.method === method && candidate.path === path
      && (!candidate.fields || url.searchParams.get("fields") === candidate.fields));
    if (!route) {
      return Response.json({ error: { message: `No recorded Graph response for ${method} ${path}`, type: "OAuthException", code: 100 } }, { status: 400 });
    }
    const index = served.get(route) ?? 0;
    served.set(route, index + 1);
    return Response.json(route.responses[Math.min(index, route.responses.length - 1)]);
  }));
  return calls;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Campaign core loop", () => {
  it("launches PAUSED, syncs, reads results and pauses without ever activating delivery", async () => {
    const calls = stubGraph();
    const meta = new MetaClient({ adAccountId: graph.adAccountId, pageId: graph.pageId, accessToken: "core-token" });

    const created = await meta.createLeadCampaign({
      name: "Cedar Ridge new-patient leads",
      dailyBudgetRupees: 800,
      leadFormId: graph.leadFormId,
      link: "https://facebook.com",
      creatives: run4.angles.map(({ angleId, concept }) => ({
        imageUrl: `${SUPABASE}/storage/v1/object/public/creatives/${run4.brand.id}/core/${angleId}.webp`,
        headline: concept.headline,
        message: concept.primary_text,
        description: concept.description,
        cta: concept.cta,
      })),
      location: { cities: [{ key: "2490299", radius: 25, distance_unit: "kilometer" }] },
      ageMin: 25,
      ageMax: 55,
      destination: "instant_form",
    });
    expect(created).toEqual({
      campaignId: graph.campaignId,
      adSetId: graph.adSetId,
      adSetIds: [graph.adSetId],
      adIds: ["120200000000000021", "120200000000000022", "120200000000000023"],
      destination: "instant_form",
    });

    const page = await meta.listCampaignsPage();
    expect(page.nextCursor).toBeNull();
    expect(page.campaigns.map((campaign) => campaign.id)).toEqual([graph.campaignId]);
    expect(await meta.readBoundCampaign(page.campaigns[0])).toEqual({ dailyBudgetRupees: 800, adSetId: graph.adSetId, destination: "instant_form" });

    expect(await meta.getCampaignInsights(graph.campaignId)).toMatchObject({ destination: "instant_form", impressions: 0, leads: 0 });

    await meta.updateCampaignStatus(graph.campaignId, "PAUSED");

    const graphCalls = calls.filter(({ url }) => url.href.startsWith(GRAPH));
    expect(calls.filter(({ url }) => !url.href.startsWith(GRAPH)).map(({ url }) => url.origin)).toEqual([SUPABASE, SUPABASE, SUPABASE]);
    const posts = graphCalls.filter(({ method }) => method === "POST");
    expect(posts.map(({ url }) => url.pathname.split("/").at(-1))).toEqual([
      "campaigns", "adimages", "adimages", "adimages", "adsets",
      "adcreatives", "ads", "adcreatives", "ads", "adcreatives", "ads",
      graph.campaignId,
    ]);
    for (const post of posts.filter(({ url }) => /\/(campaigns|adsets|ads)$/.test(url.pathname) || url.pathname.endsWith(graph.campaignId))) {
      expect(post.form.get("status"), post.url.pathname).toBe("PAUSED");
    }
    expect(graphCalls.some(({ url, form }) => `${url.search}&${form}`.includes("ACTIVE"))).toBe(false);
    expect(graphCalls.every(({ method }) => method === "GET" || method === "POST")).toBe(true);

    const adSet = posts.find(({ url }) => url.pathname.endsWith("/adsets"))!;
    expect(adSet.form.get("daily_budget")).toBe("80000");
    expect(adSet.form.get("destination_type")).toBe("ON_AD");
    expect(JSON.parse(adSet.form.get("promoted_object")!)).toEqual({ page_id: graph.pageId });
    expect(JSON.parse(adSet.form.get("targeting")!)).toMatchObject({
      age_min: 25, age_max: 55, geo_locations: { cities: [{ key: "2490299", radius: 25, distance_unit: "kilometer" }] },
    });
    const stories = posts.filter(({ url }) => url.pathname.endsWith("/adcreatives"))
      .map(({ form }) => JSON.parse(form.get("object_story_spec")!));
    expect(stories.map((story) => story.link_data.name)).toEqual(run4.angles.map(({ concept }) => concept.headline));
    for (const story of stories) {
      expect(story.page_id).toBe(graph.pageId);
      expect(story.link_data.call_to_action).toEqual({ type: "LEARN_MORE", value: { lead_gen_form_id: graph.leadFormId } });
    }
  });
});
