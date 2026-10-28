import { afterEach, describe, expect, it, vi } from "vitest";
import prepareTape from "./fixtures/meta/prepare.json";
import createTape from "./fixtures/meta/create.json";
// #741: Meta's recorded region/country of each launched place (the service-area read).
import geoTape from "./fixtures/meta/geo-exclusions.json";
import deliveryTape from "./fixtures/meta/delivery.json";
import syncTape from "./fixtures/meta/sync.json";
import pauseTape from "./fixtures/meta/pause.json";

// Graph responses recorded from one real PAUSED Solaride test campaign by
// scripts/record-meta-core-fixtures.ts (campaign archived afterwards).
vi.mock("@/lib/security/ssrf", () => ({
  fetchPublicUrl: async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
}));

import { MetaClient } from "@/lib/meta/client";

type Exchange = { method: string; path: string; form?: Record<string, string>; status: number; body: unknown };
type Sent = { method: string; path: string; form: Record<string, string> };

const creds = { adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" };
const campaignId = "120253646427440526";
const adSetIds = ["120253646428630526"];
const adIds = ["120253646430200526"];

function replay(...tapes: unknown[][]) {
  const pending = tapes.flat() as Exchange[];
  const sent: Sent[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin + url.pathname.slice(0, 7)).toBe("https://graph.facebook.com/v26.0/");
    url.searchParams.delete("access_token");
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/v26.0/", "") + url.search;
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

afterEach(() => vi.restoreAllMocks());

describe("core: Meta campaign half against recorded Graph responses", () => {
  it("prepares a lead form, location and interests, then launches everything PAUSED", async () => {
    const tape = replay(prepareTape, createTape, geoTape.filter(exchange => exchange.path.includes("2525495")));
    const meta = new MetaClient(creds);
    const forms = await meta.listLeadForms();
    const geo = await meta.resolveGeoTargeting(["Austin, Texas"], { cityScope: "city_only" });
    const audience = await meta.resolveAudienceInterests(["Chiropractic"]);
    expect(forms.length).toBeGreaterThan(0);
    expect(geo.unresolved).toEqual([]);
    expect(geo.targeting.cities?.[0]).not.toHaveProperty("radius");

    const created = await meta.createLeadCampaign({
      name: "AdBrain core fixture 2026-10-21T15:54 (PAUSED test)", dailyBudgetRupees: 200,
      leadFormId: forms[0].id, link: "https://adbrain.vanshul.com",
      creatives: [{
        imageUrl: "https://example.com/ad.png", headline: "Diwali Renewal, Starting With Your Spine",
        message: "A $49 new-patient exam with a digital posture scan. Same-day and Saturday appointments.",
        cta: "Book Now",
      }],
      ageMin: 25, ageMax: 55, gender: "all", interests: audience.interests,
      location: geo.targeting, destination: "instant_form",
    });

    // #672: the creative id is Meta's recorded answer to the adcreatives POST.
    expect(created).toEqual({ campaignId, adSetId: adSetIds[0], adSetIds, adIds, destination: "instant_form", creativeIds: ["1148404661464451"] });
    expect(tape.pending).toEqual([]);
    const posts = tape.sent.filter(call => call.method === "POST");
    expect(posts.map(call => call.path)).toEqual([
      `${creds.adAccountId}/campaigns`, `${creds.adAccountId}/adimages`, `${creds.adAccountId}/adsets`,
      `${creds.adAccountId}/adcreatives`, `${creds.adAccountId}/ads`,
    ]);
    for (const path of ["campaigns", "adsets", "ads"]) {
      expect(posts.find(call => call.path.endsWith(`/${path}`))?.form.status).toBe("PAUSED");
    }
    expect(JSON.stringify(tape.sent)).not.toContain("ACTIVE");
    expect(posts.find(call => call.path.endsWith("/adsets"))?.form.daily_budget).toBe("20000");
    // Request bodies still match what Meta accepted when recorded. Targeting changed in #334
    // (Advantage+ audience) and #680 (no Audience Network); advantage-audience.test.ts and
    // leadform-placements.test.ts check those against Meta's validate_only answers.
    for (const exchange of createTape as unknown as Exchange[]) {
      const sent = posts.find(call => call.path === exchange.path)!;
      const { targeting, ...rest } = sent.form;
      const { targeting: recordedTargeting, ...recordedRest } = exchange.form ?? {};
      expect({ ...rest, bytes: exchange.form?.bytes }).toEqual({ ...recordedRest, bytes: exchange.form?.bytes });
      if (recordedTargeting) {
        expect(JSON.parse(targeting)).toEqual({ ...JSON.parse(String(recordedTargeting)), age_min: 25, age_max: 65, age_range: [25, 55], targeting_automation: { advantage_audience: 1 }, publisher_platforms: ["facebook", "instagram", "messenger"] });
      }
    }
  });

  it("reads the launched campaign back from Meta as PAUSED with the intended children", async () => {
    replay(deliveryTape);
    const snapshot = await new MetaClient(creds).readCampaignDelivery(campaignId, {
      dailyBudgetRupees: 200, status: "paused", adSetIds, adIds,
    });
    expect(snapshot.campaign.status).toBe("PAUSED");
    expect(snapshot.adSets.map(adSet => [adSet.id, adSet.status, adSet.dailyBudgetPaise, adSet.pageId]))
      .toEqual([[adSetIds[0], "PAUSED", 20000, creds.pageId]]);
    expect(snapshot.ads.map(ad => [ad.id, ad.status])).toEqual([[adIds[0], "PAUSED"]]);
  });

  it("syncs the campaign from the ad account listing", async () => {
    const tape = replay(syncTape);
    const meta = new MetaClient(creds);
    const page = await meta.listCampaignsPage();
    const listed = page.campaigns.find(campaign => campaign.id === campaignId);
    expect(listed?.status).toBe("PAUSED");
    expect(await meta.readBoundCampaign(listed!)).toEqual({ dailyBudgetRupees: 200, adSetId: adSetIds[0], destination: "instant_form" });
    expect(tape.pending).toEqual([]);
  });

  // #671: sync names why it left a campaign unchanged, from the same recorded Graph reads.
  it.each<{ reason: string; capped?: string[]; pageId?: string; campaign?: Record<string, string> }>([
    { reason: "capped", capped: adSetIds },
    { reason: "other_page", pageId: "1" },
    { reason: "not_running", campaign: { status: "ARCHIVED" } },
    { reason: "lifetime_budget", campaign: { lifetime_budget: "500000" } },
  ])("says why sync skips a campaign: $reason", async ({ reason, capped = [], pageId = creds.pageId, campaign = {} }) => {
    replay(syncTape);
    const meta = new MetaClient({ ...creds, pageId });
    const listed = (await meta.listCampaignsPage()).campaigns.find(listing => listing.id === campaignId)!;
    expect(await meta.readBoundCampaign({ ...listed, ...campaign }, capped)).toEqual({ skip: reason });
  });

  it("pauses only after verifying the account binding, and never sends ACTIVE", async () => {
    const tape = replay(pauseTape);
    await new MetaClient(creds).updateCampaignStatus(campaignId, "PAUSED");
    expect(tape.pending).toEqual([]);
    expect(tape.sent.at(-1)).toEqual({ method: "POST", path: campaignId, form: { status: "PAUSED" } });
    expect(tape.sent.slice(0, -1).every(call => call.method === "GET")).toBe(true);
  });

  it("refuses to pause a campaign bound to another ad account", async () => {
    replay(pauseTape);
    await expect(new MetaClient({ ...creds, adAccountId: "act_1" }).updateCampaignStatus(campaignId, "PAUSED")).rejects.toThrow();
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
});
