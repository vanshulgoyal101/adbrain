import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import run4 from "./fixtures/create/cedar-ridge-run4.json";
import haiku from "./fixtures/create/cedar-ridge-haiku.json";
import { openAIReply, requestBody, requestUrl } from "./replay";

// Create's OpenRouter model (#98): three real Claude Haiku 5.5 replies recorded through the
// production route. Text calls, parsing and validation are real; only the network and images are replaced.
vi.mock("@/lib/imageGen", () => ({
  generateImage: async (req: { prompt: string; width: number; height: number }) => ({
    url: "https://core-test.supabase.co/storage/v1/object/public/creatives/haiku.webp",
    provider: "openrouter", model: "openai/gpt-image-2.5-flare", prompt: req.prompt, width: req.width, height: req.height,
  }),
}));

beforeEach(() => {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    OPENROUTER_API_KEYS: "core-openrouter",
    GOOGLE_AI_API_KEYS: "core-google",
    GROQ_API_KEYS: "core-groq",
    CEREBRAS_API_KEYS: "",
    LLM_PROVIDER_ORDER: "openrouter,google,groq",
    CREATIVE_PROVIDER_ORDER: undefined,
    OPENROUTER_MODEL: undefined,
  })) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("core: Create on recorded Claude Haiku 5.5 concepts", () => {
  it("saves 3/3 on the default OpenRouter model, including a fenced JSON reply", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(requestUrl(input)).toBe("https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(requestBody(init));
      bodies.push(body);
      const reply = haiku.responses.find(({ angleName }) => body.messages[1].content.includes(angleName));
      if (!reply) throw new Error("Concept request did not name a recorded angle.");
      return openAIReply(reply.content, haiku.model, reply.usage);
    }));
    const { generateVariants } = await import("@/lib/creative/generate");
    const variants = await generateVariants({ brand: run4.brand, brief: run4.brief, count: 3 });

    expect(haiku.responses[0].content.startsWith("```json")).toBe(true);
    expect(variants.map(({ angleName }) => angleName)).toEqual(haiku.responses.map(({ angleName }) => angleName));
    expect(new Set(variants.map(({ headline }) => headline)).size).toBe(3);
    expect(bodies).toHaveLength(3);
    for (const body of bodies) {
      expect(body).toMatchObject({ model: "anthropic/claude-haiku-5.5", reasoning: { effort: "medium", exclude: true } });
    }
    for (const variant of variants) {
      expect(variant.llmUsage).toEqual([expect.objectContaining({ provider: "openrouter", model: "anthropic/claude-haiku-5.5", status: "success" })]);
    }
    // Recorded latencies leave most of the 270 s route deadline for images and repairs.
    expect(haiku.responses.reduce((sum, { latencyMs }) => sum + latencyMs, 0)).toBeLessThan(60_000);
  });

  it("clips Haiku's over-long visual.medium label instead of discarding the concept", async () => {
    const { parseJSON } = await import("@/lib/llm");
    const { validateConcept } = await import("@/lib/creative/concept");
    const { AD_ANGLES } = await import("@/lib/templates/ads");
    const angle = AD_ANGLES.find(({ name }) => name === haiku.mediumOverrun.angleName)!;
    type Concept = { visual: Record<string, unknown> & { medium: string } };
    const overrun = parseJSON<Concept>(haiku.mediumOverrun.content);
    const medium = overrun.visual.medium;
    expect(medium.length).toBeGreaterThan(120);
    const input = { brand: run4.brand, brief: run4.brief, angle };

    // The recorded reply no longer fails on the label, and "text-free" in its rationale is not a free offer.
    expect(validateConcept(overrun, input)).toMatchObject({ success: true });
    // A real free claim in the same reply still needs a supplied fact.
    const rationale = (overrun as unknown as { rationale: string }).rationale;
    expect(rationale).toContain("text-free graphic art");
    expect(validateConcept({ ...overrun, rationale: rationale.replace("text-free graphic art", "free graphic art") }, input)).toEqual({
      success: false,
      issues: [expect.stringMatching(/^unsupported-commercial-claim: free/)],
    });

    // The saved Haiku offer concept with the same 134-character label now saves, label clipped at a word.
    const offer = haiku.responses.find(({ angleName }) => angleName === angle.name)!;
    const clean = parseJSON<Concept>(offer.content);
    const result = validateConcept({ ...clean, visual: { ...clean.visual, medium } }, input);
    expect(result.success, JSON.stringify(result)).toBe(true);
    if (result.success) {
      expect(result.concept.visual.medium.length).toBeLessThanOrEqual(120);
      expect(medium.startsWith(result.concept.visual.medium)).toBe(true);
      expect(medium[result.concept.visual.medium.length]).toMatch(/\s/);
    }
  });
});
