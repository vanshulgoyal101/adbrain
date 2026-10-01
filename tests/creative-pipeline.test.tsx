// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMounted } from "@/lib/use-mounted";
import { LLMError } from "@/lib/llm/types";

const complete = vi.fn();
const generateImage = vi.fn();
const downloadImage = vi.fn();
const renderCompositeAd = vi.fn();
vi.mock("@/lib/creative/render", () => ({ renderCompositeAd }));

vi.mock("@/lib/llm", () => ({
  complete,
  parseJSON: JSON.parse,
  NoLLMKeysError: class NoLLMKeysError extends Error {},
}));
vi.mock("@/lib/imageGen", () => ({ generateImage, downloadImage }));

const concept = {
  headline: "  Cut your power bill  ",
  primary_text: "  Two lines of copy.  ",
  description: "Discuss your rooftop plans.",
  cta: "Get Quote",
  rationale: "Show the practical value of rooftop solar.",
  visual: { medium: "Illustration", direction: "A rooftop array on a home occupies the lower half, leaving open space above.", textPlacement: "top" },
  supportingText: null,
  sourceQuotes: ["Solaride"],
};
const completion = (value: unknown) => ({ text: JSON.stringify(value), provider: "test", model: "capable-model" });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  complete.mockImplementation(async (messages) => {
    const recent = JSON.parse(messages[1].content).recentCopy ?? [];
    return completion(recent.length ? {
      ...concept, headline: `Roof idea ${recent.length}`, primary_text: `Approach ${recent.length}: explore your rooftop options.`,
    } : concept);
  });
  generateImage.mockResolvedValue({
    url: "https://img.example/a.jpg",
    prompt: "a photo",
  });
  renderCompositeAd.mockResolvedValue(new Uint8Array([1, 2, 3]));
});

const brand = { name: "Solaride", vertical: "solar energy" } as never;

