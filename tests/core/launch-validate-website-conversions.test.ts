import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/launch-validate-website-conversions.json";
import visits from "./fixtures/meta/launch-validate-website.json";
import { MetaClient, MetaError, type MetaCampaignSummary } from "@/lib/meta/client";
import { campaignObjective, destinationPlan, websiteConversionEvent } from "@/lib/meta/destinations";
import type { AdDestination } from "@/lib/meta/destinations";
import type { WebsiteGoal } from "@/lib/types/campaign";

// #2713 (#2595 B2): website leads/sales launches (OUTCOME_LEADS/OUTCOME_SALES, OFFSITE_CONVERSIONS ad set promoting the
// pixel's LEAD/PURCHASE event) must send exactly payloads Meta accepted with validate_only. Recorded by
// `scripts/record-meta-launch-validate.ts --website-conversions` on the Solaride account's test pixel (#2717): ads only
// validated, PAUSED parents deleted. Visits, WhatsApp and lead-form tapes are untouched.

vi.mock("@/lib/security/ssrf", () => ({
  fetchPublicUrl: async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
}));

type Exchange = { destination: string; goal?: WebsiteGoal; kind: string; form: Record<string, string>; status: number; body: unknown };
const tape = recorded.tape as unknown as Exchange[];
const inputs = recorded.inputs;
const IDS: Record<string, string> = { campaigns: "CAMPAIGN", adsets: "ADSET", adcreatives: "CREATIVE", ads: "AD" };

let sent: { kind: string; form: Record<string, string> }[] = [];

async function launch(params: { websiteGoal?: WebsiteGoal; pixelId?: string; destination?: AdDestination; geo?: typeof recorded.geoMeta }) {
  sent = [];
  const geo = params.geo ?? recorded.geoMeta;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if ((init?.method ?? "GET") !== "POST") {
      if (url.searchParams.get("type") === "adgeolocationmeta") {
        url.searchParams.delete("access_token");
        expect(url.pathname.replace("/v26.0/", "") + url.search).toBe(geo.path);
        return Response.json(geo.body, { status: geo.status });
      }
      throw new Error(`Unexpected Graph read during a website launch: ${url.pathname}?${url.searchParams.get("fields")}`);
    }
    const kind = url.pathname.split("/").pop()!;
    if (kind === "adimages") return Response.json({ images: { image: { hash: "FEED_HASH" } } });
    sent.push({ kind, form: Object.fromEntries([...(init!.body as URLSearchParams)].filter(([key]) => key !== "access_token")) });
    return Response.json({ id: IDS[kind] });
  });
  const meta = new MetaClient({ adAccountId: "act_ACCOUNT", pageId: "PAGE", accessToken: "test-token" });
  try {
    await meta.createLeadCampaign({
      name: inputs.name, dailyBudgetRupees: inputs.dailyBudgetRupees, link: inputs.link,
      ageMin: inputs.ageMin, ageMax: inputs.ageMax, gender: inputs.gender as "all", location: inputs.location, interests: inputs.interests,
      creatives: [{ imageUrl: "https://adbrain.vanshul.com/solar-example.jpg", ...inputs.creative }],
      destination: params.destination ?? "website",
      ...(params.destination === "whatsapp" ? { whatsappNumber: inputs.phone, boundWhatsAppNumbers: [inputs.phone] } : {}),
      ...(params.destination === "instant_form" ? { leadFormId: "LEAD_FORM" } : {}),
      websiteGoal: params.websiteGoal,
      pixelId: params.pixelId,
    });
  } finally {
    vi.restoreAllMocks();
  }
  return sent;
}

afterEach(() => vi.restoreAllMocks());

