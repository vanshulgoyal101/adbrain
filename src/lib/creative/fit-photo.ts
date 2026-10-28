import sharp from "sharp";

/** How an owner photo meets the ad's frame: a saliency crop (faces kept) or the whole photo on a blurred copy. */
export type PhotoFit = "attention" | "blur";

/**
 * #1904 (#744 phase 1): fit a photo to exactly width×height for the ad. Phone photos come in any ratio, and a centre
 * crop cuts heads off, so the crop follows sharp's `attention` strategy (luminance, saturation and skin tones; no
 * paid API). `blur` keeps the whole photo, centred over a darkened, blurred copy of itself, for group shots and
 * anything a crop would lose. EXIF orientation is applied first. Returns PNG bytes.
 */
export async function fitPhoto(bytes: Uint8Array, width: number, height: number, fit: PhotoFit = "attention"): Promise<Buffer> {
  const upright = await sharp(Buffer.from(bytes)).rotate().toBuffer();
  if (fit === "attention") {
    return sharp(upright).resize(width, height, { fit: "cover", position: sharp.strategy.attention }).png().toBuffer();
  }
  const backdrop = await sharp(upright).resize(width, height, { fit: "cover" }).blur(36).modulate({ brightness: 0.55 }).toBuffer();
  const whole = await sharp(upright).resize({ width, height, fit: "inside" }).toBuffer();
  const { width: w = width, height: h = height } = await sharp(whole).metadata();
  return sharp(backdrop)
    .composite([{ input: whole, left: Math.round((width - w) / 2), top: Math.round((height - h) / 2) }])
    .png()
    .toBuffer();
}
