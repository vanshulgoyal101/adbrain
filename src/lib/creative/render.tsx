import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { AdDesignSpec } from "./design";
import { downloadImage } from "@/lib/imageGen";
import { INDIC_SCRIPT, shapeText } from "./shaped-text";
import { AdComposite, adMetrics, isOfferLine, logoTileWidth, offerStripStyle, type ShapedWords } from "./ad-composite";

export { AdComposite, adMetrics, isOfferLine, logoTileWidth, type ShapedWords };

/**
 * Rasterise an {@link AdDesignSpec} into a finished poster-style ad using the
 * same Satori/resvg engine that powers our OG image, with Inter (OFL, in
 * ./fonts) in real 400–800 weights so headlines are bold. The AI photo is composited
 * underneath a legibility scrim, with the logo, headline, benefit checklist and
 * a contact/CTA bar laid on top the way a human designer would.
 */
export async function renderCompositeAd(spec: AdDesignSpec): Promise<Uint8Array> {
  let logoRatio = 1;
  const [backgroundUrl, logoUrl] = await Promise.all(
    [spec.backgroundUrl, spec.logoUrl].map(async (url) => {
      if (!url) return null;
      const image = await downloadImage(url);
      if (url === spec.logoUrl) logoRatio = await aspectRatio(image.bytes);
      return `data:image/png;base64,${Buffer.from(image.bytes).toString("base64")}`;
    }),
  );
  const shaped = await shapeIndicText(spec, logoRatio);
  return rasterize(<AdComposite spec={{ ...spec, backgroundUrl, logoUrl }} logoRatio={logoRatio} shaped={shaped} />, { width: spec.width, height: spec.height });
}


export async function shapeIndicText(spec: AdDesignSpec, logoRatio = 1): Promise<ShapedWords> {
  const m = adMetrics(spec);
  type Field = [key: string, text: string | null | undefined, style: Parameters<typeof shapeText>[1]];
  const fields: Field[] = [
    ["brand", spec.brandName, { size: m.brandSize, weight: 800, color: "#ffffff", maxWidth: m.contentWidth - logoTileWidth(logoRatio, m.s) - Math.round(18 * m.s) }],
    ["headline", spec.headline, { size: m.headlineSize, weight: 800, color: "#ffffff", maxWidth: m.contentWidth }],
    ["subhead", spec.subhead, isOfferLine(spec.subhead)
      ? (({ size, weight, color, maxWidth }) => ({ size, weight, color, maxWidth }))(offerStripStyle(spec))
      : { size: m.subheadSize, weight: 400, color: "#e2e8f0", maxWidth: m.contentWidth }],
    ...spec.benefits.map((benefit, i): Field => [`benefit:${i}`, benefit, { size: m.benefitSize, weight: 600, color: "#ffffff", maxWidth: m.contentWidth - Math.round(90 * m.s) }]),
    // #1177: a Hindi or Punjabi WhatsApp ask is shaped like the other on-image words.
    ["contactAsk", spec.contact === "whatsapp" ? spec.contactLabel : null, { size: m.phoneSize, weight: 800, color: "#ffffff", maxWidth: m.contentWidth - Math.round(m.phoneSize * 1.1 + 14 * m.s) }],
    ["contact", spec.contactLine, { size: m.contactSize, weight: 400, color: "#cbd5e1", maxWidth: Math.round(m.contentWidth * 0.6) }],
  ];
  const entries = await Promise.all(fields.filter(([, text]) => text && INDIC_SCRIPT.test(text)).map(async ([key, text, style]) => [key, await shapeText(text!, style)] as const));
  return Object.fromEntries(entries);
}



const FONT_DIR = path.join(process.cwd(), "src/lib/creative/fonts");
const FONT_FILES = [[400, "Regular"], [600, "SemiBold"], [700, "Bold"], [800, "ExtraBold"]] as const;
type AdFont = { name: string; data: Buffer; weight: (typeof FONT_FILES)[number][0]; style: "normal" };
let adFonts: AdFont[] | undefined;

/**
 * Every family in a spec (the brand picker's sans-serif, serif, monospace) falls back to Inter,
 * the only font loaded, so all ads get real weights. Read once per server instance.
 */
function loadAdFonts(): AdFont[] {
  adFonts ??= FONT_FILES.map(([weight, file]) => ({ name: "Inter", data: readFileSync(path.join(FONT_DIR, `Inter-${file}.ttf`)), weight, style: "normal" }));
  return adFonts;
}

export async function rasterize(element: ReactElement, size: { width: number; height: number }): Promise<Uint8Array> {
  const res = new ImageResponse(element, { ...size, fonts: loadAdFonts() });
  return new Uint8Array(await res.arrayBuffer());
}

/** Width over height of an image, or 1 (square) when it can't be read. */
async function aspectRatio(bytes: Uint8Array): Promise<number> {
  try {
    const { width, height } = await sharp(Buffer.from(bytes)).metadata();
    return width && height ? width / height : 1;
  } catch {
    return 1;
  }
}
