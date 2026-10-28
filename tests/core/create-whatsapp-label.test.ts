import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAdDesign, WHATSAPP_CONTACT_LABEL } from "@/lib/creative/design";
import { storedPictureDesign } from "@/lib/creative/picture-words";
import { shapeIndicText } from "@/lib/creative/render";
import { runPreflight, type PreflightCreative } from "@/lib/campaign/preflight";
import { WHATSAPP_PICTURE_ON_FORM } from "@/lib/campaign/plan-check";
import { languagePromptName } from "@/lib/languages";
import type { BrandContext } from "@/lib/templates/ads";

// #1177 (Reviewer audit of #1167): the WhatsApp ask on the picture follows the ad's language, and Review warns
// when that picture goes to a form campaign. Recorded inputs: Solaride's Hindi concept (solaride-hindi.json).
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures/create/solaride-hindi.json"), "utf8")) as { brand: BrandContext; replies: { content: string }[] };
const reply = fixture.replies.find((item) => /"headline"/.test(item.content) && /[\u0900-\u097F]/.test(item.content))!;
const concept = JSON.parse(reply.content.replace(/^```json\s*|\s*```\s*$/g, ""));
const brand = { ...fixture.brand, phone: "+91 73802 80874" };
const design = (language: string) => buildAdDesign({ brand, copy: { headline: concept.headline, primary_text: concept.primary_text, cta: concept.cta }, concept, language });

describe("core: the WhatsApp ask on the picture speaks the ad's language (#1177)", () => {
  it("labels the recorded Hindi concept in Hindi, and shapes it like the other Indic words", async () => {
    const hindi = design(languagePromptName("hi"));
    expect(hindi).toMatchObject({ contact: "whatsapp", contactLabel: "WhatsApp पर मैसेज करें" });
    const shaped = await shapeIndicText(hindi);
    expect(shaped.contactAsk?.src).toMatch(/^data:image\/png;base64,/);
  });

  it("uses each language's words, and English when the ad is English", () => {
    expect(design(languagePromptName("hinglish")).contactLabel).toBe("WhatsApp par message karein");
    expect(design(languagePromptName("pa")).contactLabel).toBe("WhatsApp ਤੇ ਮੈਸੇਜ ਕਰੋ");
    expect(buildAdDesign({ brand, copy: { headline: "Solar before 31 Dec", primary_text: "Free site survey in Mohali.", cta: "Learn More" }, language: "English" }).contactLabel).toBe(WHATSAPP_CONTACT_LABEL);
    // Designs saved before #1177 have no label and keep the English line.
    const legacy: Record<string, unknown> = { ...design(languagePromptName("hi")), backgroundUrl: undefined };
    delete legacy.contactLabel;
    expect(storedPictureDesign(JSON.parse(JSON.stringify(legacy)))?.contactLabel ?? null).toBeNull();
  });
});

describe("core: Review warns when a WhatsApp picture goes to a form campaign (#1177)", () => {
  const businessId = "b1d2c3e4-0000-4000-8000-000000000177";
  const creative = (asksWhatsApp: boolean): PreflightCreative => ({ id: "c1d2c3e4-0000-4000-8000-000000000177", businessId, approved: true, imageUrl: "https://example.com/ad.png", headline: concept.headline, primaryText: concept.primary_text, asksWhatsApp });
  const review = (destination: "instant_form" | "whatsapp", asksWhatsApp: boolean) => runPreflight({
    draft: { businessId, name: "Solaride — leads", goal: "Free site surveys", mode: "manual", destination, creativeIds: [creative(asksWhatsApp).id],
      dailyBudgetRupees: 300, leadFormId: destination === "instant_form" ? "900000000000177" : null, abTest: false,
      targeting: { location: { mode: "manual", cityScope: "city_only", includedNames: ["Mohali"] }, age: { mode: "manual", min: 25, max: 55 }, audience: { interestNames: [], rationale: "Homeowners." } } },
    draftId: "5d0a4c2e-1b7f-4c3d-9e8f-0a1b2c3d4177", draftVersion: 1,
    connection: { generation: 1, canCreatePaused: true, selected: { metaBusinessId: null, adAccountId: "act_9000000000000001", accountName: "Solaride 101", pageId: "900000000000002", pageName: "Solaride Energy", currency: "INR", timezoneName: "Asia/Kolkata" } },
    creatives: [creative(asksWhatsApp)], form: { id: "900000000000177", businessId, active: true }, whatsappNumber: "+917380280874",
    geo: { resolvedAreaLabel: "Mohali", unresolvedNames: [], explicitlyNationwide: false }, hash: () => "a".repeat(64), costPerResultRupees: null,
  });

  it("warns on a form campaign, never blocks, and is quiet on WhatsApp or a phone picture", () => {
    const form = review("instant_form", true);
    expect(form.planWarnings).toContain(WHATSAPP_PICTURE_ON_FORM);
    expect(review("instant_form", false).planWarnings ?? []).not.toContain(WHATSAPP_PICTURE_ON_FORM);
    expect(review("whatsapp", true).planWarnings ?? []).not.toContain(WHATSAPP_PICTURE_ON_FORM);
    expect(form.blockers.map((blocker) => blocker.code)).toEqual(review("instant_form", false).blockers.map((blocker) => blocker.code));
    expect(form.planHash).toBe(review("instant_form", false).planHash);
  });
});
