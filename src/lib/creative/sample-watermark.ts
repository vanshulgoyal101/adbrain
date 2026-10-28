import sharp from "sharp";
import { shapeText, type ShapedText } from "@/lib/creative/shaped-text";
import { SAMPLE_LABEL, SAMPLE_NOTE } from "@/lib/creative/sample-label";

export { SAMPLE_LABEL, SAMPLE_NOTE };

const INK = "#1b2420";
const AMBER = "#e0a100";
const pngOf = (shaped: ShapedText) => Buffer.from(shaped.src.slice(shaped.src.indexOf(",") + 1), "base64");

/** A white pill (94%) with an amber dot before the shaped words, sized from `s` (Designer's #1471 spec). */
async function pill(label: ShapedText, s: number) {
  const padX = Math.round(0.9 * s), padY = Math.round(0.42 * s), dot = Math.round(0.58 * s), gap = Math.round(0.5 * s);
  const width = padX + dot + gap + label.width + padX, height = label.height + 2 * padY;
  const shape = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
    + `<rect width="${width}" height="${height}" rx="${height / 2}" fill="#ffffff" fill-opacity="0.94"/>`
    + `<circle cx="${padX + dot / 2}" cy="${height / 2}" r="${dot / 2}" fill="${AMBER}"/></svg>`;
  const input = await sharp(Buffer.from(shape))
    .composite([{ input: pngOf(label), top: padY, left: padX + dot + gap }]).png().toBuffer();
  return { input, width, height };
}

/**
 * #1471: the image with a light "Sample ad: not live yet" pill in its bottom-left corner, in its own format. Every size
 * comes from the image's width, so 1:1, 4:5 and 9:16 look alike; AdBrain's words sit in the top half, so the foot
 * never covers the offer. The words are drawn by Pango with the bundled Inter (#1375: SVG text needs system fonts,
 * and Vercel's runtime has none, so it drew empty boxes).
 */
export async function sampleWatermark(bytes: Uint8Array): Promise<{ bytes: Uint8Array; contentType: string }> {
  const image = sharp(bytes);
  const { width, height, format } = await image.metadata();
  if (!width || !height || !format || !["png", "jpeg", "webp"].includes(format)) throw new Error("Unsupported image");
  const s = Math.max(12, Math.round(0.04 * width));
  const inset = Math.round(0.04 * width);
  const label = await shapeText(SAMPLE_LABEL, { size: s, weight: 700, color: INK, maxWidth: Math.max(1, width - 2 * inset - 3 * s) });
  const mark = await pill(label, s);
  const marked = image.composite([{ input: mark.input, left: inset, top: Math.max(0, height - inset - mark.height) }]);
  const output = format === "png" ? marked.png() : format === "webp" ? marked.webp({ quality: 90 }) : marked.jpeg({ quality: 90 });
  return { bytes: new Uint8Array(await output.toBuffer()), contentType: `image/${format}` };
}

/** #1471: `00-sample-note.png`, first in a sample pack: what these ads are, before anyone opens them. */
export async function sampleNoteCard(businessName?: string | null): Promise<Uint8Array> {
  const size = 1080, margin = 96, wide = size - 2 * margin;
  const tag = await pill(await shapeText("Sample", { size: 30, weight: 700, color: INK, maxWidth: wide }), 30);
  const title = await shapeText(businessName?.trim() ? `Sample ads for ${businessName.trim()}` : "Sample ads", { size: 64, weight: 700, color: INK, maxWidth: wide });
  const body = await shapeText(SAMPLE_NOTE, { size: 38, weight: 400, color: INK, maxWidth: wide });
  const footer = await shapeText("adbrain.vanshul.com", { size: 30, weight: 400, color: "#56605b", maxWidth: wide });
  const titleTop = margin + tag.height + 56;
  const card = sharp({ create: { width: size, height: size, channels: 3, background: "#f6f7f4" } }).composite([
    { input: tag.input, left: margin, top: margin },
    { input: pngOf(title), left: margin, top: titleTop },
    { input: pngOf(body), left: margin, top: titleTop + title.height + 40 },
    { input: pngOf(footer), left: margin, top: size - margin - footer.height },
  ]);
  return new Uint8Array(await card.png().toBuffer());
}
