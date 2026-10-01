import {
  buildAdDesign,
  formatDimensions,
  type AdDesignSpec,
  type AdFormat,
} from "@/lib/creative/design";
import {
  buildConceptMessages,
  conceptValidationRules,
  creativeConceptSchema,
  conceptImagePrompt,
  validateConcept,
  type CreativeConcept,
  type ConceptInput,
} from "@/lib/creative/concept";
import { generateImage } from "@/lib/imageGen";
import type { ImageAttempt } from "@/lib/imageGen/types";
import { complete, parseJSON } from "@/lib/llm";
import { LLMError } from "@/lib/llm/types";
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
    providerRequestId?: string;
    providerFinalStatus?: "completed" | "failed" | "unknown";
    status?: "success" | "error";
    validation?: { stage: "provider" | "parse" | "concept"; rules: string[] };
  }[];
  imageUsage: {
    provider: string;
    model: string;
    estimatedCostUsd?: number;
    latencyMs?: number;
    width: number;
    height: number;
    fallbackFrom?: string;
    providerRequestId?: string;
    providerFinalStatus?: "completed" | "failed" | "unknown";
  };
  imageAttempts?: ImageAttempt[];
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
  recentCopy?: ConceptInput["recentCopy"];
  advisoryPreferences?: string;
  sourceFacts?: string[];
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
  const advisoryPreferences = params.advisoryPreferences?.slice(0, 1_200);
  const sourceFacts = params.sourceFacts?.slice(0, 12).map((fact) => fact.slice(0, 2_000)) ?? [];
  const count = Math.min(Math.max(params.count ?? 3, 1), AD_ANGLES.length);
  const signal = AbortSignal.timeout(240_000);

  const angles: AdAngle[] = (
    params.angleIds?.length
      ? params.angleIds
          .map(getAngle)
          .filter((a): a is AdAngle => a !== undefined)
      : AD_ANGLES
  ).slice(0, count);

  const recentCopy = [...(params.recentCopy ?? []).slice(0, 12)];
  let planning = Promise.resolve();
  let startNext = Promise.resolve();
  const outcomes = await Promise.allSettled(
    angles.map(async (angle) => {
      try {
        const input: ConceptInput = { brand, brief, angle, instructions, language, format, referenceImages, advisoryPreferences, sourceFacts };
        const waitForTurn = startNext;
        let notifyNext!: () => void;
        startNext = new Promise<void>((resolve) => { notifyNext = resolve; });
        const earlierConcepts = planning.then(() => {
          input.recentCopy = recentCopy.slice(0, 12);
        });
        const planned = waitForTurn.then(() => {
          input.recentCopy = recentCopy.slice(0, 12);
          return generateConcept(input, signal, earlierConcepts, notifyNext);
        }).then((result) => {
          recentCopy.unshift(result.concept);
          return result;
        });
        planning = planned.then(() => undefined, () => undefined);
        void planning.then(notifyNext);
        const variant = await renderVariant(input, signal, await planned);
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
    public stage: "provider" | "parse" | "concept" = "concept",
  ) {
    super(`Creative concept failed validation: ${issues.join("; ")}`);
    this.name = "CreativeValidationError";
  }
}

export class CreativeImageError extends Error {
  constructor(
    cause: unknown,
    public usage: GeneratedVariant["llmUsage"],
    public imageAttempts: ImageAttempt[] = [],
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
  earlierConcepts: Promise<void> = Promise.resolve(),
  onRepair?: () => void,
): Promise<{ concept: CreativeConcept; usage: GeneratedVariant["llmUsage"] }> {
  const messages = buildConceptMessages(input);
  const usage: GeneratedVariant["llmUsage"] = [];
  let issues: string[] = [];
  let stage: CreativeValidationError["stage"] = "concept";
  for (let attempt = 0; attempt < 2; attempt++) {
    const usageBeforeAttempt = usage.length;
    const env = getEnv();
    let sawProviderAttempt = false;
    const completion = await complete(messages, {
      json: true,
      responseSchema: creativeConceptSchema,
      temperature: attempt === 0 ? 0.8 : 0.4,
      maxTokens: env.CREATIVE_MAX_TOKENS,
      reasoningEffort: env.CREATIVE_REASONING_EFFORT,
      cache: false,
      signal,
      onAttempt: (entry) => {
        sawProviderAttempt = true;
        usage.push({ ...entry, usage: entry.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
      },
    }).catch((error: unknown) => {
      if (!sawProviderAttempt && error instanceof LLMError && error.model) {
        usage.push({ provider: error.provider, model: error.model,
          usage: error.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          providerRequestId: error.providerRequestId, providerFinalStatus: error.providerFinalStatus ?? "unknown", status: "error" });
      }
      if (usage.length) {
        if (sawProviderAttempt || (error instanceof LLMError && error.model)) {
          usage[usage.length - 1].validation = { stage: "provider", rules: ["other"] };
        }
        throw new CreativeValidationError(["Provider attempt could not be confirmed"], usage, "provider");
      }
      throw error;
    });
    if (attempt === 0) {
      await earlierConcepts;
      messages[1] = buildConceptMessages(input)[1];
    }
    if (!sawProviderAttempt && completion.usage) {
      usage.push({
        provider: completion.provider,
        model: completion.model,
        usage: completion.usage,
        inputChars: completion.inputChars,
        outputChars: completion.outputChars,
        latencyMs: completion.latencyMs,
        cacheHit: completion.cached,
        providerRequestId: completion.providerRequestId,
        providerFinalStatus: completion.providerFinalStatus ?? "unknown",
        status: "success",
      });
    }
    let value: unknown;
    try {
      value = parseJSON<unknown>(completion.text);
    } catch {
      stage = "parse";
      issues = [
        "Output must be valid JSON matching the requested concept shape.",
      ];
    }
    if (value !== undefined) {
      stage = "concept";
      const result = validateConcept(value, input);
      if (result.success) return { concept: result.concept, usage };
      issues = result.issues;
    }
    if (usage.length > usageBeforeAttempt) usage[usage.length - 1].validation = { stage, rules: conceptValidationRules(issues) };
    messages.push({
      role: "user",
      content: `Generate a fresh, complete JSON concept for the original brief. Fix these validation failures using only supplied facts, without inventing claims:\n${issues.join("\n")}`,
    });
    if (attempt === 0) onRepair?.();
  }
  throw new CreativeValidationError(issues, usage, stage);
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
  recentCopy: ConceptInput["recentCopy"] = [],
  advisoryPreferences?: string,
  sourceFacts: string[] = [],
): Promise<GeneratedVariant> {
  brand = boundedBrand(brand);
  brief = brief.slice(0, MAX_BRIEF_CHARS);
  instructions = instructions?.slice(0, 3_000);
  advisoryPreferences = advisoryPreferences?.slice(0, 1_200);
  const input = {
    brand,
    brief,
    angle,
    instructions,
    language,
    format,
    referenceImages,
    recentCopy,
    advisoryPreferences,
    sourceFacts: sourceFacts.slice(0, 12).map((fact) => fact.slice(0, 2_000)),
  };
  return renderVariant(input, signal, await generateConcept(input, signal));
}

async function renderVariant(
  input: ConceptInput,
  signal: AbortSignal,
  planned: { concept: CreativeConcept; usage: GeneratedVariant["llmUsage"] },
): Promise<GeneratedVariant> {
  const { brand, angle, format, referenceImages } = input;
  const dims = formatDimensions(format ?? "portrait");
  const { concept, usage } = planned;
  const imageAttempts: ImageAttempt[] = [];
  const image = await generateImage({
    prompt: conceptImagePrompt(concept, input),
    width: dims.width,
    height: dims.height,
    referenceImages: referenceImages?.slice(0, 3),
    signal,
    onAttempt: (entry) => imageAttempts.push(entry),
  }).catch((error) => {
    throw new CreativeImageError(error, usage, imageAttempts);
  });

  return {
    concept,
    angleId: angle.id,
    angleName: angle.name,
    headline: concept.headline,
    primaryText: concept.primary_text,
    cta: concept.cta,
    imageUrl: image.url,
    imagePrompt: input.advisoryPreferences
      ? "[Image prompt omitted because declared preferences were applied; the generated concept may reflect their style.]"
      : image.prompt,
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
      providerRequestId: image.providerRequestId,
      providerFinalStatus: image.providerFinalStatus,
    },
    imageAttempts,
  };
}
