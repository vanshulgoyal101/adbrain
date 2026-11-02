import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/launch-validate-website.json";
import { MetaClient, MetaError, destinationCTA, destinationPlan, editedCreativeForm } from "@/lib/meta/client";
import { isWebsiteLink } from "@/lib/meta/destinations";
import { destinationFromAdSets } from "@/lib/campaign/outcomes";
import { checkPlan, type PlannedCampaign } from "@/lib/campaign/plan-check";

// #2598 (#2595 phase 1): a website-visits launch (OUTCOME_TRAFFIC, WEBSITE ad set optimised for landing-page
// views, link ad with UTM url_tags) must send exactly payloads Meta accepted with validate_only. Recorded by
// `scripts/record-meta-launch-validate.ts --website` on the Solaride account: ads only validated, PAUSED parents
// deleted. The WhatsApp and lead-form tapes (launch-validate.json) are untouched; that gate stays as it is.

vi.mock("@/lib/security/ssrf", () => ({
  fetchPublicUrl: async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
}));

type Exchange = { destination: string; kind: string; form: Record<string, string>; status: number; body: unknown };
const tape = recorded.tape as unknown as Exchange[];
const inputs = recorded.inputs;
const launchTape = tape.filter((e) => ["campaigns", "adsets", "adcreatives", "ads"].includes(e.kind));
const IDS: Record<string, string> = { campaigns: "CAMPAIGN", adsets: "ADSET", adcreatives: "CREATIVE", ads: "AD" };

let sent: { kind: string; form: Record<string, string> }[] = [];

async function launch(overrides: { link?: string; cta?: string } = {}, onPlanned?: (plan: Omit<PlannedCampaign, "costPerResultRupees">) => void) {
  sent = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if ((init?.method ?? "GET") !== "POST") {
      if (url.searchParams.get("type") === "adgeolocationmeta") {
        url.searchParams.delete("access_token");
        expect(url.pathname.replace("/v26.0/", "") + url.search).toBe(recorded.geoMeta.path);
        return Response.json(recorded.geoMeta.body, { status: recorded.geoMeta.status });
      }
      throw new Error(`Unexpected Graph read during a website launch: ${url.pathname}?${url.searchParams.get("fields")}`);
    }
    const kind = url.pathname.split("/").pop()!;
    if (kind === "adimages") return Response.json({ images: { image: { hash: "FEED_HASH" } } });
    sent.push({ kind, form: Object.fromEntries([...(init!.body as URLSearchParams)].filter(([key]) => key !== "access_token")) });
    return Response.json({ id: IDS[kind] });
  });
  const meta = new MetaClient({ adAccountId: "act_ACCOUNT", pageId: "PAGE", accessToken: "test-token" });
  await meta.createLeadCampaign({
    name: inputs.name, dailyBudgetRupees: inputs.dailyBudgetRupees, link: overrides.link ?? inputs.link,
    ageMin: inputs.ageMin, ageMax: inputs.ageMax, gender: inputs.gender as "all", location: inputs.location, interests: inputs.interests,
    creatives: [{ imageUrl: "https://adbrain.vanshul.com/solar-example.jpg", ...inputs.creative, ...(overrides.cta ? { cta: overrides.cta } : {}) }],
    destination: "website",
    onPlanned,
  });
  vi.restoreAllMocks();
  return sent;
}

afterEach(() => vi.restoreAllMocks());

