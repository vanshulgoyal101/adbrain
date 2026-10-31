import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/no-facebook-reels-validate.json";
import { MetaClient, placementCreativeSpec, withoutAudienceNetwork, type AdDestination } from "@/lib/meta/client";
import { checkPlan, type PlannedCampaign } from "@/lib/campaign/plan-check";
import { draftInputSchema } from "@/lib/campaign/connect-contracts";
import { buildCanonicalReviewPayload } from "@/lib/campaign/preflight";
import { buildManualDraftInput } from "@/lib/campaign/manual-draft-input";

// #2273 (#680 placement test): an internal-only draft option leaves Facebook Reels out of WhatsApp and
// lead-form ad sets, and out of the 9:16 placement creative's story rule. Recorded with validate_only by
// `scripts/record-meta-launch-validate.ts --no-facebook-reels` (PAUSED parents deleted; nothing delivered).
// Off by default: tests/core/launch-validate.test.ts still pins the default payloads.

vi.mock("@/lib/security/ssrf", () => ({
  fetchPublicUrl: async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
}));

type Exchange = { destination: AdDestination; kind: string; form: Record<string, string>; status: number; body: unknown };
const tape = recorded.tape as unknown as Exchange[];
const inputs = recorded.inputs;
const KINDS = ["campaigns", "adsets", "adcreatives", "ads"];
const IDS: Record<string, string> = { campaigns: "CAMPAIGN", adsets: "ADSET", adcreatives: "CREATIVE", ads: "AD" };
const CONTROL = "control-ads-story-rule-with-facebook-reels";
type Plan = Omit<PlannedCampaign, "costPerResultRupees">;

async function launch(destination: AdDestination, excludeFacebookReels: boolean | undefined, onPlanned?: (plan: Plan) => void) {
  const sent: { kind: string; form: Record<string, string> }[] = [];
  let uploads = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if ((init?.method ?? "GET") !== "POST") {
      const fields = url.searchParams.get("fields");
      if (url.pathname.endsWith("/PAGE") && fields === "access_token") return Response.json({ access_token: "page-token" });
      if (url.pathname.endsWith("/PAGE") && fields === "id,has_whatsapp_business_number,whatsapp_number") {
        return Response.json({ id: "PAGE", has_whatsapp_business_number: true, whatsapp_number: inputs.phone });
      }
      // The 9:16 placement creative names the Page's Instagram account (#333).
      if (url.pathname.endsWith("/PAGE") && fields === "instagram_business_account,page_backed_instagram_accounts") {
        return Response.json({ instagram_business_account: { id: "INSTAGRAM" } });
      }
      if (url.searchParams.get("type") === "adgeolocationmeta") {
        url.searchParams.delete("access_token");
        expect(url.pathname.replace("/v26.0/", "") + url.search).toBe(recorded.geoMeta.path);
        return Response.json(recorded.geoMeta.body, { status: recorded.geoMeta.status });
      }
      throw new Error(`Unexpected Graph read during launch: ${url.pathname}?fields=${fields}`);
    }
    const kind = url.pathname.split("/").pop()!;
    if (kind === "adimages") return Response.json({ images: { image: { hash: uploads++ === 0 ? "FEED_HASH" : "STORY_HASH" } } });
    sent.push({ kind, form: Object.fromEntries([...(init!.body as URLSearchParams)].filter(([key]) => key !== "access_token")) });
    return Response.json({ id: IDS[kind] });
  });
  const meta = new MetaClient({ adAccountId: "act_ACCOUNT", pageId: "PAGE", accessToken: "test-token" });
  await meta.createLeadCampaign({
    name: inputs.name, dailyBudgetRupees: inputs.dailyBudgetRupees, link: inputs.link,
    ageMin: inputs.ageMin, ageMax: inputs.ageMax, gender: inputs.gender as "all", location: inputs.location, interests: inputs.interests,
    creatives: [{ imageUrl: "https://adbrain.vanshul.com/solar-example.jpg", ...inputs.creative, storyImage: new Uint8Array([0]) }],
    destination,
    ...(destination === "whatsapp"
      ? { whatsappNumber: inputs.phone, whatsappGreeting: inputs.whatsappGreeting }
      : { leadFormId: "LEAD_FORM" }),
    excludeFacebookReels,
    onPlanned,
  });
  vi.restoreAllMocks();
  return sent;
}

const json = (text: string) => JSON.parse(text) as Record<string, unknown>;
type Rule = { customization_spec: { facebook_positions: string[] } };
const rules = (creative: Record<string, string>) => (json(creative.asset_feed_spec).asset_customization_rules as Rule[]);

afterEach(() => vi.restoreAllMocks());

