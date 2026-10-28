import { afterEach, describe, expect, it, vi } from "vitest";
import openings from "./fixtures/meta/whatsapp-openings.json";

// #1211 (#1174 lever L1, Oct 31): can AdBrain build 'Tap, then press Send: "I'd like a free site survey"' with no
// hand edits outside the product? The owner edits each ad's closing line in the copy editor (claim-checked, #280),
// keeps his saved WhatsApp message (welcome + pre-typed "I'd like a free site survey" + Call now), and launch sends
// the ad text and that message in the shape Meta accepted on the recorded validate_only tape (#840). Nothing is sent.
vi.mock("@/lib/security/ssrf", () => ({ fetchPublicUrl: async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])) }));

import { MetaClient } from "@/lib/meta/client";
import { campaignWhatsAppMessage } from "@/lib/campaign/campaign-whatsapp-message";
import { quotedAsk, sameWords } from "@/lib/campaign/whatsapp-greeting";
import { copyClaimWarnings, editableCopySchema } from "@/lib/creative/concept";
import type { DraftInput } from "@/lib/campaign/connect-contracts";

const L1 = `Tap, then press Send: "I'd like a free site survey"`;
const solaride = {
  name: "Solaride", vertical: "solar energy", locations: ["Chandigarh", "Panchkula", "Mohali"],
  offers: ["Free site survey", "PM Surya Ghar subsidy help", "Diwali offer: 10% off rooftop solar installation"],
  usps: ["Backed by qualified engineering graduates from IIT Bombay and PEC Chandigarh", "Assistance with PM Surya Ghar subsidy and net metering"],
  // The owner's saved message: his recorded welcome and Call now; the pre-typed words are the live arm's.
  whatsapp_template: { greeting: openings.openings.call.greeting, language: "en", opening: { kind: "prefill", prefill: "I'd like a free site survey", callButton: true } },
};
// The three ads with only the closing ask changed (CPO's exact L1 words, #1232).
const ads = [
  { headline: "Free solar site survey in Mohali", primary_text: `Free solar site survey for homes in Mohali.\nPM Surya Ghar subsidy help from our team.\n${L1}` },
  { headline: "Solar before 31 Dec in Panchkula", primary_text: `Rooftop solar in Panchkula: decide before costs rise.\nBacked by IIT Bombay and PEC Chandigarh engineers.\n${L1}` },
  { headline: "Diwali: 10% off rooftop solar", primary_text: `10% off rooftop solar installation this Diwali in Chandigarh.\nA free site survey comes first.\n${L1}` },
];
const facts = [...solaride.offers, ...solaride.usps, ...solaride.locations];

afterEach(() => vi.restoreAllMocks());

describe("core: L1 'Tap, then press Send' builds in AdBrain as it is (#1211)", () => {
  it("the owner's copy edit passes the copy checks, and each ad's quoted ask is exactly the pre-typed message", () => {
    for (const ad of ads) {
      const copy = editableCopySchema.parse({ ...ad, description: "Free site survey in the Tricity", cta: "Learn More" });
      expect(copyClaimWarnings(copy, facts, solaride.vertical), ad.headline).toEqual([]);
      expect(quotedAsk(ad.primary_text)).toBe("I'd like a free site survey");
    }
  });

  it("a phone's curly quotes and apostrophe (“I’d …”) still match the pre-typed message", () => {
    const typed = quotedAsk(`A free site survey comes first.\nTap, then press Send: “I’d like a free site survey”`);
    expect(typed).toBe("I’d like a free site survey");
    expect(sameWords(typed!, "I'd like a free site survey")).toBe(true);
    expect(sameWords("I'd like a free site survey", "I’d like a free site survey.")).toBe(true);
    expect(sameWords("I’d like a free site survey", "I'd like a site survey")).toBe(false);
  });

  it("launch keeps the owner's saved message, so Review has no rule 7 mismatch", () => {
    const draft = { destination: "whatsapp", creativeIds: [], whatsappLanguage: "ad" } as unknown as DraftInput;
    const message = campaignWhatsAppMessage({ draft, business: solaride, creatives: ads });
    expect(message).toMatchObject({ source: "saved", opening: { greeting: openings.openings.call.greeting, autofill: "I'd like a free site survey", callButton: true } });
    for (const ad of ads) expect(sameWords(quotedAsk(ad.primary_text)!, message.opening.autofill)).toBe(true);
  });

  it("sends the ad text and the Meta-accepted 'pre-typed message + Call now' welcome", async () => {
    const accepted = JSON.parse(openings.tape.find((entry) => entry.opening === "call" && entry.shape === "single")!.welcome);
    expect(openings.tape.find((entry) => entry.opening === "call" && entry.shape === "single")!.status).toBe(200);
    const client = new MetaClient({ adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" });
    vi.spyOn(client, "getWhatsAppNumber").mockResolvedValue("+919999990874");
    vi.spyOn(client, "uploadAdImage").mockResolvedValue("image-hash");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ id: "created-id" }));
    const opening = campaignWhatsAppMessage({ draft: { destination: "whatsapp" } as unknown as DraftInput, business: solaride, creatives: ads }).opening;
    await client.createLeadCampaign({
      name: "L1 readiness", dailyBudgetRupees: 225, destination: "whatsapp", link: "https://solaride.in", whatsappNumber: "+919999990874", whatsappGreeting: opening,
      creatives: ads.map((ad) => ({ imageUrl: "https://example.com/ad.png", headline: ad.headline, message: ad.primary_text })),
      location: { cities: [{ key: "1021145" }] }, ageMin: 25, ageMax: 55,
    });
    const creatives = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/adcreatives"))
      .map(([, init]) => JSON.parse(new URLSearchParams(String(init?.body)).get("object_story_spec")!).link_data);
    expect(creatives.map((data) => data.message)).toEqual(ads.map((ad) => ad.primary_text));
    for (const data of creatives) {
      const sent = JSON.parse(data.page_welcome_message);
      // Meta's accepted shape, with only the pre-typed words changed.
      expect(sent).toEqual({ ...accepted, text_format: { ...accepted.text_format, message: { ...accepted.text_format.message, autofill_message: { content: "I'd like a free site survey" } } } });
    }
  });
});