describe("core: website leads/sales launch payloads Meta accepted with validate_only (#2713)", () => {
  it("the tape covers every object for leads and sales, all accepted, with ads PAUSED", () => {
    for (const goal of ["leads", "sales"] as const) {
      expect(tape.filter((e) => e.goal === goal).map((e) => e.kind)).toEqual(["campaigns", "adsets", "adcreatives", "ads"]);
    }
    for (const exchange of tape) expect(exchange, `${exchange.goal} ${exchange.kind}`).toMatchObject({ status: 200, body: { success: true } });
    for (const ad of tape.filter((e) => e.kind === "ads")) expect(ad.form.status).toBe("PAUSED");
  });

  it.each([["leads", "OUTCOME_LEADS", "LEAD"], ["sales", "OUTCOME_SALES", "PURCHASE"]] as const)(
    "Meta accepted a %s campaign (%s) with an OFFSITE_CONVERSIONS WEBSITE ad set promoting the pixel's %s event",
    (goal, objective, event) => {
      const form = (kind: string) => tape.find((e) => e.goal === goal && e.kind === kind)!.form;
      expect(form("campaigns")).toMatchObject({ objective, status: "PAUSED" });
      expect(form("adsets")).toMatchObject({ destination_type: "WEBSITE", optimization_goal: "OFFSITE_CONVERSIONS", billing_event: "IMPRESSIONS", status: "PAUSED" });
      expect(JSON.parse(form("adsets").promoted_object)).toEqual({ page_id: "PAGE", pixel_id: "PIXEL", custom_event_type: event });
      expect(JSON.parse(form("adsets").targeting).publisher_platforms).toEqual(["facebook", "instagram", "messenger"]);
      expect(form("adcreatives").url_tags).toBe("utm_source=meta&utm_medium=paid&utm_campaign=CAMPAIGN");
      expect(JSON.parse(form("adcreatives").object_story_spec).link_data.call_to_action).toEqual({ type: "LEARN_MORE", value: { link: inputs.link } });
      expect([campaignObjective("website", goal), destinationPlan("website", goal), websiteConversionEvent(goal)])
        .toEqual([objective, { optimizationGoal: "OFFSITE_CONVERSIONS", destinationType: "WEBSITE" }, event]);
    },
  );

  it.each(["leads", "sales"] as const)("today's website %s launch sends exactly the payloads Meta accepted", async (goal) => {
    const accepted = tape.filter((e) => e.goal === goal);
    await launch({ websiteGoal: goal, pixelId: "1234567890" });
    expect(sent.map((s) => s.kind)).toEqual(accepted.map((e) => e.kind));
    sent.forEach((s, i) => {
      const expected = JSON.parse(JSON.stringify(accepted[i].form).replaceAll("PIXEL", "1234567890"));
      expect(s.form, `website ${goal} ${s.kind} changed: re-record with scripts/record-meta-launch-validate.ts --website-conversions`).toEqual(expected);
    });
  });

  // CPO (#2595): sync, Pause and budget edits recognise our ad sets by promoted_object.page_id. Meta kept it.
  it.each(["leads", "sales"] as const)("Meta stored the Page on the %s ad set, so sync still binds it to this Page", async (goal) => {
    const readback = recorded.adSetReadbacks.find((r) => r.goal === goal)!;
    expect(readback.status).toBe(200);
    expect(readback.body.promoted_object).toMatchObject({ page_id: "PAGE", pixel_id: "PIXEL" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({
      data: [{ ...readback.body, status: "PAUSED", daily_budget: "28000" }],
    }));
    const meta = new MetaClient({ adAccountId: "act_ACCOUNT", pageId: "PAGE", accessToken: "test-token" });
    const bound = await meta.readBoundCampaign({ id: "CAMPAIGN", name: inputs.name, status: "PAUSED", account_id: "ACCOUNT" } as MetaCampaignSummary & { account_id: string });
    expect(bound).toEqual({ dailyBudgetRupees: 280, adSetId: "ADSET", destination: "website" });
  });

  it("an explicit visits goal sends exactly the website-visits payloads Meta accepted (#2598)", async () => {
    const visitsTape = (visits.tape as unknown as Exchange[]).filter((e) => ["campaigns", "adsets", "adcreatives", "ads"].includes(e.kind));
    await launch({ websiteGoal: "visits", geo: visits.geoMeta });
    const named = (form: Record<string, string>) => JSON.parse(JSON.stringify(form).replaceAll(inputs.name, visits.inputs.name));
    expect(sent.map((s) => named(s.form))).toEqual(visitsTape.map((e) => e.form));
  });

  it.each<[string, { websiteGoal?: WebsiteGoal; pixelId?: string; destination?: AdDestination }]>([
    ["leads without a pixel", { websiteGoal: "leads" }],
    ["sales without a pixel", { websiteGoal: "sales" }],
    ["a non-numeric pixel", { websiteGoal: "leads", pixelId: "123abc" }],
    ["a pixel on a visits ad", { websiteGoal: "visits", pixelId: "1234567890" }],
    ["a pixel with no goal", { pixelId: "1234567890" }],
    ["an unknown goal", { websiteGoal: "signups" as WebsiteGoal, pixelId: "1234567890" }],
    ["a website goal on a WhatsApp ad", { destination: "whatsapp", websiteGoal: "leads", pixelId: "1234567890" }],
    ["a website goal on a lead-form ad", { destination: "instant_form", websiteGoal: "sales", pixelId: "1234567890" }],
  ])("refuses %s before anything reaches Meta", async (_label, params) => {
    await expect(launch(params)).rejects.toBeInstanceOf(MetaError);
    expect(sent).toEqual([]);
  });
});
