import sharp from "sharp";
import { AD_FORMATS, STORY_SAFE, type AdDesignSpec } from "./design";
import { downloadImage } from "@/lib/imageGen";
import { renderCompositeAd } from "./render";
import { hasStoryDesign, storedPictureDesign } from "./picture-words";

export { hasStoryDesign, STORY_SAFE };

/**
 * Where the 4:5 photo sits in the 9:16 canvas (#1077). Words on top: the photo starts at the top safe line, so the
 * words cover the same part of it as in the feed picture the generator composed for (the subject below them), and
 * far less of it is under the reply bar than when it sat on the bottom edge. Words at the bottom: the photo starts
 * at the top. Centred words: centred.
 */
export function storyPhotoTop(layout: AdDesignSpec["layout"], fittedHeight: number, height: number): number {
  const spare = Math.max(0, height - fittedHeight);
  if (layout === "top") return Math.min(spare, Math.round(height * STORY_SAFE.top));
  return layout === "bottom" ? 0 : Math.round(spare / 2);
}

/**
 * The same ad laid out at 9:16 for Stories and Reels (#333): the saved design and photo, no AI call.
 * The 4:5 photo sits full width over a blurred, darkened copy of itself (nothing cropped), on the
 * side away from the words.
 * Returns null for ads made before the design was saved, or without overlay text.
 */
export async function renderStoryAd(generation: unknown): Promise<Uint8Array | null> {
  if (!hasStoryDesign(generation)) return null;
  const design = storedPictureDesign(generation.design)!;
  const { width, height } = AD_FORMATS.story;
  const photo = Buffer.from((await downloadImage(generation.photoUrl)).bytes);
  const backdrop = await sharp(photo).resize(width, height, { fit: "cover" }).blur(36).modulate({ brightness: 0.55 }).toBuffer();
  const fitted = await sharp(photo).resize({ width, height, fit: "inside" }).toBuffer();
  const { height: fittedHeight = height } = await sharp(fitted).metadata();
  // Keep the photo's subject clear of the words and of the Stories/Reels UI (#1077).
  const top = storyPhotoTop(design.layout, fittedHeight, height);
  // JPEG: a tenth of the PNG's size, so the composite decodes it about a third faster (#499).
  const background = await sharp(backdrop).composite([{ input: fitted, left: 0, top }]).jpeg({ quality: 90 }).toBuffer();
  const spec: AdDesignSpec = { ...design, format: "story", width, height, backgroundUrl: `data:image/jpeg;base64,${background.toString("base64")}` };
  return renderCompositeAd(spec);
}

/**
 * Starts every ad's 9:16 render at once and returns one promise per ad, each settling to the image
 * or null: on a render error, or for any still rendering when `budgetMs` runs out (reported once).
 * Callers await each only when they need it, so the renders overlap other work.
 */
export function renderStoriesWithin(
  generations: unknown[],
  budgetMs: number,
  onFallback: (code: "error" | "timeout") => void,
  render: (generation: unknown) => Promise<Uint8Array | null> = renderStoryAd,
): Promise<Uint8Array | null>[] {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reportedTimeout = false;
  const deadline = new Promise<void>(resolve => { timer = setTimeout(resolve, budgetMs); });
  const renders = generations.map(generation => render(generation).catch(() => {
    onFallback("error");
    return null;
  }));
  void Promise.all(renders).finally(() => clearTimeout(timer));
  return renders.map(rendering => {
    let settled = false;
    void rendering.finally(() => { settled = true; });
    return Promise.race([rendering, deadline.then(() => {
      if (!settled && !reportedTimeout) {
        reportedTimeout = true;
        onFallback("timeout");
      }
      return null;
    })]);
  });
}
