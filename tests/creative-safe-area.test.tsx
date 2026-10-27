import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildAdDesign, type AdDesignSpec, type AdFormat } from "@/lib/creative/design";
import { renderCompositeAd } from "@/lib/creative/render";
import { STORY_SAFE, storyPhotoTop } from "@/lib/creative/story";

// #1077: Stories and Reels cover the top and bottom of a 9:16 ad with their own UI (profile bar; caption, reply box
// and CTA), and Instagram's 4:5 feed covers the bottom edge. The brand colour is drawn only on the logo tile, the
// offer strip (#993), the phone badge and the CTA, so painting it a marker colour finds their real boxes.
const MARKER = "#ff00ff";
const brand = { name: "Solaride", phone: "+91 98290 12345", primary_color: MARKER };
const copy = { headline: "Your rooftop could cut power bills", primary_text: "Free site survey for Tricity homes.", cta: "Get Quote" };

async function markerBox(format: AdFormat, layout: AdDesignSpec["layout"]) {
  const base = buildAdDesign({ brand, copy, format });
  const black = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000000" } }).png().toBuffer();
  const spec: AdDesignSpec = { ...base, layout, subhead: "FREE site survey", showCta: true, backgroundUrl: `data:image/png;base64,${black.toString("base64")}` };
  const { data, info } = await sharp(Buffer.from(await renderCompositeAd(spec))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let top = Infinity, bottom = -1, left = Infinity, right = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 3;
    if (data[i] > 225 && data[i + 1] < 40 && data[i + 2] > 225) { top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x); }
  }
  return { top, bottom, left, right, width: info.width, height: info.height };
}

describe("the logo, offer strip, phone and CTA stay where Stories, Reels and the feed don't cover them (#1077)", () => {
  it.each(["top", "center", "bottom"] as const)("9:16, words $0: inside the top, bottom and side margins", async layout => {
    const box = await markerBox("story", layout);
    expect(box.bottom).toBeGreaterThan(0);
    expect(box.top).toBeGreaterThanOrEqual(Math.floor(box.height * STORY_SAFE.top));
    expect(box.bottom).toBeLessThanOrEqual(Math.ceil(box.height * (1 - STORY_SAFE.bottom)));
    expect(box.left).toBeGreaterThanOrEqual(Math.floor(box.width * STORY_SAFE.side));
    expect(box.right).toBeLessThanOrEqual(Math.ceil(box.width * (1 - STORY_SAFE.side)));
  }, 30_000);

  it.each(["top", "bottom"] as const)("4:5, words $0: clear of the bottom and side edges", async layout => {
    const box = await markerBox("portrait", layout);
    expect(box.bottom).toBeLessThan(box.height - Math.round(box.height * 0.04));
    expect(box.left).toBeGreaterThanOrEqual(Math.floor(box.width * 0.05));
    expect(box.right).toBeLessThanOrEqual(Math.ceil(box.width * 0.95));
  }, 30_000);
});

describe("the 4:5 photo in a 9:16 story keeps its middle (the subject) on screen (#1077)", () => {
  const height = 1920, photo = 1350;
  it.each(["top", "center", "bottom"] as const)("words $0: the photo's middle is inside the Stories and Reels band", layout => {
    const top = storyPhotoTop(layout, photo, height);
    const middle = top + photo / 2;
    expect(middle).toBeGreaterThanOrEqual(height * STORY_SAFE.top);
    expect(middle).toBeLessThanOrEqual(height * (1 - STORY_SAFE.bottom));
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top + photo).toBeLessThanOrEqual(height);
  });

  it("words on top: the photo starts at the top safe line, as the feed picture sits under its words", () => {
    expect(storyPhotoTop("top", photo, height)).toBe(Math.round(height * STORY_SAFE.top));
    // It used to sit on the bottom edge, its lowest 28% under the Stories reply bar; now under 7%.
    expect(storyPhotoTop("top", photo, height) + photo - height * 0.8).toBeLessThan(photo * 0.07);
  });
});
