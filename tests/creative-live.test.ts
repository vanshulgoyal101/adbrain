import { expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { generateOneVariant } from "@/lib/creative/generate";
import { renderCompositeAd } from "@/lib/creative/render";
import { generationReceipt } from "@/lib/creative/receipt";
import { AD_ANGLES } from "@/lib/templates/ads";

it.skipIf(process.env.RUN_PAID_CREATIVE_EVAL !== "1")(
  "executes one paid concept and image without fallback",
  async () => {
    expect(process.env.IMAGE_PROVIDER).toBe("openrouter");
    expect(process.env.IMAGE_PROVIDER_FALLBACK).toBe("none");
    expect(process.env.LLM_PROVIDER_ORDER).toBe("openrouter");
    const variant = await generateOneVariant(
      {
        name: "Example Solar",
        vertical: "Residential rooftop solar installation",
        description:
          "A fictional local installer offering rooftop solar consultations to homeowners in Pune.",
        target_audience: "Homeowners comparing rooftop solar options",
        brand_voice: "Practical and clear, no inflated promises",
        usps: ["Local installation team", "Rooftop assessment before a quote"],
        primary_color: "#18854b",
        website: "example.com",
      },
      "Invite homeowners to book a rooftop assessment. Make the installation itself concrete. No prices, subsidy claims, invented testimonials or savings percentages.",
      AD_ANGLES[0],
      undefined,
      "English",
      "portrait",
    );
    expect(variant.imageUsage.provider).toBe("openrouter-image");
    expect(variant.imageUsage.fallbackFrom).toBeUndefined();
    const composite = await renderCompositeAd(variant.design);
    const directory = `.creative-evals/${Date.now()}`;
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/finished.png`, composite);
    const image = await fetch(variant.imageUrl);
    await writeFile(
      `${directory}/source.png`,
      new Uint8Array(await image.arrayBuffer()),
    );
    await writeFile(
      `${directory}/receipt.json`,
      JSON.stringify(generationReceipt(variant, "English"), null, 2),
    );
    console.log(
      JSON.stringify({
        textModels: variant.llmUsage.map(({ provider, model }) => ({
          provider,
          model,
        })),
        image: variant.imageUsage,
        headline: variant.headline,
      }),
    );
  },
  280_000,
);
