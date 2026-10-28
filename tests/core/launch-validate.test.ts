import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/launch-validate.json";
import { MetaClient, type AdDestination } from "@/lib/meta/client";
import { checkPlan, type PlannedCampaign } from "@/lib/campaign/plan-check";

// #419 gate: every object AdBrain's launch code creates (campaign, ad set, creative, ad, for
// lead-form and WhatsApp campaigns) must be a payload Meta accepted with validate_only.
// Recorded by scripts/record-meta-launch-validate.ts on the Solaride account; nothing was
// delivered (ads only validated; the PAUSED parents were deleted). If this fails after a
// deliberate change to what we send Meta, re-record the tape and review Meta's answers.

vi.mock("@/lib/security/ssrf", () => ({
  fetchPublicUrl: async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
}));

type Exchange = { destination: AdDestination; kind: string; form: Record<string, string>; status: number; body: unknown };
const tape = recorded.tape as unknown as Exchange[];
const inputs = recorded.inputs;
const KINDS = ["campaigns", "adsets", "adcreatives", "ads"];
const IDS: Record<string, string> = { campaigns: "CAMPAIGN", adsets: "ADSET", adcreatives: "CREATIVE", ads: "AD" };

async function launch(destination: AdDestination, onPlanned?: (plan: Omit<PlannedCampaign, "costPerResultRupees">) => void) {
  const sent: { kind: string; form: Record<string, string> }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if ((init?.method ?? "GET") !== "POST") {
      // A WhatsApp launch first confirms the number still belongs to the Page (reads, not creations).
      const fields = url.searchParams.get("fields");
      if (url.pathname.endsWith("/PAGE") && fields === "access_token") return Response.json({ access_token: "page-token" });
      if (url.pathname.endsWith("/PAGE") && fields === "id,has_whatsapp_business_number,whatsapp_number") {
        return Response.json({ id: "PAGE", has_whatsapp_business_number: true, whatsapp_number: inputs.phone });
      }
      // #741: the service-area read, answered with Meta's recorded reply.
      if (url.searchParams.get("type") === "adgeolocationmeta") {
        url.searchParams.delete("access_token");
        expect(url.pathname.replace("/v26.0/", "") + url.search).toBe(recorded.geoMeta.path);
        return Response.json(recorded.geoMeta.body, { status: recorded.geoMeta.status });
      }
      throw new Error(`Unexpected Graph read during launch: ${url.pathname}?fields=${fields}`);
    }
    const kind = url.pathname.split("/").pop()!;
    if (kind === "adimages") return Response.json({ images: { image: { hash: "FEED_HASH" } } });
    sent.push({ kind, form: Object.fromEntries([...(init!.body as URLSearchParams)].filter(([key]) => key !== "access_token")) });
    return Response.json({ id: IDS[kind] });
  });
  const meta = new MetaClient({ adAccountId: "act_ACCOUNT", pageId: "PAGE", accessToken: "test-token" });
  await meta.createLeadCampaign({
    name: inputs.name, dailyBudgetRupees: inputs.dailyBudgetRupees, link: inputs.link,
    ageMin: inputs.ageMin, ageMax: inputs.ageMax, gender: inputs.gender as "all", location: inputs.location, interests: inputs.interests,
    creatives: [{ imageUrl: "https://adbrain.vanshul.com/solar-example.jpg", ...inputs.creative }],
    destination,
    ...(destination === "whatsapp"
      ? { whatsappNumber: inputs.phone, whatsappGreeting: inputs.whatsappGreeting }
      : { leadFormId: "LEAD_FORM" }),
    onPlanned,
  });
  vi.restoreAllMocks();
  return sent;
}

afterEach(() => vi.restoreAllMocks());

describe("core: launch payloads Meta accepted with validate_only (#419)", () => {
  it("the tape covers every object for both destinations, all accepted, with ads PAUSED", () => {
    for (const destination of ["instant_form", "whatsapp"] as const) {
      expect(tape.filter((e) => e.destination === destination).map((e) => e.kind)).toEqual(KINDS);
    }
    for (const exchange of tape) expect(exchange, `${exchange.destination} ${exchange.kind}`).toMatchObject({ status: 200, body: { success: true } });
    for (const ad of tape.filter((e) => e.kind === "ads")) expect(ad.form.status).toBe("PAUSED");
  });

  it.each(["instant_form", "whatsapp"] as const)("today's %s launch sends exactly the payloads Meta accepted", async (destination) => {
    const sent = await launch(destination);
    const accepted = tape.filter((e) => e.destination === destination);
    expect(sent.map((s) => s.kind)).toEqual(accepted.map((e) => e.kind));
    sent.forEach((s, i) => {
      expect(s.form, `${destination} ${s.kind} changed: re-record with scripts/record-meta-launch-validate.ts`).toEqual(accepted[i].form);
    });
  });

  // #419 item 2(a): every launch checks the payloads it sent against new-advertiser guidance.
  it.each(["instant_form", "whatsapp"] as const)("hands the %s plan check exactly the ad set and creative payloads Meta accepted", async (destination) => {
    let planned: Omit<PlannedCampaign, "costPerResultRupees"> | undefined;
    await launch(destination, (plan) => { planned = plan; });
    const accepted = tape.filter((e) => e.destination === destination);
    expect(planned).toEqual({
      adSets: accepted.filter((e) => e.kind === "adsets").map((e) => e.form),
      creatives: accepted.filter((e) => e.kind === "adcreatives").map((e) => e.form),
    });
    expect(checkPlan(planned!).map((finding) => [finding.rule, finding.status])).toEqual([
      ["Advantage+ audience", "pass"], ["Advantage+ placements", "pass"], ["One ad set", "pass"],
      ["Budget vs learning phase", "unknown"], ["4:5 feed image", "pass"], ["9:16 Stories/Reels image", "warn"],
    ]);
  });

  // #906: WhatsApp ads run on Facebook, Instagram and Messenger only (Audience Network taps were mostly accidental on #157).
  // #680: lead-form ads too, so a WhatsApp vs lead-form A/B differs only in destination.
  it("WhatsApp and lead-form ad sets leave Audience Network out, as Meta accepted them", async () => {
    const adSet = (destination: AdDestination) => JSON.parse(tape.find((e) => e.destination === destination && e.kind === "adsets")!.form.targeting);
    for (const destination of ["whatsapp", "instant_form"] as const) {
      expect(adSet(destination).publisher_platforms).toEqual(["facebook", "instagram", "messenger"]);
      expect(JSON.stringify(adSet(destination))).not.toContain("audience_network");
    }
    let planned: Omit<PlannedCampaign, "costPerResultRupees"> | undefined;
    await launch("whatsapp", (plan) => { planned = plan; });
    expect(checkPlan(planned!).find((finding) => finding.rule === "Advantage+ placements")?.detail).toContain("Audience Network is left out");
  });
});
