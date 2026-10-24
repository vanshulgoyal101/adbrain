import sharp from "sharp";
import { AD_FORMATS, type AdDesignSpec } from "./design";
import { downloadImage } from "@/lib/imageGen";
import { renderCompositeAd } from "./render";
import { storedPictureDesign } from "./picture-words";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The same ad laid out at 9:16 for Stories and Reels (#333): the saved design and photo, no AI call.
 * The 4:5 photo sits full width over a blurred, darkened copy of itself (nothing cropped), on the
 * side away from the words.
 * Returns null for ads made before the design was saved, or without overlay text.
 */
export async function renderStoryAd(generation: unknown): Promise<Uint8Array | null> {
  if (!isRecord(generation) || generation.composition !== "overlay" || typeof generation.photoUrl !== "string") return null;
  const design = storedPictureDesign(generation.design);
  if (!design) return null;
  const { width, height } = AD_FORMATS.story;
  const photo = Buffer.from((await downloadImage(generation.photoUrl)).bytes);
  const backdrop = await sharp(photo).resize(width, height, { fit: "cover" }).blur(36).modulate({ brightness: 0.55 }).toBuffer();
  const fitted = await sharp(photo).resize({ width, height, fit: "inside" }).toBuffer();
  const { height: fittedHeight = height } = await sharp(fitted).metadata();
  // Keep the photo clear of the words: text on top puts the photo at the bottom, and the reverse.
  const spare = height - fittedHeight;
  const top = design.layout === "top" ? spare : design.layout === "bottom" ? 0 : Math.round(spare / 2);
  const background = await sharp(backdrop).composite([{ input: fitted, left: 0, top }]).png().toBuffer();
  const spec: AdDesignSpec = { ...design, format: "story", width, height, backgroundUrl: `data:image/png;base64,${background.toString("base64")}` };
  return renderCompositeAd(spec);
}
