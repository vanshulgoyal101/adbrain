import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { copyClaimWarnings, editableCopySchema, type CreativeConcept } from "@/lib/creative/concept";
import { buildAdDesign } from "@/lib/creative/design";
import { pictureWordsOf, pictureWordsSchema, storedPictureDesign, withPictureWords } from "@/lib/creative/picture-words";
import { AdComposite } from "@/lib/creative/render";
import { quotedAsk } from "@/lib/campaign/whatsapp-greeting";
import regenerate from "./fixtures/create/solaride-regenerate.json";

// #1212 (#1174 lever L2, Nov 2): the CPO's exact L2 words (#1232) through AdBrain's own editors, on Solaride's
// recorded concept: the copy editor (claim-checked, #280) and the picture-words editor (headline, sub-line, phone).
// Checks: the offer leads the headline and first line, the picture says FREE SITE SURVEY, no phone number anywhere,
// and the ask is to message on WhatsApp.
const texts = (node: unknown): string[] => {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(texts);
  const el = node as ReactElement<{ children?: unknown }> | null;
  return el && typeof el === "object" && "props" in el ? texts(el.props.children) : [];
};
const brand = { ...regenerate.brand, phone: "+91 73802 80874" };
const facts = [...(brand.offers ?? []), ...(brand.usps ?? []), ...(brand.locations ?? []), brand.description ?? ""];
const concept = JSON.parse(regenerate.replies[0].content.replace(/^```json\s*|\s*```\s*$/g, "")) as CreativeConcept;
const SUB = "Rooftop solar · Chandigarh · Mohali · Panchkula";
const L2 = [
  { headline: "Free solar site survey in Tricity", first: "Free rooftop solar site survey + PM Surya Ghar subsidy help. Message us on WhatsApp to book.", picture: SUB },
  { headline: "Free site survey: see your solar savings", first: "Book a free site survey and see how much rooftop solar can cut your bill, with PM Surya Ghar subsidy help.", picture: SUB },
  { headline: "Diwali: 10% off solar + free site survey", first: "Diwali offer: 10% off rooftop solar installation, plus a free site survey and PM Surya Ghar subsidy help.", picture: "10% off this Diwali" },
];
const CLOSE = `Tap, then press Send: "I'd like a free site survey"`;

describe("core: L2 'offer up front' builds with AdBrain's editors (#1212)", () => {
  it("each ad's copy passes the owner-edit checks with the offer in the headline and first line", () => {
    for (const ad of L2) {
      const copy = editableCopySchema.parse({ headline: ad.headline, primary_text: `${ad.first}\n${CLOSE}`, description: "Free site survey in the Tricity", cta: "Learn More" });
      expect(copyClaimWarnings(copy, facts, brand.vertical), ad.headline).toEqual([]);
      expect(`${copy.headline}\n${ad.first}`).toMatch(/free (?:[a-z]+ ){0,2}site survey|10% off/i);
      expect(ad.first.length).toBeLessThanOrEqual(125);
      expect(quotedAsk(copy.primary_text)).toBe("I'd like a free site survey");
    }
  });

  it("the picture says FREE SITE SURVEY with the sub-line and no number, also on a live ad saved before #1167", () => {
    // Today's live ads were drawn with the phone number; a picture-words edit clears it.
    const legacy: Record<string, unknown> = { ...buildAdDesign({ brand, copy: { headline: concept.headline, primary_text: concept.primary_text, cta: concept.cta }, concept }), backgroundUrl: undefined };
    delete legacy.contact;
    delete legacy.contactLabel;
    const saved = storedPictureDesign(JSON.parse(JSON.stringify(legacy)))!;
    expect(texts(AdComposite({ spec: saved })).join(" ")).toContain("+91 73802 80874");
    for (const ad of L2) {
      const words = pictureWordsSchema.parse({ ...pictureWordsOf(saved), headline: "FREE SITE SURVEY", subhead: ad.picture, phone: "" });
      const shown = texts(AdComposite({ spec: withPictureWords(saved, words) })).join(" ");
      expect(shown).toContain("FREE SITE SURVEY");
      expect(shown).toContain(ad.picture);
      expect(shown).not.toMatch(/73802|\+91|\bcall\b/i);
    }
  });

  it("a fresh Create for Solaride already draws the WhatsApp ask and no number (#1167)", () => {
    const spec = buildAdDesign({ brand, copy: { headline: concept.headline, primary_text: concept.primary_text, cta: concept.cta }, concept, language: "English" });
    const shown = texts(AdComposite({ spec })).join(" ");
    expect(shown).toContain("Message us on WhatsApp");
    expect(shown).not.toMatch(/73802|\+91/);
  });
});
