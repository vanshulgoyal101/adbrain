import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildAdDesign, type AdDesignSpec } from "@/lib/creative/design";
import { renderCompositeAd } from "@/lib/creative/render";
import { renderPicturePreview } from "@/lib/creative/picture-preview";
import recorded from "./fixtures/create/solaride-hindi.json";

/** White text/shape extents in each section detect wrap and positioning drift, not just output dimensions. */
async function sectionBounds(png: Uint8Array) {
  const { data, info } = await sharp(Buffer.from(png)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return [0, 1, 2, 3].map((section) => {
    let left = info.width, right = -1, top = info.height, bottom = -1;
    for (let y = Math.floor(info.height * section / 4); y < Math.floor(info.height * (section + 1) / 4); y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * info.channels;
        if (data[i] < 210 || data[i + 1] < 210 || data[i + 2] < 210) continue;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    return [left, right, top, bottom];
  });
}

describe("exact previews keep final-size typography and geometry", () => {
  it.each([
    ["portrait", "top", "A long headline that must wrap predictably"],
    ["square", "center", "A long headline that must wrap predictably"],
    ["landscape", "bottom", "A long headline that must wrap predictably"],
    ["story", "bottom", recorded.goals.hi.factory.split(":")[0]],
  ] as const)("%s/%s keeps the final text and shape extents within two output pixels", async (format, layout, headline) => {
    const design: AdDesignSpec = {
      ...buildAdDesign({
        brand: { name: "Sample Solar", phone: "+1 555 0100", primary_color: "#173524" },
        copy: { headline, primary_text: "Free site survey.", cta: "Contact Us" },
        format,
      }),
      layout,
      subhead: "Free survey: 20% off",
      benefits: ["Local support", "Clear pricing"],
    };
    const full = await renderCompositeAd(design);
    const expected = await sharp(Buffer.from(full)).resize({ width: 720 }).webp({ quality: 72 }).toBuffer();
    const url = await renderPicturePreview("synthetic-owner", format, design);
    const preview = Buffer.from(url.split(",")[1], "base64");
    const metadata = await sharp(Buffer.from(preview)).metadata();
    expect(metadata.width).toBe(720);
    expect(metadata.height).toBe(Math.round(design.height * 720 / design.width));
    const a = await sectionBounds(expected);
    const b = await sectionBounds(preview);
    for (let section = 0; section < a.length; section++) {
      for (let edge = 0; edge < 4; edge++) {
        expect(Math.abs(a[section][edge] - b[section][edge]), `section ${section}, edge ${edge}`).toBeLessThanOrEqual(2);
      }
    }
    expect(preview).toEqual(expected);
  });

  it("never enlarges a small design", async () => {
    const design = { ...buildAdDesign({ brand: { name: "Sample" }, copy: { headline: "Sample", primary_text: "Sample", cta: "Contact Us" } }), width: 540, height: 675 };
    const url = await renderPicturePreview("synthetic-owner", "small", design);
    const preview = Buffer.from(url.split(",")[1], "base64");
    expect(await sharp(Buffer.from(preview)).metadata()).toMatchObject({ width: 540, height: 675 });
  });
});
