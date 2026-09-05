import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import {
  buildAdDesign,
  AD_FORMATS,
  type AdFormat,
} from "@/lib/creative/design";
import { renderCompositeAd } from "@/lib/creative/render";
import type { CreativeConcept } from "@/lib/creative/concept";

describe("actual creative raster output", () => {
  it.each(Object.keys(AD_FORMATS) as AdFormat[])(
    "renders nonblank %s composites in every text position",
    async (format) => {
      const background = await sharp("public/solar-example.jpg")
        .resize(900)
        .png()
        .toBuffer();
      for (const textPlacement of ["top", "center", "bottom"] as const) {
        const concept: CreativeConcept = {
          headline: "A better use for your rooftop",
          primary_text: "Explore solar with a local installation team.",
          cta: "Get Quote",
          rationale: "Show a concrete home improvement.",
          visual: {
            medium: "Photography",
            direction:
              "Rooftop solar panels in the upper half of a realistic residential setting.",
            textPlacement,
          },
          supportingText:
            "A local installation team, from consultation to completion",
          sourceQuotes: [],
        };
        const design = buildAdDesign({
          brand: {
            name: "Example Solar",
            website: "example.com",
            phone: "+91 90000 00000",
            primary_color: "#18854b",
          },
          copy: concept,
          concept,
          format,
          backgroundUrl: `data:image/png;base64,${background.toString("base64")}`,
        });
        const bytes = await renderCompositeAd(design);
        const metadata = await sharp(bytes).metadata();
        expect(metadata).toMatchObject({
          format: "png",
          ...AD_FORMATS[format],
        });
        const stats = await sharp(bytes).stats();
        expect(stats.channels[0].stdev).toBeGreaterThan(20);
        const footer = await sharp(bytes)
          .extract({
            left: 0,
            top: design.height - 100,
            width: design.width,
            height: 100,
          })
          .stats();
        expect(footer.channels[0].max).toBeGreaterThan(20);
        if (process.env.WRITE_CREATIVE_RASTERS === "1") {
          await mkdir("test-results/creative-raster", { recursive: true });
          await writeFile(
            `test-results/creative-raster/${format}-${textPlacement}.png`,
            bytes,
          );
        }
      }
    },
    30_000,
  );
});