describe("core: the no-Facebook-Reels test Meta accepted with validate_only (#2273)", () => {
  it("the tape covers every object for both destinations, all accepted, with ads PAUSED", () => {
    for (const destination of ["instant_form", "whatsapp"] as const) {
      expect(tape.filter((e) => e.destination === destination && e.kind !== CONTROL).map((e) => e.kind)).toEqual(KINDS);
    }
    for (const exchange of tape) expect(exchange, `${exchange.destination} ${exchange.kind}`).toMatchObject({ status: 200, body: { success: true } });
    for (const ad of tape.filter((e) => e.kind === "ads")) expect(ad.form.status).toBe("PAUSED");
  });

  it.each(["instant_form", "whatsapp"] as const)("a %s launch with the option on sends exactly the payloads Meta accepted", async (destination) => {
    const sent = await launch(destination, true);
    const accepted = tape.filter((e) => e.destination === destination && e.kind !== CONTROL);
    expect(sent.map((s) => s.kind)).toEqual(accepted.map((e) => e.kind));
    sent.forEach((s, i) => {
      expect(s.form, `${destination} ${s.kind} changed: re-record with scripts/record-meta-launch-validate.ts --no-facebook-reels`).toEqual(accepted[i].form);
    });
  });

  it.each(["instant_form", "whatsapp"] as const)("%s: the ad set drops only Facebook Reels and no creative rule names it", async (destination) => {
    const [adSet, creative] = ["adsets", "adcreatives"].map((kind) => tape.find((e) => e.destination === destination && e.kind === kind)!.form);
    const targeting = json(adSet.targeting);
    expect(targeting.publisher_platforms).toEqual(["facebook", "instagram", "messenger"]);
    expect(targeting.facebook_positions).not.toContain("facebook_reels");
    expect(targeting.facebook_positions).toEqual(expect.arrayContaining(["feed", "story", "facebook_reels_overlay"]));
    // Instagram Reels and Messenger stay automatic; Audience Network stays out (#906).
    expect(Object.keys(targeting).filter((key) => key.endsWith("_positions"))).toEqual(["facebook_positions"]);
    expect(rules(creative).flatMap((rule) => rule.customization_spec.facebook_positions)).not.toContain("facebook_reels");
    // Every Facebook position the ad set runs on still matches exactly one rule.
    for (const position of targeting.facebook_positions as string[]) {
      expect(rules(creative).filter((rule) => rule.customization_spec.facebook_positions.includes(position)), position).toHaveLength(1);
    }
  });

  it("the plan check names the intentional no-Reels test instead of the pinned warning", async () => {
    let planned: Plan | undefined;
    await launch("whatsapp", true, (plan) => { planned = plan; });
    const placements = checkPlan(planned!).find((finding) => finding.rule === "Advantage+ placements")!;
    expect(placements).toMatchObject({ status: "pass" });
    expect(placements.detail).toContain("No-Reels test");
    expect(checkPlan(planned!).find((finding) => finding.rule === "9:16 Stories/Reels image")?.status).toBe("pass");
    // Any other pinning still warns.
    const other = { ...planned!, adSets: planned!.adSets.map((form) => ({ ...form, targeting: JSON.stringify({ ...json(form.targeting), facebook_positions: ["feed"] }) })) };
    expect(checkPlan(other).find((finding) => finding.rule === "Advantage+ placements")?.status).toBe("warn");
  });

  it("is off by default: targeting, creative rules, draft and reviewed plan are unchanged", async () => {
    const sent = await launch("whatsapp", undefined);
    const targeting = json(sent.find((s) => s.kind === "adsets")!.form.targeting);
    expect(targeting).not.toHaveProperty("facebook_positions");
    expect(rules(sent.find((s) => s.kind === "adcreatives")!.form)[0].customization_spec.facebook_positions).toEqual(["story", "facebook_reels"]);
    expect(withoutAudienceNetwork({})).toEqual({ publisher_platforms: ["facebook", "instagram", "messenger"] });
    const spec = placementCreativeSpec({ pageId: "PAGE", instagramUserId: "IG", feedHash: "F", storyHash: "S", headline: "h", message: "m", link: "https://x.in", destination: "whatsapp" });
    expect(spec.asset_feed_spec.asset_customization_rules[0].customization_spec.facebook_positions).toContain("facebook_reels");

    const fields = {
      businessId: "816aaafb-7ebc-4ad7-bbda-001beff172f8", name: "Solaride", goal: "Surveys", mode: "manual" as const, creativeIds: [], dailyBudgetRupees: 300,
      destination: "whatsapp" as const, leadFormId: "", whatsappNumber: "", whatsappLanguage: "ad" as const, whatsappMessage: null,
      targeting: { location: { mode: "ai" as const, includedNames: ["Mohali"] }, age: { mode: "manual" as const, min: 25, max: 65 } }, abTest: false,
    };
    const draft = buildManualDraftInput(fields);
    expect(draft).not.toHaveProperty("excludeFacebookReels");
    expect(draftInputSchema.parse(buildManualDraftInput({ ...fields, excludeFacebookReels: true })).excludeFacebookReels).toBe(true);
    const payload = (extra: Record<string, unknown>) => buildCanonicalReviewPayload({
      draft: { ...draft, ...extra } as never, draftId: "90d1d2bb-466c-4889-9af2-edb533e82531", draftVersion: 1, connection: null, creatives: [],
      form: null, whatsappNumber: "+919876543210", website: null, geo: { resolvedAreaLabel: "Mohali", unresolvedNames: [], explicitlyNationwide: false }, hash: () => "",
    } as never) as unknown as Record<string, unknown>;
    // Plans reviewed before #2273 keep their hash; turning the option on needs a fresh review.
    expect(payload({})).not.toHaveProperty("excludeFacebookReels");
    expect(payload({ excludeFacebookReels: false })).not.toHaveProperty("excludeFacebookReels");
    expect(payload({ excludeFacebookReels: true })).toMatchObject({ excludeFacebookReels: true });
  });
});
