import sharp from "sharp";
import { shapeText } from "@/lib/creative/shaped-text";
import { SAMPLE_LABEL } from "@/lib/creative/sample-label";

export { SAMPLE_LABEL };

/**
 * The image with a "Sample: not live" band across its foot, in its own format. The words are drawn by Pango with
 * the bundled Inter (#1375: SVG text needs system fonts, and Vercel's runtime has none, so it drew empty boxes).
 */
export async function sampleWatermark(bytes: Uint8Array): Promise<{ bytes: Uint8Array; contentType: string }> {
  const image = sharp(bytes);
  const { width, height, format } = await image.metadata();
  if (!width || !height || !format || !["png", "jpeg", "webp"].includes(format)) throw new Error("Unsupported image");
  const band = Math.max(36, Math.round(height * 0.08));
  const rect = `<svg width="${width}" height="${band}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#0f172a" fill-opacity="0.78"/></svg>`;
  const label = await shapeText(SAMPLE_LABEL, { size: Math.round(band * 0.5), weight: 700, color: "#ffffff", maxWidth: width });
  const labelPng = Buffer.from(label.src.slice(label.src.indexOf(",") + 1), "base64");
  const marked = image.composite([
    { input: Buffer.from(rect), top: height - band, left: 0 },
    {
      input: labelPng,
      top: height - band + Math.max(0, Math.round((band - label.height) / 2)),
      left: Math.max(0, Math.round((width - label.width) / 2)),
    },
  ]);
  const output = format === "png" ? marked.png() : format === "webp" ? marked.webp({ quality: 90 }) : marked.jpeg({ quality: 90 });
  return { bytes: new Uint8Array(await output.toBuffer()), contentType: `image/${format}` };
}
