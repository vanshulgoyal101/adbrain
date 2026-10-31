import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { CreativeConcept } from "@/lib/creative/concept";
import { buildAdDesign } from "@/lib/creative/design";
import { AdComposite, rasterize, renderCompositeAd, shapeIndicText } from "@/lib/creative/render";
import { shapeText } from "@/lib/creative/shaped-text";
import recorded from "./fixtures/create/solaride-hindi.json";

const headlineStyle = { size: 76, weight: 800, color: "#ffffff", maxWidth: 952 };
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Mean per-channel difference, or Infinity when the sizes differ. */
async function meanDiff(actual: Buffer, goldenPath: string) {
  if (!existsSync(goldenPath)) return Infinity;
  const a = await sharp(actual).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(readFileSync(goldenPath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) return Infinity;
  let total = 0;
  for (let i = 0; i < a.data.length; i++) total += Math.abs(a.data[i] - b.data[i]);
  return total / a.data.length;
}

function design(headline: string, supportingText: string) {
  const concept = {
    headline, supportingText, primary_text: "Free site survey first.", description: "", cta: "Contact Us", rationale: "", sourceQuotes: [],
    visual: { medium: "Photography", direction: "Rooftop solar at dusk.", textPlacement: "top" },
  } as CreativeConcept;
  return buildAdDesign({ brand: { name: recorded.brand.name, website: "solaride.in", phone: "+91 73802 80874", primary_color: "#1d3a2e" }, copy: concept, concept, format: "portrait" });
}

// #300: Satori drew "बिजली बिल" as "बजिली बलि" and Gurmukhi as empty boxes; Pango/HarfBuzz shape them.
describe("Indian scripts on the ad image", () => {
  // Goldens come from Linux (CI and Vercel); macOS Pango uses CoreText, so its pixels differ.
  // To refresh one: decode the base64 in the failure message, check it by eye, save it as the golden.
  it.skipIf(process.platform !== "linux").each([["bijli-bil", "बिजली बिल"], ["bill-gurmukhi", "ਬਿੱਲ"]])("shapes %s like the eyeballed golden image", async (name, text) => {
    const shaped = await shapeText(text, headlineStyle);
    const png = Buffer.from(shaped.src.split(",")[1], "base64");
    const diff = await meanDiff(png, `tests/core/fixtures/render/${name}.png`);
    expect(diff, `${name} differs from its golden; actual PNG (base64): ${png.toString("base64")}`).toBeLessThan(2);
  });

  it("shapes only the fields written in Devanagari or Gurmukhi", async () => {
    const shaped = await shapeIndicText(design("बिजली बिल आधा", "ਮੁਫ਼ਤ ਸਾਈਟ ਸਰਵੇ"));
    // #1177: a Hindi ad's WhatsApp ask ("WhatsApp पर मैसेज करें") is shaped too.
    expect(Object.keys(shaped).sort()).toEqual(["contactAsk", "headline", "subhead"]);
    expect(await shapeIndicText(design("Wondering Whether Your Roof Is Ready?", "Free site survey"))).toEqual({});
  });

  it("draws a recorded Hindi goal on a real ad through the shaper", async () => {
    const hindi = recorded.goals.hi.factory.split(":")[0];
    expect(hindi).toMatch(/[\u0900-\u097F]/);
    const spec = design(hindi, "PM सूर्य घर सब्सिडी मदद");
    const ours = await renderCompositeAd(spec);
    const unshaped = await rasterize(<AdComposite spec={spec} />, { width: spec.width, height: spec.height });
    expect(ours.byteLength).toBeGreaterThan(10_000);
    expect(sha(ours)).not.toBe(sha(unshaped));
  });

  // #1503: a headline that wraps keeps Latin-or-taller line pitch, so one line's matras never reach the next.
  it("a wrapped Hindi headline keeps at least 1.15× line pitch", async () => {
    const shaped = await shapeText("मुफ़्त सोलर सर्वे, बिजली बिल आधा करें", { ...headlineStyle, maxWidth: 600 });
    const lines = Math.round(shaped.height / (headlineStyle.size * 1.25));
    expect(lines).toBeGreaterThanOrEqual(2);
    expect(shaped.height / lines).toBeGreaterThanOrEqual(headlineStyle.size * 1.15);
  });
});
