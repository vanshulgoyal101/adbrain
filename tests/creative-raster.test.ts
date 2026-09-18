import { describe, expect, it, vi } from "vitest";
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
  it("blocks a private logo before the renderer can fetch it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    try {
      const design = buildAdDesign({
        brand: { name: "Example", logo_url: "http://[::ffff:7f00:1]/logo.png" },
        copy: { headline: "Example", primary_text: "A local service", cta: "Learn More" },
      });
      await expect(renderCompositeAd(design)).rejects.toMatchObject({ code: "blocked" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
    }
  });

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
          description: "Discuss your rooftop plans.",
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
