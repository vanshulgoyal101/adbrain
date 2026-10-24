import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/launch-validate.json";
import { MetaClient, type AdDestination } from "@/lib/meta/client";

// #419 gate: every object AdBrain's launch code creates (campaign, ad set, creative, ad, for
// lead-form and WhatsApp campaigns) must be a payload Meta accepted with validate_only.
// Recorded by scripts/record-meta-launch-validate.ts on the Solaride account; nothing was
// delivered (ads only validated; the PAUSED parents were deleted). If this fails after a
// deliberate change to what we send Meta, re-record the tape and review Meta's answers.

vi.mock("@/lib/security/ssrf", () => ({
  fetchPublicUrl: async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
}));

type Exchange = { destination: AdDestination; kind: string; form: Record<string, string>; status: number; body: unknown };
const tape = recorded.tape as Exchange[];
const inputs = recorded.inputs;
const KINDS = ["campaigns", "adsets", "adcreatives", "ads"];
const IDS: Record<string, string> = { campaigns: "CAMPAIGN", adsets: "ADSET", adcreatives: "CREATIVE", ads: "AD" };

async function launch(destination: AdDestination) {
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
    ageMin: inputs.ageMin, ageMax: inputs.ageMax, gender: inputs.gender as "all", location: inputs.location,
    creatives: [{ imageUrl: "https://adbrain.vanshul.com/solar-example.jpg", ...inputs.creative }],
    destination,
    ...(destination === "whatsapp"
      ? { whatsappNumber: inputs.phone, whatsappGreeting: inputs.whatsappGreeting }
      : { leadFormId: "LEAD_FORM" }),
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
});
