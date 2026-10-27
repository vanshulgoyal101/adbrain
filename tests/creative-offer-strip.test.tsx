import { mkdir, writeFile } from "node:fs/promises";
import type { ReactElement } from "react";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildAdDesign, type AdFormat } from "@/lib/creative/design";
import { AdComposite, isOfferLine, renderCompositeAd, shapeIndicText } from "@/lib/creative/render";

// #967 (#941 rule 2): long-running Indian local ads put the offer on the picture as a bold strip.
const brand = { name: "Solaride", phone: "+91 98290 12345", primary_color: "#f59e0b" };
const copy = { headline: "Solar panels in Jaipur", primary_text: "Free site visit for Jaipur homes.", cta: "Get Quote" };

type Element = ReactElement<{ children?: unknown; style?: Record<string, unknown>; "data-offer-strip"?: string }>;
function find(node: unknown, match: (el: Element) => boolean): Element | null {
  if (Array.isArray(node)) {
    for (const child of node) { const hit = find(child, match); if (hit) return hit; }
    return null;
  }
  const el = node as Element | null;
  if (!el || typeof el !== "object" || !("props" in el)) return null;
  return match(el) ? el : find(el.props.children, match);
}
const strip = (subhead: string | null, format: AdFormat = "portrait") => {
  const spec = { ...buildAdDesign({ brand, copy, format }), subhead };
  return { spec, el: find(AdComposite({ spec }), el => el.props["data-offer-strip"] !== undefined) };
};

describe("the offer on the picture (#967)", () => {
  it.each([
    "Free site visit", "₹10,000 per kW after subsidy", "Rs. 499 only", "20% off this month", "Flat 15 per cent", "Flat 500 off",
    "मुफ़्त साइट विज़िट", "ਮੁਫ਼ਤ ਸਾਈਟ ਵਿਜ਼ਿਟ",
  ])("knows %s is an offer", text => expect(isOfferLine(text)).toBe(true));

  it.each(["Hassle-free installation", "Rooftop solar for Jaipur homes", "25 years of panel life", "", null])(
    "doesn't mistake %s for one", text => expect(isOfferLine(text)).toBe(false));

  it("draws an offer as a bold strip in the brand colour with readable text", () => {
    const { spec, el } = strip("Free site visit");
    expect(el?.props.style).toMatchObject({ background: spec.primaryColor, color: spec.ctaTextColor, fontWeight: 700, alignSelf: "flex-start" });
    expect(Number(el?.props.style?.fontSize)).toBeGreaterThan(34);
  });

  it("keeps an ordinary line as the quiet subhead", () => {
    expect(strip("Rooftop solar for Jaipur homes").el).toBeNull();
    expect(strip(null).el).toBeNull();
  });

  it("shapes a Hindi offer in the strip's bold weight, larger than a subhead", async () => {
    const offer = await shapeIndicText({ ...buildAdDesign({ brand, copy }), subhead: "मुफ़्त साइट विज़िट" });
    const plain = await shapeIndicText({ ...buildAdDesign({ brand, copy }), subhead: "जयपुर के घरों के लिए सोलर" });
    expect(offer.subhead!.height).toBeGreaterThan(plain.subhead!.height);
  });

  it.each([
    ["square", "Free site visit"],
    ["story", "Free site visit"],
    ["portrait", "मुफ़्त साइट विज़िट, ₹10,000 प्रति kW सब्सिडी के बाद"],
  ] as const)("renders the strip on a real %s picture: %s", async (format, subhead) => {
    const background = await sharp("public/solar-example.jpg").resize(900).png().toBuffer();
    const spec = { ...buildAdDesign({ brand, copy, format }), subhead, backgroundUrl: `data:image/png;base64,${background.toString("base64")}` };
    const png = Buffer.from(await renderCompositeAd(spec));
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([spec.width, spec.height]);
    if (process.env.CREATIVE_OUT) {
      await mkdir(process.env.CREATIVE_OUT, { recursive: true });
      await writeFile(`${process.env.CREATIVE_OUT}/offer-strip-${format}.png`, png);
    }
  });
});
