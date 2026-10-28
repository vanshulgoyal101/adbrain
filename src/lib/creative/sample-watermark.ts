import sharp from "sharp";

/** #1317: what a prospect's exported ads say on the picture, until the business owner takes the account over. */
export const SAMPLE_LABEL = "Sample: not live";

/** The image with a "Sample: not live" band across its foot, in its own format. */
export async function sampleWatermark(bytes: Uint8Array): Promise<{ bytes: Uint8Array; contentType: string }> {
  const image = sharp(bytes);
  const { width, height, format } = await image.metadata();
  if (!width || !height || !format || !["png", "jpeg", "webp"].includes(format)) throw new Error("Unsupported image");
  const band = Math.max(36, Math.round(height * 0.08));
  const size = Math.round(band * 0.5);
  const svg = `<svg width="${width}" height="${band}" xmlns="http://www.w3.org/2000/svg">
<rect width="100%" height="100%" fill="#0f172a" fill-opacity="0.78"/>
<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${size}" fill="#ffffff">${SAMPLE_LABEL}</text>
</svg>`;
  const marked = image.composite([{ input: Buffer.from(svg), top: height - band, left: 0 }]);
  const output = format === "png" ? marked.png() : format === "webp" ? marked.webp({ quality: 90 }) : marked.jpeg({ quality: 90 });
  return { bytes: new Uint8Array(await output.toBuffer()), contentType: `image/${format}` };
}
