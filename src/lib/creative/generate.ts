import { buildAdDesign, formatDimensions, type AdDesignSpec, type AdFormat } from "@/lib/creative/design";
import { bannedClaimsForVertical, scanAdCopy } from "@/lib/creative/slopScan";
import { generateImage } from "@/lib/imageGen";
import { completeJSON } from "@/lib/llm";
import type { TokenUsage } from "@/lib/llm";
import {
  AD_ANGLES,
  buildCopyMessages,
  buildImagePrompt,
  getAngle,
  type AdAngle,
  type BrandContext,
  type GeneratedCopy,
} from "@/lib/templates/ads";

export interface GeneratedVariant {
  angleId: string;
  angleName: string;
  headline: string;
  primaryText: string;
  cta: string;
  imageUrl: string;
  imagePrompt: string;
  /** Design spec used to composite the finished poster over `imageUrl`. */
  design: AdDesignSpec;
  llmUsage: {
    provider: string;
    model: string;
    usage: TokenUsage;
  }[];
}

const MAX_BRIEF_CHARS = 2_000;
const MAX_FIELD_CHARS = 1_000;
const MAX_LIST_ITEMS = 10;

function boundedBrand(brand: BrandContext): BrandContext {
  const boundedList = (items?: string[]) =>
    items?.slice(0, MAX_LIST_ITEMS).map((item) => item.slice(0, MAX_FIELD_CHARS));
  return {
    ...brand,
    name: brand.name.slice(0, MAX_FIELD_CHARS),
    description: brand.description?.slice(0, MAX_FIELD_CHARS),
    brand_voice: brand.brand_voice?.slice(0, MAX_FIELD_CHARS),
    target_audience: brand.target_audience?.slice(0, MAX_FIELD_CHARS),
    usps: boundedList(brand.usps),
    offers: boundedList(brand.offers),
    languages: boundedList(brand.languages),
    locations: boundedList(brand.locations),
  };
}

/**
 * Generate N complete ad variants (copy + image) for a brand + brief, one per
 * ad angle. Runs angles in parallel so a 3–5 variant batch stays well under
 * the 60s acceptance target.
 */
export async function generateVariants(params: {
  brand: BrandContext;
  brief: string;
  angleIds?: string[];
  count?: number;
  instructions?: string;
  language?: string;
  format?: AdFormat;
}): Promise<GeneratedVariant[]> {
  const {
    brand: rawBrand,
    brief: rawBrief,
    instructions: rawInstructions,
    language,
    format,
  } = params;
  const brand = boundedBrand(rawBrand);
  const brief = rawBrief.slice(0, MAX_BRIEF_CHARS);
  const instructions = rawInstructions?.slice(0, 3_000);
  const count = Math.min(Math.max(params.count ?? 3, 1), AD_ANGLES.length);

  const angles: AdAngle[] = (
    params.angleIds?.length
      ? params.angleIds
          .map(getAngle)
          .filter((a): a is AdAngle => a !== undefined)
      : AD_ANGLES
  ).slice(0, count);

  return Promise.all(
    angles.map((angle) =>
      generateOneVariant(brand, brief, angle, instructions, language, format),
    ),
  );
}

// Generate copy, retrying once if the first draft trips the deterministic slop
// scanner (clichés, shouting, over-length). Image generates in parallel, so the
// happy path costs nothing extra.
async function generateGuardedCopy(
  brand: BrandContext,
  brief: string,
  angle: AdAngle,
  instructions?: string,
  language?: string,
): Promise<{ copy: GeneratedCopy; usage: GeneratedVariant["llmUsage"] }> {
  let normalized: GeneratedCopy = { headline: "", primary_text: "", cta: "Learn More" };
  const usage: GeneratedVariant["llmUsage"] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const copy = await completeJSON<GeneratedCopy & {
      __completion?: {
        provider: string;
        model: string;
        usage?: TokenUsage;
      };
    }>(
      buildCopyMessages(brand, brief, angle, instructions, language),
      { temperature: attempt === 0 ? 0.8 : 0.6, maxTokens: 400 },
    );
    if (copy.__completion?.usage) {
      usage.push({
        provider: copy.__completion.provider,
        model: copy.__completion.model,
        usage: copy.__completion.usage,
      });
    }
    normalized = {
      headline: copy.headline?.trim() ?? "",
      primary_text: copy.primary_text?.trim() ?? "",
      cta: copy.cta?.trim() || "Learn More",
    };
    const findings = scanAdCopy([normalized.headline, normalized.primary_text].join(" "), {
      maxWords: 60,
      bannedClaims: bannedClaimsForVertical(brand.vertical),
    });
    if (findings.length === 0) break;
  }
  return { copy: normalized, usage };
}

export async function generateOneVariant(
  brand: BrandContext,
  brief: string,
  angle: AdAngle,
  instructions?: string,
  language?: string,
  format?: AdFormat,
): Promise<GeneratedVariant> {
  const dims = formatDimensions(format ?? "portrait");
  const [copyResult, image] = await Promise.all([
    generateGuardedCopy(brand, brief, angle, instructions, language),
    generateImage({
      prompt: buildImagePrompt(brand, brief, angle, instructions),
      width: dims.width,
      height: dims.height,
    }),
  ]);
  const normalizedCopy = copyResult.copy;

  return {
    angleId: angle.id,
    angleName: angle.name,
    headline: normalizedCopy.headline,
    primaryText: normalizedCopy.primary_text,
    cta: normalizedCopy.cta,
    imageUrl: image.url,
    imagePrompt: image.prompt,
    design: buildAdDesign({
      brand,
      copy: normalizedCopy,
      angle,
      backgroundUrl: image.url,
      format,
    }),
    llmUsage: copyResult.usage,
  };
}