describe("generateVariants", () => {
  it("keeps failed provider fallthrough evidence in a successful creative receipt", async () => {
    complete.mockImplementationOnce(async (_messages, options) => {
      options.onAttempt({ provider: "groq", model: "model-a", providerRequestId: "groq-failed-123", providerFinalStatus: "unknown", status: "error" });
      options.onAttempt({ provider: "openrouter", model: "model-b", providerRequestId: "openrouter-done-456", providerFinalStatus: "completed", status: "success", usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 } });
      return { ...completion(concept), provider: "openrouter", model: "model-b", usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 } };
    });
    const { generateVariants } = await import("@/lib/creative/generate");
    const { variantUsageEvents } = await import("@/lib/creative/receipt");
    const [variant] = await generateVariants({ brand, brief: "x", count: 1 });
    const events = variantUsageEvents(variant, { businessId: "business", userId: "user", route: "creatives.generate", requestId: "request" });
    expect(events.slice(0, 2)).toMatchObject([
      { provider: "groq", status: "error", usage: { totalTokens: 0 }, providerRequestId: "groq-failed-123", providerFinalStatus: "unknown" },
      { provider: "openrouter", status: "success", usage: { totalTokens: 10 }, providerRequestId: "openrouter-done-456", providerFinalStatus: "completed" },
    ]);
    expect(events.filter((event) => event.usageKind !== "image").reduce((total, event) => total + event.usage.totalTokens, 0)).toBe(10);
  });

  it("keeps failed and completed image attempts separately when a fallback succeeds", async () => {
    generateImage.mockImplementationOnce(async ({ onAttempt }) => {
      onAttempt({ provider: "openrouter-image", model: "image-a", status: "error", providerRequestId: "image-failed-123", providerFinalStatus: "unknown" });
      onAttempt({ provider: "backup-image", model: "image-b", status: "success", providerRequestId: "image-done-456", providerFinalStatus: "completed", estimatedCostUsd: 0.13 });
      return { url: "https://img.example/a.jpg", prompt: "a photo", provider: "backup-image", model: "image-b", fallbackFrom: "openrouter-image", estimatedCostUsd: 0.13,
        width: 120, height: 160, latencyMs: 250 };
    });
    const { generateVariants } = await import("@/lib/creative/generate");
    const { variantUsageEvents } = await import("@/lib/creative/receipt");
    const [variant] = await generateVariants({ brand, brief: "x", count: 1 });
    const events = variantUsageEvents(variant, { businessId: "business", userId: "user", route: "creatives.generate", requestId: "request" });
    expect(events.filter((event) => event.usageKind === "image")).toMatchObject([
      { provider: "openrouter-image", providerRequestId: "image-failed-123", providerFinalStatus: "unknown", status: "error" },
      { provider: "backup-image", providerRequestId: "image-done-456", providerFinalStatus: "completed", status: "fallback", estimatedCostUsd: 0.13,
        imageWidth: 120, imageHeight: 160, latencyMs: 250, metadata: { fallbackFrom: "openrouter-image" } },
    ]);
  });

  it("keeps image failure evidence even when no creative is saved", async () => {
    generateImage.mockImplementationOnce(async ({ onAttempt }) => {
      onAttempt({ provider: "openrouter-image", model: "image-a", status: "error", providerRequestId: "image-failed-123", providerFinalStatus: "unknown" });
      throw new Error("Image unavailable");
    });
    const { generateVariants } = await import("@/lib/creative/generate");
    const { failedVariantUsage } = await import("@/lib/creative/receipt");
    const onFailure = vi.fn();
    await generateVariants({ brand, brief: "x", count: 1, onFailure });
    const events = failedVariantUsage(onFailure.mock.calls[0][1], { businessId: "business", userId: "user", route: "creatives.generate", requestId: "request" });
    expect(events).toMatchObject([{ usageKind: "image", status: "error", providerRequestId: "image-failed-123", providerFinalStatus: "unknown" }]);
  });

  it.each([false, true])("retains truncated usage once in failure receipts (prior repair: %s)", async (priorRepair) => {
    const usage = { promptTokens: 8, completionTokens: 2, totalTokens: 17 };
    const earlierUsage = { promptTokens: 3, completionTokens: 2, totalTokens: 5 };
    if (priorRepair) complete.mockResolvedValueOnce({ ...completion({}), usage: earlierUsage });
    complete.mockRejectedValueOnce(new LLMError("Output token budget exhausted", {
      provider: "google", model: "gemini-3.6-flash", usage, retryable: false,
    }));
    const { generateVariants } = await import("@/lib/creative/generate");
    const { failedVariantUsage } = await import("@/lib/creative/receipt");
    const onFailure = vi.fn();
    expect(await generateVariants({ brand, brief: "x", count: 1, onFailure })).toEqual([]);
    expect(onFailure).toHaveBeenCalledTimes(1);
    const events = failedVariantUsage(onFailure.mock.calls[0][1], {
      businessId: "business", userId: "user", route: "creatives.generate", requestId: "request",
    });
    expect(events.map((event) => event.usage)).toEqual(priorRepair ? [earlierUsage, usage] : [usage]);
    expect(events.at(-1)).toMatchObject({ provider: "google", model: "gemini-3.6-flash", status: "error", attempt: priorRepair ? 2 : 1, metadata: { validationStage: "provider", validationRules: ["other"] } });
    expect(complete).toHaveBeenCalledTimes(priorRepair ? 2 : 1);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("records only allowlisted concept failure categories alongside paid usage", async () => {
    const { CreativeValidationError } = await import("@/lib/creative/generate");
    const { failedVariantUsage } = await import("@/lib/creative/receipt");
    const error = new CreativeValidationError([
      "sourceQuotes: quote not present in supplied facts: private customer text",
      "unsupported-commercial-claim: free; remove it or cite a supplied positive fact supporting it",
    ], [{ provider: "test", model: "model", usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 } }]);
    const events = failedVariantUsage(error, {
      businessId: "business", userId: "user", route: "creatives.generate", requestId: "request",
    });
    expect(events).toMatchObject([{ errorCode: "CreativeValidationError", metadata: {
      validationStage: "concept",
      validationRules: ["sourceQuotes", "unsupported-commercial-claim"],
    } }]);
    expect(JSON.stringify(events)).not.toContain("private customer text");
  });

  it("records the rejected concept rule even when repair saves the variant", async () => {
    const usage = { promptTokens: 8, completionTokens: 2, totalTokens: 10 };
    complete.mockResolvedValueOnce({ ...completion({ ...concept, sourceQuotes: ["private customer text"] }), usage })
      .mockResolvedValueOnce({ ...completion(concept), usage });
    const { generateVariants } = await import("@/lib/creative/generate");
    const { variantUsageEvents } = await import("@/lib/creative/receipt");
    const [variant] = await generateVariants({ brand, brief: "x", count: 1 });
    const events = variantUsageEvents(variant, {
      businessId: "business", userId: "user", route: "creatives.generate", requestId: "request",
    });
    expect(events[0]).toMatchObject({ status: "success", metadata: {
      validationStage: "concept", validationRules: ["sourceQuotes"],
    } });
    expect(events[1].metadata).toEqual({ angle: variant.angleId });
    expect(JSON.stringify(events)).not.toContain("private customer text");
  });

  it("keeps both rejected concept categories on their own failed-variant attempts", async () => {
    const usage = { promptTokens: 8, completionTokens: 2, totalTokens: 10 };
    complete.mockResolvedValueOnce({ ...completion({ ...concept, cta: "" }), usage })
      .mockResolvedValueOnce({ ...completion({ ...concept, sourceQuotes: ["private customer text"] }), usage });
    const { generateVariants } = await import("@/lib/creative/generate");
    const { failedVariantUsage } = await import("@/lib/creative/receipt");
    const onFailure = vi.fn();
    expect(await generateVariants({ brand, brief: "x", count: 1, onFailure })).toEqual([]);
    const events = failedVariantUsage(onFailure.mock.calls[0][1], {
      businessId: "business", userId: "user", route: "creatives.generate", requestId: "request",
    });
    expect(events.map((event) => event.metadata)).toEqual([
      { validationStage: "concept", validationRules: ["schema-or-other"] },
      { validationStage: "concept", validationRules: ["sourceQuotes"] },
    ]);
    expect(JSON.stringify(events)).not.toContain("private customer text");
  });

  it("does not attribute a missing second usage record to the first rejection", async () => {
    const usage = { promptTokens: 8, completionTokens: 2, totalTokens: 10 };
    complete.mockResolvedValueOnce({ ...completion({ ...concept, cta: "" }), usage })
      .mockResolvedValueOnce(completion({ ...concept, sourceQuotes: ["private customer text"] }));
    const { generateVariants } = await import("@/lib/creative/generate");
    const { failedVariantUsage } = await import("@/lib/creative/receipt");
    const onFailure = vi.fn();
    await generateVariants({ brand, brief: "x", count: 1, onFailure });
    const events = failedVariantUsage(onFailure.mock.calls[0][1], {
      businessId: "business", userId: "user", route: "creatives.generate", requestId: "request",
    });
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toEqual({ validationStage: "concept", validationRules: ["schema-or-other"] });
  });

  it("repairs repeated copy using history and earlier siblings before image generation", async () => {
    const fresh = { ...concept, headline: "A useful rooftop", primary_text: "Start with a conversation about your roof." };
    complete.mockResolvedValueOnce(completion(concept))
      .mockResolvedValueOnce(completion(fresh))
      .mockResolvedValueOnce(completion({ ...fresh, headline: "Explore rooftop solar", primary_text: "Find out what fits your home." }));
    const { generateVariants } = await import("@/lib/creative/generate");
    const variants = await generateVariants({ brand, brief: "x", count: 2, recentCopy: [concept] });
    expect(variants).toHaveLength(2);
    expect(complete.mock.calls[1][0].at(-1).content).toContain("repeated-headline");
    expect(JSON.parse(complete.mock.calls[2][0][1].content).recentCopy[0].headline).toBe(fresh.headline);
    expect(generateImage).toHaveBeenCalledTimes(2);
  });

  it("preserves each completed variant when a sibling fails", async () => {
    generateImage.mockRejectedValueOnce(new Error("Image unavailable"));
    const onVariant = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn().mockResolvedValue(undefined);
    const { generateVariants } = await import("@/lib/creative/generate");
    const variants = await generateVariants({ brand, brief: "x", count: 3, onVariant, onFailure });
    expect(variants).toHaveLength(2);
    expect(onVariant).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("produces one variant per angle and trims the copy", async () => {
    const { generateVariants } = await import("@/lib/creative/generate");
    const variants = await generateVariants({ brand, brief: "monsoon offer", count: 2 });

    expect(variants).toHaveLength(2);
    expect(variants[0]).toMatchObject({
      headline: "Cut your power bill",
      primaryText: "Two lines of copy.",
      cta: "Get Quote",
      imageUrl: "https://img.example/a.jpg",
    });
    expect(variants[0].angleId).not.toBe(variants[1].angleId);
  });

  it("clamps a silly count to at least one angle", async () => {
    const { generateVariants } = await import("@/lib/creative/generate");
    const variants = await generateVariants({ brand, brief: "x", count: 0 });
    expect(variants).toHaveLength(1);
  });

  it("never asks the paid providers for more than the angles we have", async () => {
    const { AD_ANGLES } = await import("@/lib/templates/ads");
    const { generateVariants } = await import("@/lib/creative/generate");
    const variants = await generateVariants({ brand, brief: "x", count: 999 });
    expect(variants).toHaveLength(AD_ANGLES.length);
    expect(complete).toHaveBeenCalledTimes(AD_ANGLES.length);
  });

  it("honours explicitly requested angles and ignores unknown ids", async () => {
    const { AD_ANGLES } = await import("@/lib/templates/ads");
    const { generateVariants } = await import("@/lib/creative/generate");
    const wanted = AD_ANGLES[1].id;
    const variants = await generateVariants({
      brand,
      brief: "x",
      angleIds: ["not-an-angle", wanted],
      count: 5,
    });
    expect(variants).toHaveLength(1);
    expect(variants[0].angleId).toBe(wanted);
  });

  it("repairs an invalid CTA with explicit feedback before generating an image", async () => {
    complete.mockResolvedValueOnce(completion({ ...concept, cta: "" }));
    const { generateVariants } = await import("@/lib/creative/generate");
    const [variant] = await generateVariants({ brand, brief: "x", count: 1 });
    expect(variant.cta).toBe("Get Quote");
    expect(complete.mock.calls[1][0].at(-1).content).toContain("cta");
    expect(generateImage).toHaveBeenCalledTimes(1);
  });

  it("repairs a failed concept without resending its rejected draft", async () => {
    const rejected = { ...concept, cta: "", primary_text: "Invented model-only details" };
    complete.mockResolvedValueOnce(completion(rejected)).mockImplementationOnce(async (messages) => {
      if (messages.some((message: { role: string }) => message.role === "assistant")) throw new Error("Repair context overflow");
      return completion(concept);
    });
    const { generateVariants } = await import("@/lib/creative/generate");
    const onFailure = vi.fn();
    const variants = await generateVariants({ brand, brief: "x", count: 1, onFailure });
    expect(variants).toHaveLength(1);
    expect(onFailure).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][0]).toHaveLength(3);
    expect(complete.mock.calls[1][0].at(-1).content).toContain("cta");
    expect(JSON.stringify(complete.mock.calls[1][0])).not.toContain("Invented model-only details");
    expect(generateImage).toHaveBeenCalledTimes(1);
  });

  it("uses one concept call per successful variant and executes its visual direction", async () => {
    const { generateVariants } = await import("@/lib/creative/generate");
    await generateVariants({ brand, brief: "x", count: 3 });
    expect(complete).toHaveBeenCalledTimes(3);
    expect(generateImage).toHaveBeenCalledTimes(3);
    expect(generateImage.mock.calls[0][0].prompt).toContain(concept.visual.direction);
  });

  it("carries bounded advisory style through concept and image generation", async () => {
    const { generateVariants, generateOneVariant } = await import("@/lib/creative/generate");
    const advisoryPreferences = `PAST DECLARED PREFERENCES: tone: warm ${"x".repeat(2000)}`;
    generateImage.mockImplementationOnce(async ({ prompt }) => ({ url: "https://img.example/a.jpg", prompt }));
    const [variant] = await generateVariants({ brand, brief: "Use clear copy", count: 1, advisoryPreferences });
    const context = JSON.parse(complete.mock.calls[0][0][1].content);
    expect(context.advisoryPreferences).toContain("tone: warm");
    expect(context.advisoryPreferences.length).toBeLessThanOrEqual(1200);
    expect(generateImage.mock.calls[0][0].prompt).toContain("tone: warm");
    expect(variant.imagePrompt).not.toContain("tone: warm");
    expect(variant.imagePrompt).toContain("Image prompt omitted");
    const { generationReceipt } = await import("@/lib/creative/receipt");
    expect(JSON.stringify(generationReceipt(variant))).not.toContain("tone: warm");
    vi.clearAllMocks();
    generateImage.mockImplementationOnce(async ({ prompt }) => ({ url: "https://img.example/a.jpg", prompt }));
    const regenerated = await generateOneVariant(brand, "Use clear copy", (await import("@/lib/templates/ads")).AD_ANGLES[0], undefined, undefined, undefined, undefined, undefined, [], advisoryPreferences);
    expect(JSON.parse(complete.mock.calls[0][0][1].content).advisoryPreferences).toContain("tone: warm");
    expect(generateImage.mock.calls[0][0].prompt).toContain("tone: warm");
    expect(JSON.stringify(generationReceipt(regenerated))).not.toContain("tone: warm");
  });

  it("omits the provider image prompt when the concept echoes an advisory style", async () => {
    const advisoryPhrase = "verdant-ochre palette";
    const advisoryPreferences = `PAST DECLARED PREFERENCES: visual_style: ${advisoryPhrase}`;
    complete.mockResolvedValueOnce(completion({
      ...concept,
      visual: { ...concept.visual, direction: `A rooftop array on a home with a ${advisoryPhrase}, leaving open space above.` },
    }));
    generateImage.mockImplementationOnce(async ({ prompt }) => ({ url: "https://img.example/a.jpg", prompt }));
    const { generateVariants } = await import("@/lib/creative/generate");
    const [variant] = await generateVariants({ brand, brief: "Show the rooftop", count: 1, advisoryPreferences });
    expect(generateImage.mock.calls[0][0].prompt).toContain(advisoryPhrase);
    expect(variant.concept.visual.direction).toContain(advisoryPhrase);
    expect(variant.imagePrompt).not.toContain(advisoryPhrase);
    expect(variant.imagePrompt).toContain("Image prompt omitted");
  });

  it("requires explicit user facts to ground claims in a model-derived brief", async () => {
    const claim = { ...concept, headline: "Award-winning installers", primary_text: "Meet our award-winning installers.", sourceQuotes: ["award-winning installers"] };
    complete.mockResolvedValue(completion(claim));
    const { generateVariants } = await import("@/lib/creative/generate");
    const onFailure = vi.fn();
    expect(await generateVariants({ brand, brief: "Feature our award-winning installers", count: 1, onFailure })).toEqual([]);
    expect(onFailure.mock.calls[0][1].issues).toEqual(expect.arrayContaining([expect.stringContaining("sourceQuotes:")]));
    expect(generateImage).not.toHaveBeenCalled();
    const variants = await generateVariants({ brand, brief: "Feature our award-winning installers", count: 1, sourceFacts: ["Our award-winning installers"] });
    expect(variants).toHaveLength(1);
    expect(JSON.parse(complete.mock.calls.at(-1)![0][1].content).sourceFacts).toEqual(["Our award-winning installers"]);
  });

  it("never spends on images after two invalid concepts", async () => {
    const usage = { promptTokens: 8, completionTokens: 2, totalTokens: 10 };
    complete.mockResolvedValue({ ...completion({ ...concept, headline: 12 }), usage });
    const { generateVariants } = await import("@/lib/creative/generate");
    const { failedVariantUsage } = await import("@/lib/creative/receipt");
    const onFailure = vi.fn();
    expect(await generateVariants({ brand, brief: "x", count: 1, onFailure })).toEqual([]);
    const events = failedVariantUsage(onFailure.mock.calls[0][1], {
      businessId: "business", userId: "user", route: "creatives.generate", requestId: "request",
    });
    expect(events).toMatchObject([
      { usage, attempt: 1, metadata: { validationStage: "concept", validationRules: ["schema-or-other"] } },
      { usage, attempt: 2, metadata: { validationStage: "concept", validationRules: ["schema-or-other"] } },
    ]);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("categorizes invalid JSON without persisting provider output", async () => {
    complete.mockResolvedValue({ ...completion({}), text: "private malformed response", usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 } });
    const { generateVariants } = await import("@/lib/creative/generate");
    const { failedVariantUsage } = await import("@/lib/creative/receipt");
    const onFailure = vi.fn();
    expect(await generateVariants({ brand, brief: "x", count: 1, onFailure })).toEqual([]);
    const events = failedVariantUsage(onFailure.mock.calls[0][1], {
      businessId: "business", userId: "user", route: "creatives.generate", requestId: "request",
    });
    expect(events).toMatchObject([
      { attempt: 1, metadata: { validationStage: "parse", validationRules: ["invalid-json"] } },
      { metadata: { validationStage: "parse", validationRules: ["invalid-json"] } },
    ]);
    expect(JSON.stringify(events)).not.toContain("private malformed response");
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("repairs broken JSON and preserves exact copy and chosen layout", async () => {
    complete.mockResolvedValueOnce({ text: "not json" });
    const { generateVariants } = await import("@/lib/creative/generate");
    const [variant] = await generateVariants({ brand, brief: "x", count: 1 });
    expect(variant.design.headline).toBe(variant.headline);
    expect(variant.design.layout).toBe("top");
    expect(variant.design.benefits).toEqual([]);
    expect(variant.design.subhead).toBeNull();
  });
});

describe("persistCreativeImage", () => {
  const storage = (uploadResult: { error: unknown }) => ({
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue(uploadResult),
        getPublicUrl: () => ({
          data: { publicUrl: "https://cdn.example/stored.jpg" },
        }),
      }),
    },
  });

  it("stores the image and returns the permanent URL", async () => {
    downloadImage.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg",
    });
    const { persistCreativeImage } = await import("@/lib/creative/persist");
    const url = await persistCreativeImage(
      storage({ error: null }) as never,
      "b1",
      "grp",
      "value",
      "https://src.example/a.jpg",
    );
    expect(url).toBe("https://cdn.example/stored.jpg");
  });

  it("stores a smaller public thumbnail beside the original without changing export bytes", async () => {
    const original = readFileSync("public/solar-example.jpg");
    const upload = vi.fn().mockResolvedValue({ error: null });
    const client = { storage: { from: () => ({ upload, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/storage/v1/object/public/creatives/${path}` } }) }) } };
    const { persistCreativeImageBytes } = await import("@/lib/creative/persist");
    const url = await persistCreativeImageBytes(client as never, "b1", "grp", "value", original, "image/jpeg");

    expect(url).toMatch(/\/creatives\/b1\/grp\/originals-v1\/value-.*\.jpg$/);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[0][0]).toMatch(/\/thumbnails-v1\/value-.*\.webp$/);
    expect(upload.mock.calls[0][1].length).toBeLessThan(original.length);
    expect(upload.mock.calls[1][1]).toEqual(original);
  });

  it("keeps the original available when a thumbnail upload is rejected", async () => {
    const upload = vi.fn()
      .mockResolvedValueOnce({ error: new Error("preview unavailable") })
      .mockResolvedValueOnce({ error: null });
    const client = { storage: { from: () => ({ upload, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/storage/v1/object/public/creatives/${path}` } }) }) } };
    const { persistCreativeImageBytes } = await import("@/lib/creative/persist");
    const url = await persistCreativeImageBytes(client as never, "b1", "grp", "value", readFileSync("public/solar-example.jpg"), "image/jpeg");

    expect(url).not.toContain("originals-v1");
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1][1]).toEqual(readFileSync("public/solar-example.jpg"));
  });

  it("removes the derivative when saving the original fails", async () => {
    const upload = vi.fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: new Error("original unavailable") });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const client = { storage: { from: () => ({ upload, remove }) } };
    const { persistCreativeImageBytes } = await import("@/lib/creative/persist");

    await expect(persistCreativeImageBytes(client as never, "b1", "grp", "value", readFileSync("public/solar-example.jpg"), "image/jpeg"))
      .rejects.toThrow("Could not store the generated image");
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]]);
  });

  it("composes from the available image without downloading the newly uploaded photo", async () => {
    const { renderAndPersistDesign } = await import("@/lib/creative/persist");
    const source = "data:image/png;base64,AQID";
    await renderAndPersistDesign(storage({ error: null }) as never, "b1", "grp", "value", {} as never, "https://cdn.example/photo.png", source);
    expect(renderCompositeAd).toHaveBeenCalledWith({ backgroundUrl: source });
    expect(downloadImage).not.toHaveBeenCalled();
  });

  it("uses the saved photo for URL-based generators instead of requesting generation again", async () => {
    const { renderAndPersistDesign } = await import("@/lib/creative/persist");
    await renderAndPersistDesign(storage({ error: null }) as never, "b1", "grp", "value", {} as never, "https://cdn.example/photo.png", "https://generator.example/image");
    expect(renderCompositeAd).toHaveBeenCalledWith({ backgroundUrl: "https://cdn.example/photo.png" });
  });

  it("reports failed uploads instead of returning an unpersisted URL", async () => {
    downloadImage.mockResolvedValue({
      bytes: new Uint8Array([1]),
      contentType: "image/png",
    });
    const { persistCreativeImage } = await import("@/lib/creative/persist");
    await expect(persistCreativeImage(
      storage({ error: { message: "no bucket" } }) as never,
      "b1",
      "grp",
      "value",
      "https://src.example/a.jpg",
    )).rejects.toThrow("Could not store");
  });

  it("reports failed downloads instead of saving a broken creative", async () => {
    downloadImage.mockRejectedValue(new Error("404"));
    const { persistCreativeImage } = await import("@/lib/creative/persist");
    await expect(persistCreativeImage(
      storage({ error: null }) as never,
      "b1",
      "grp",
      "value",
      "https://src.example/a.jpg",
    )).rejects.toThrow("404");
  });
});

describe("useMounted", () => {
  function Probe() {
    return <span data-testid="state">{useMounted() ? "client" : "server"}</span>;
  }

  it("renders the server state during SSR so hydration matches", () => {
    // The server snapshot must be false, otherwise the first client render
    // differs from the HTML and React re-renders (the flicker bug).
    expect(renderToString(<Probe />)).toContain("server");
  });

  it("reports mounted after hydration on the client", () => {
    render(<Probe />);
    expect(screen.getByTestId("state")).toHaveTextContent("client");
  });
});