describe("core: website-visits launch payloads Meta accepted with validate_only (#2598)", () => {
  it("the tape covers every object, all accepted, with the ad PAUSED", () => {
    expect(launchTape.map((e) => [e.destination, e.kind])).toEqual([
      ["website", "campaigns"], ["website", "adsets"], ["website", "adcreatives"], ["website", "ads"],
    ]);
    for (const exchange of tape) expect(exchange, exchange.kind).toMatchObject({ status: 200, body: { success: true } });
    expect(launchTape.find((e) => e.kind === "ads")!.form.status).toBe("PAUSED");
  });

  it("Meta accepted a traffic campaign, a WEBSITE ad set for landing-page views on the Page and a link ad with UTM tags", () => {
    const form = (kind: string) => launchTape.find((e) => e.kind === kind)!.form;
    expect(form("campaigns")).toMatchObject({ objective: "OUTCOME_TRAFFIC", status: "PAUSED" });
    expect(form("adsets")).toMatchObject({ destination_type: "WEBSITE", optimization_goal: "LANDING_PAGE_VIEWS", status: "PAUSED" });
    // The Page link every later sync, pause and edit checks (readCampaignBinding).
    expect(JSON.parse(form("adsets").promoted_object)).toEqual({ page_id: "PAGE" });
    const targeting = JSON.parse(form("adsets").targeting);
    expect(targeting.publisher_platforms).toEqual(["facebook", "instagram", "messenger"]);
    const creative = form("adcreatives");
    expect(creative.url_tags).toBe("utm_source=meta&utm_medium=paid&utm_campaign=CAMPAIGN");
    const link = JSON.parse(creative.object_story_spec).link_data;
    expect(link.link).toBe(inputs.link);
    expect(link.call_to_action).toEqual({ type: "LEARN_MORE", value: { link: inputs.link } });
    expect(link.page_welcome_message).toBeUndefined();
  });

  it("Meta accepted the Shop now and Sign up buttons on the same link ad", () => {
    for (const type of ["SHOP_NOW", "SIGN_UP"]) {
      const exchange = tape.find((e) => e.kind === `adcreatives-cta-${type}`)!;
      expect(JSON.parse(exchange.form.object_story_spec).link_data.call_to_action).toEqual({ type, value: { link: inputs.link } });
    }
  });

  it("today's website launch sends exactly the payloads Meta accepted", async () => {
    const sent = await launch();
    expect(sent.map((s) => s.kind)).toEqual(launchTape.map((e) => e.kind));
    sent.forEach((s, i) => {
      expect(s.form, `website ${s.kind} changed: re-record with scripts/record-meta-launch-validate.ts --website`).toEqual(launchTape[i].form);
    });
  });

  it("hands the plan check the ad set and creative Meta accepted", async () => {
    let planned: Omit<PlannedCampaign, "costPerResultRupees"> | undefined;
    await launch({}, (plan) => { planned = plan; });
    expect(planned).toEqual({
      adSets: launchTape.filter((e) => e.kind === "adsets").map((e) => e.form),
      creatives: launchTape.filter((e) => e.kind === "adcreatives").map((e) => e.form),
    });
    expect(checkPlan(planned!).find((finding) => finding.rule === "Advantage+ audience")?.status).toBe("pass");
  });

  it.each([["Shop Now", "SHOP_NOW"], ["Buy now", "SHOP_NOW"], ["Sign up", "SIGN_UP"], ["Register", "SIGN_UP"], ["Get Quote", "LEARN_MORE"], [null, "LEARN_MORE"], ["shop_now", "SHOP_NOW"], ["sign_up", "SIGN_UP"], ["learn_more", "LEARN_MORE"]])(
    "the %s button becomes Meta's %s with the website link",
    (label, type) => {
      expect(destinationCTA("website", { link: "https://shop.example.in/", ctaLabel: label })).toEqual({ type, value: { link: "https://shop.example.in/" } });
    },
  );

  it.each(["https://shop.example.in/", "https://www.solaride.in/quote?x=1", "https://notfacebook.com/", "https://facebook.com.shop.example.in/"])(
    "accepts the business's own website %s",
    (link) => expect(isWebsiteLink(link)).toBe(true),
  );

  it("an edited website ad keeps its UTM tags (#775 edit, #2598)", () => {
    const stored = { name: "Old", url_tags: "utm_source=meta&utm_medium=paid&utm_campaign=CAMPAIGN", object_story_spec: JSON.parse(launchTape.find((e) => e.kind === "adcreatives")!.form.object_story_spec) };
    expect(editedCreativeForm(stored, { headline: "New headline" })).toMatchObject({ name: "New headline", url_tags: stored.url_tags });
    expect(editedCreativeForm({ ...stored, url_tags: undefined }, { headline: "New headline" })).not.toHaveProperty("url_tags");
  });

  it("a synced campaign whose ad sets Meta reports as WEBSITE reads back as a website campaign", () => {
    expect(destinationFromAdSets([{ destination_type: launchTape.find((e) => e.kind === "adsets")!.form.destination_type }])).toBe("website");
    expect(destinationFromAdSets([{ destination_type: "WEBSITE" }, { destination_type: "WHATSAPP" }])).toBe("mixed");
  });

  it("plans a WEBSITE ad set for landing-page views", () => {
    expect(destinationPlan("website")).toEqual({ optimizationGoal: "LANDING_PAGE_VIEWS", destinationType: "WEBSITE" });
  });

  it.each([
    "", "http://shop.example.in", "javascript:alert(1)", "https://localhost/", "https://user:pass@shop.example.in/",
    "https://wa.me/910000000000", "HTTPS://WA.ME/91", "https://wa.me./91", "https://api.whatsapp.com/send", "https://wa.link/x",
    "https://facebook.com./page", "https://l.facebook.com/l.php", "https://business.facebook.com/x", "https://fb.me/x",
    "https://m.instagram.com/x", "https://instagr.am/x", "https://m.me/page",
  ])("refuses the website link %j before anything reaches Meta", async (link) => {
    await expect(launch({ link })).rejects.toBeInstanceOf(MetaError);
    expect(sent).toEqual([]);
  });
});
