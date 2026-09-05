import {
  buildAdDesign,
  formatDimensions,
  type AdDesignSpec,
  type AdFormat,
} from "@/lib/creative/design";
import {
  buildConceptMessages,
  conceptImagePrompt,
  validateConcept,
  type CreativeConcept,
  type ConceptInput,
} from "@/lib/creative/concept";
import { generateImage } from "@/lib/imageGen";
import { complete, parseJSON } from "@/lib/llm";
import type { TokenUsage } from "@/lib/llm";
import { getEnv } from "@/lib/env";
import {
  AD_ANGLES,
  getAngle,
  type AdAngle,
  type BrandContext,
} from "@/lib/templates/ads";

export interface GeneratedVariant {
  concept: CreativeConcept;
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
    inputChars?: number;
    outputChars?: number;
    latencyMs?: number;
    cacheHit?: boolean;
  }[];
  imageUsage: {
    provider: string;
    model: string;
    estimatedCostUsd?: number;
    latencyMs?: number;
    width: number;
    height: number;
    fallbackFrom?: string;
  };
}

const MAX_BRIEF_CHARS = 2_000;
const MAX_FIELD_CHARS = 1_000;
const MAX_LIST_ITEMS = 10;

function boundedBrand(brand: BrandContext): BrandContext {
  const boundedList = (items?: string[]) =>
    items
      ?.slice(0, MAX_LIST_ITEMS)
      .map((item) => item.slice(0, MAX_FIELD_CHARS));
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

export async function generateVariants(params: {
  brand: BrandContext;
  brief: string;
  angleIds?: string[];
  count?: number;
  instructions?: string;
  language?: string;
  format?: AdFormat;
  referenceImages?: string[];
  onVariant?: (variant: GeneratedVariant) => Promise<void>;
  onFailure?: (angle: AdAngle, error: unknown) => Promise<void>;
}): Promise<GeneratedVariant[]> {
  const {
    brand: rawBrand,
    brief: rawBrief,
    instructions: rawInstructions,
    language,
    format,
    referenceImages,
  } = params;
  const brand = boundedBrand(rawBrand);
  const brief = rawBrief.slice(0, MAX_BRIEF_CHARS);
  const instructions = rawInstructions?.slice(0, 3_000);
  const count = Math.min(Math.max(params.count ?? 3, 1), AD_ANGLES.length);
  const signal = AbortSignal.timeout(240_000);

  const angles: AdAngle[] = (
    params.angleIds?.length
      ? params.angleIds
          .map(getAngle)
          .filter((a): a is AdAngle => a !== undefined)
      : AD_ANGLES
  ).slice(0, count);

  const outcomes = await Promise.allSettled(
    angles.map(async (angle) => {
      try {
        const variant = await generateOneVariant(
          brand,
          brief,
          angle,
          instructions,
          language,
          format,
          referenceImages,
          signal,
        );
        await params.onVariant?.(variant);
        return variant;
      } catch (error) {
        await params.onFailure?.(angle, error);
        throw error;
      }
    }),
  );
  const variants = outcomes.flatMap((outcome) =>
    outcome.status === "fulfilled" ? [outcome.value] : [],
  );
  if (
    !params.onFailure &&
    outcomes.some((outcome) => outcome.status === "rejected")
  ) {
    throw outcomes.find((outcome) => outcome.status === "rejected")!.reason;
  }
  return variants;
}

export class CreativeValidationError extends Error {
  constructor(
    public issues: string[],
    public usage: GeneratedVariant["llmUsage"],
  ) {
    super(`Creative concept failed validation: ${issues.join("; ")}`);
    this.name = "CreativeValidationError";
  }
}

export class CreativeImageError extends Error {
  constructor(
    cause: unknown,
    public usage: GeneratedVariant["llmUsage"],
  ) {
    super(cause instanceof Error ? cause.message : "Image generation failed.", {
      cause,
    });
    this.name = "CreativeImageError";
  }
}

async function generateConcept(
  input: ConceptInput,
  signal: AbortSignal,
): Promise<{ concept: CreativeConcept; usage: GeneratedVariant["llmUsage"] }> {
  const messages = buildConceptMessages(input);
  const usage: GeneratedVariant["llmUsage"] = [];
  let issues: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const env = getEnv();
    const completion = await complete(messages, {
      json: true,
      temperature: attempt === 0 ? 0.8 : 0.4,
      maxTokens: env.CREATIVE_MAX_TOKENS,
      reasoningEffort: env.CREATIVE_REASONING_EFFORT,
      cache: false,
      signal,
    });
    if (completion.usage) {
      usage.push({
        provider: completion.provider,
        model: completion.model,
        usage: completion.usage,
        inputChars: completion.inputChars,
        outputChars: completion.outputChars,
        latencyMs: completion.latencyMs,
        cacheHit: completion.cached,
      });
    }
    let value: unknown;
    try {
      value = parseJSON<unknown>(completion.text);
    } catch {
      issues = [
        "Output must be valid JSON matching the requested concept shape.",
      ];
    }
    if (value !== undefined) {
      const result = validateConcept(value, input);
      if (result.success) return { concept: result.concept, usage };
      issues = result.issues;
    }
    messages.push(
      { role: "assistant", content: completion.text.slice(0, 12_000) },
      {
        role: "user",
        content: `Repair this concept. Return the complete JSON object. Fix these validation failures without inventing facts:\n${issues.join("\n")}`,
      },
    );
  }
  throw new CreativeValidationError(issues, usage);
}

export async function generateOneVariant(
  brand: BrandContext,
  brief: string,
  angle: AdAngle,
  instructions?: string,
  language?: string,
  format?: AdFormat,
  referenceImages?: string[],
  signal: AbortSignal = AbortSignal.timeout(240_000),
): Promise<GeneratedVariant> {
  brand = boundedBrand(brand);
  brief = brief.slice(0, MAX_BRIEF_CHARS);
  instructions = instructions?.slice(0, 3_000);
  const input = {
    brand,
    brief,
    angle,
    instructions,
    language,
    format,
    referenceImages,
  };
  const dims = formatDimensions(format ?? "portrait");
  const { concept, usage } = await generateConcept(input, signal);
  const image = await generateImage({
    prompt: conceptImagePrompt(concept, input),
    width: dims.width,
    height: dims.height,
    referenceImages: referenceImages?.slice(0, 3),
    signal,
  }).catch((error) => {
    throw new CreativeImageError(error, usage);
  });

  return {
    concept,
    angleId: angle.id,
    angleName: angle.name,
    headline: concept.headline,
    primaryText: concept.primary_text,
    cta: concept.cta,
    imageUrl: image.url,
    imagePrompt: image.prompt,
    design: buildAdDesign({
      brand,
      copy: concept,
      concept,
      angle,
      backgroundUrl: image.url,
      format,
    }),
    llmUsage: usage,
    imageUsage: {
      provider: image.provider,
      model: image.model ?? image.provider,
      estimatedCostUsd: image.estimatedCostUsd,
      latencyMs: image.latencyMs,
      width: image.width ?? dims.width,
      height: image.height ?? dims.height,
      fallbackFrom: image.fallbackFrom,
    },
  };
}
