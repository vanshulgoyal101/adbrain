/**
 * Makes the /ideas gallery (#289 slice 3): three real AdBrain ads for each example local business,
 * through the production Create pipeline (concepts, fact checks, image, overlay), with the
 * production models. Writes public/ideas/<slug>-<n>.webp and src/lib/ideas/ads.json. The
 * businesses are examples: no phone numbers or websites, and only evergreen offers.
 * Costs about one Create run per business. Re-run to refresh; pass slugs to redo some.
 *
 *   AD_DESIGN_OVERLAY=true IMAGE_PROVIDER=openrouter OPENROUTER_IMAGE_MODEL=openai/gpt-image-2.5-flare \
 *   CREATIVE_PROVIDER_ORDER=openrouter OPENROUTER_MODEL=anthropic/claude-haiku-5.5 \
 *     npx tsx --env-file=.env.local scripts/make-idea-ads.ts [slug ...]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { generateVariants } from "@/lib/creative/generate";
import { renderCompositeAd } from "@/lib/creative/render";
import { IDEA_BUSINESSES } from "@/lib/ideas/businesses";
import type { IdeaAd } from "@/lib/ideas/types";

const OUT_JSON = join(process.cwd(), "src/lib/ideas/ads.json");
const OUT_DIR = join(process.cwd(), "public/ideas");

async function main() {
  const only = new Set(process.argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });
  const saved: Record<string, IdeaAd[]> = existsSync(OUT_JSON) ? JSON.parse(readFileSync(OUT_JSON, "utf8")) : {};
  for (const business of IDEA_BUSINESSES) {
    if (only.size && !only.has(business.slug)) continue;
    const ads: IdeaAd[] = [];
    const facts = [...business.brand.usps ?? [], ...business.brand.offers ?? []];
    await generateVariants({
      brand: business.brand,
      brief: business.goal,
      count: 3,
      format: "portrait",
      sourceFacts: facts,
      onVariant: async (variant) => {
        const png = await renderCompositeAd({ ...variant.design, backgroundUrl: variant.imageUrl });
        const file = `${business.slug}-${ads.length + 1}.webp`;
        await sharp(Buffer.from(png)).resize(720).webp({ quality: 78 }).toFile(join(OUT_DIR, file));
        ads.push({ image: `/ideas/${file}`, angle: variant.angleName, headline: variant.headline, primaryText: variant.primaryText, cta: variant.cta });
        console.log(business.slug, ads.length, variant.angleName, "|", variant.headline);
      },
      onFailure: async (angle, error) => { console.log(business.slug, "failed", angle.name, error instanceof Error ? error.message.slice(0, 160) : error); },
    });
    if (ads.length) saved[business.slug] = ads;
    writeFileSync(OUT_JSON, `${JSON.stringify(saved, null, 2)}\n`);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
