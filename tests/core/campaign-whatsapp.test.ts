import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/whatsapp-validate.json";

// #209: Meta's real answers to validate_only requests (nothing was created) for the
// WhatsApp campaign and the ad Prepare builds for Solaride's approved ad 8a5e19e9,
// recorded by scripts/record-meta-whatsapp-fixtures.ts on Oct 23.
vi.mock("@/lib/security/ssrf", () => ({
  fetchPublicUrl: async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
}));

import { MetaClient } from "@/lib/meta/client";
import { whatsappGreeting } from "@/lib/campaign/whatsapp-greeting";

const creds = { adAccountId: "act_2398686420592052", pageId: "885223068001054", accessToken: "test-token" };
const exchange = (name: string) => recorded.tape.find((entry) => entry.name === name)!;
const linkData = (name: string) => JSON.parse(exchange(name).form.creative!).object_story_spec.link_data;
const approved = {
  headline: "Wondering Whether Your Roof Is Ready?",
  primary_text: "Unsure if your roof can take solar? Diwali offer: 10% off rooftop solar installation from Solaride.\nFree site survey first, plus PM Surya Ghar subsidy help from our team.\nMessage Solaride on WhatsApp to book your free site survey.",
};
const solaride = { name: "Solaride", offers: ["Free site survey", "PM Surya Ghar subsidy help", "Diwali offer: 10% off rooftop solar installation"] };

async function sentForms(destination: "whatsapp" | "instant_form") {
  const client = new MetaClient(creds);
  vi.spyOn(client, "getWhatsAppNumber").mockResolvedValue("+919999990874");
  vi.spyOn(client, "uploadAdImage").mockResolvedValue("image-hash");
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ id: "created-id" }));
  await client.createLeadCampaign({
    name: "AdBrain #209 validate", dailyBudgetRupees: 280, destination, link: "https://solaride.in",
    ...(destination === "whatsapp"
      ? { whatsappNumber: "+919999990874", whatsappGreeting: whatsappGreeting(solaride, [approved.headline, approved.primary_text]) }
      : { leadFormId: "form-1" }),
    creatives: [{ imageUrl: "https://example.com/ad.png", headline: approved.headline, message: approved.primary_text }],
    location: { cities: [{ key: "1021145" }] }, ageMin: 25, ageMax: 55,
  });
  return fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), form: Object.fromEntries(new URLSearchParams(String(init?.body))) }));
}

afterEach(() => vi.restoreAllMocks());

describe("core: WhatsApp Prepare payload against Meta's recorded validate_only answers (#209)", () => {
  it("sends the WhatsApp campaign and the Hinglish greeting in the exact shapes Meta accepted", async () => {
    expect(exchange("campaign")).toMatchObject({ status: 200, body: { success: true } });
    expect(exchange("ad-wa-me")).toMatchObject({ status: 200, body: { success: true } });
    const forms = await sentForms("whatsapp");
    const campaign = forms.find(({ url }) => url.endsWith("/campaigns"))!.form;
    for (const field of ["objective", "status", "special_ad_categories", "is_adset_budget_sharing_enabled"] as const) {
      expect(campaign[field]).toBe(exchange("campaign").form[field]);
    }
    const sent = JSON.parse(forms.find(({ url }) => url.endsWith("/adcreatives"))!.form.object_story_spec).link_data;
    const accepted = linkData("ad-wa-me");
    expect(sent.page_welcome_message).toBe(accepted.page_welcome_message);
    expect(sent.call_to_action.type).toBe(accepted.call_to_action.type);
    expect(sent.call_to_action.value.app_destination).toBe(accepted.call_to_action.value.app_destination);
    expect(sent.message).toBe(accepted.message);
    expect(whatsappGreeting(solaride, [approved.headline, approved.primary_text])).toEqual(recorded.greeting);
  });

  it("keeps instant-form creatives free of the WhatsApp greeting", async () => {
    const forms = await sentForms("instant_form");
    const sent = JSON.parse(forms.find(({ url }) => url.endsWith("/adcreatives"))!.form.object_story_spec).link_data;
    expect(sent).not.toHaveProperty("page_welcome_message");
  });

  it("records that Meta also accepts the documented api.whatsapp.com/send link, the fallback if wa.me is ever refused", () => {
    expect(exchange("ad-api-send")).toMatchObject({ status: 200, body: { success: true } });
    expect(linkData("ad-api-send").page_welcome_message).toBe(linkData("ad-wa-me").page_welcome_message);
  });
});
