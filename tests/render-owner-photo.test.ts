import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { buildAdDesign } from "@/lib/creative/design";

// #1904: the renderer fits the background photo to the ad's exact frame (saliency crop, or 'blur') before compositing.
const photo = vi.hoisted(() => ({ bytes: new Uint8Array() }));
vi.mock("@/lib/imageGen", () => ({ downloadImage: vi.fn(async () => ({ bytes: photo.bytes, contentType: "image/jpeg" })) }));
const fits = vi.hoisted(() => [] as { width: number; height: number; fit: string }[]);
vi.mock("@/lib/creative/fit-photo", async (actual) => {
  const real = await actual<typeof import("@/lib/creative/fit-photo")>();
  return { ...real, fitPhoto: vi.fn(async (bytes: Uint8Array, width: number, height: number, fit = "attention") => {
    fits.push({ width, height, fit });
    return real.fitPhoto(bytes, width, height, fit);
  }) };
});
import { renderCompositeAd } from "@/lib/creative/render";

describe("renderCompositeAd fits the owner photo (#1904)", () => {
  it("a tall phone photo becomes a 4:5 ad: background fitted to 1080×1350 by saliency crop; 'blur' when asked", async () => {
    photo.bytes = new Uint8Array(await sharp({ create: { width: 900, height: 2000, channels: 3, background: "#6b7a80" } }).jpeg().toBuffer());
    const design = { ...buildAdDesign({ brand: { name: "Solaride" }, copy: { headline: "Rooftop solar", primary_text: "Free site survey.", cta: "Get Quote" } }), backgroundUrl: "https://cdn.example/owner.jpg" };
    const png = await renderCompositeAd(design);
    expect(await sharp(Buffer.from(png)).metadata()).toMatchObject({ width: design.width, height: design.height });
    expect(fits.at(-1)).toEqual({ width: design.width, height: design.height, fit: "attention" });
    await renderCompositeAd({ ...design, backgroundFit: "blur" });
    expect(fits.at(-1)).toEqual({ width: design.width, height: design.height, fit: "blur" });
  });
});
