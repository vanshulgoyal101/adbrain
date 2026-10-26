import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import run4 from "./fixtures/create/cedar-ridge-run4.json";
import haiku from "./fixtures/create/cedar-ridge-haiku.json";
import { openAIReply, requestBody, requestUrl, settleInVirtualTime, useVirtualDeadlines, wait } from "./replay";

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
    const events: { angleName: string; stage: string; at: number }[] = [];
    const saved: string[] = [];
    const variants = await generateVariants({
      brand: run4.brand, brief: run4.brief, count: 3,
      onVariant: async ({ angleName }) => { saved.push(angleName); },
      onProgress: (event) => {
        events.push(event);
        throw new Error("A broken progress listener must not fail generation.");
      },
    });

    // #141 live progress: every angle reports real stages in order, and "ready" only after its save.
    for (const { angleName } of haiku.responses) {
      expect(events.filter((event) => event.angleName === angleName).map(({ stage }) => stage))
        .toEqual(["queued", "writing", "checking", "image", "ready"]);
    }
    expect(events.slice(0, 3).map(({ stage }) => stage)).toEqual(["queued", "queued", "queued"]);
    expect(events.filter(({ stage }) => stage === "ready").map(({ angleName }) => angleName)).toEqual(saved);
    expect(events.every(({ at }, index) => index === 0 || at >= events[index - 1].at)).toBe(true);
    expect(haiku.responses.some(({ content }) => content.startsWith("```json"))).toBe(true);
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

  it("reports fixing on a repair and failed when the repair is also rejected", async () => {
    const offer = haiku.responses.find(({ angleName }) => angleName === "Special offer / incentive")!;
    // A reply cut off mid-JSON, as when a model hits max_tokens.
    const truncated = offer.content.slice(0, Math.floor(offer.content.length / 2));
    let repairFails = false;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(requestBody(init));
      const repair = body.messages.length > 2;
      const reply = haiku.responses.find(({ angleName }) => body.messages[1].content.includes(angleName))!;
      const content = reply === offer && (!repair || repairFails) ? truncated : reply.content;
      return openAIReply(content, haiku.model, reply.usage);
    }));
    const { generateVariants } = await import("@/lib/creative/generate");
    const stagesFor = async () => {
      const events: string[] = [];
      const failures: string[] = [];
      const variants = await generateVariants({
        brand: run4.brand, brief: run4.brief, count: 3,
        onProgress: ({ angleName, stage }) => { if (angleName === offer.angleName) events.push(stage); },
        onFailure: async ({ name }) => { failures.push(name); },
      });
      return { events, failures, saved: variants.length };
    };

    expect(await stagesFor()).toEqual({
      events: ["queued", "writing", "checking", "fixing", "checking", "image", "ready"], failures: [], saved: 3,
    });
    repairFails = true;
    expect(await stagesFor()).toEqual({
      events: ["queued", "writing", "checking", "fixing", "checking", "failed"], failures: [offer.angleName], saved: 2,
    });
  });

  it("parallel schedule (#142): starts all three concepts at once on recorded latencies and still saves 3/3", async () => {
    vi.stubEnv("CREATIVE_CONCEPT_SCHEDULE", "parallel");
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(requestBody(init));
      const reply = haiku.responses.find(({ angleName }) => body.messages[1].content.includes(angleName))!;
      peak = Math.max(peak, ++inFlight);
      await wait(reply.latencyMs);
      inFlight--;
      return openAIReply(reply.content, haiku.model, reply.usage);
    }));
    const { generateVariants } = await import("@/lib/creative/generate");
    // Recorded Haiku latencies on a virtual clock, so a busy machine cannot skew the timing.
    const { startedAt } = useVirtualDeadlines();
    const variants = await settleInVirtualTime(generateVariants({ brand: run4.brand, brief: run4.brief, count: 3 }));
    const wallMs = Date.now() - startedAt;
    vi.useRealTimers();

    expect(peak).toBe(3);
    expect(variants.map(({ angleName }) => angleName)).toEqual(haiku.responses.map(({ angleName }) => angleName));
    expect(new Set(variants.map(({ headline }) => headline)).size).toBe(3);
    const latencies = haiku.responses.map(({ latencyMs }) => latencyMs);
    // Concept time is the slowest call, not the sum of all three.
    expect(wallMs).toBeLessThan(Math.max(...latencies) + latencies.reduce((a, b) => a + b, 0) / 3);
  });

  it("parallel schedule (#142): a concept that repeats an earlier concurrent headline is repaired against it", async () => {
    vi.stubEnv("CREATIVE_CONCEPT_SCHEDULE", "parallel");
    const [first, second] = haiku.responses;
    const repairPrompts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(requestBody(init));
      const reply = haiku.responses.find(({ angleName }) => body.messages[1].content.includes(angleName))!;
      const repair = body.messages.length > 2;
      if (repair) repairPrompts.push(body.messages[1].content);
      // The second angle's first reply copies the first angle's concept.
      const content = reply === second && !repair ? first.content : reply.content;
      return openAIReply(content, haiku.model, reply.usage);
    }));
    const { generateVariants } = await import("@/lib/creative/generate");
    const variants = await generateVariants({ brand: run4.brand, brief: run4.brief, count: 3 });
    const { parseJSON } = await import("@/lib/llm");
    const firstHeadline = parseJSON<{ headline: string }>(first.content).headline;

    expect(variants).toHaveLength(3);
    expect(new Set(variants.map(({ headline }) => headline)).size).toBe(3);
    expect(repairPrompts).toHaveLength(1);
    expect(repairPrompts[0]).toContain(firstHeadline);
    expect(variants[1].llmUsage.map(({ validation }) => validation?.rules)).toEqual([["repeated-headline", "repeated-opening"], undefined]);
  });

  it("does not read repeated prices like '$49,' as all-caps shouting (#98 run 9)", async () => {
    const { parseJSON } = await import("@/lib/llm");
    const { validateConcept } = await import("@/lib/creative/concept");
    const { scanAdCopy } = await import("@/lib/creative/slopScan");
    const { AD_ANGLES } = await import("@/lib/templates/ads");
    const angle = AD_ANGLES.find(({ name }) => name === haiku.priceToken.angleName)!;
    const reply = parseJSON<{ primary_text: string; supportingText: string }>(haiku.priceToken.content);
    expect(reply.primary_text).toContain("$49,");
    // The recorded reply with its price stated a second time, as Haiku's value ads often do.
    const repeated = { ...reply, supportingText: `${reply.supportingText}, $49.` };
    expect(validateConcept(repeated, { brand: run4.brand, brief: run4.brief, angle })).toMatchObject({ success: true });
    // Real shouting is still rejected.
    expect(scanAdCopy("BOOK YOUR $49, VISIT TODAY").map(({ rule }) => rule)).toContain("all-caps");
    expect(scanAdCopy("Visits from $49, $49.00 in 2026").map(({ rule }) => rule)).not.toContain("all-caps");
  });

  // #687 item 3: Create refused any quote with a negation anywhere ("…, no referral needed"), so a real
  // offer fact was read as an unsupported claim and the ad cost a full rewrite. Only a negation or
  // withdrawal of the term itself refuses it, as in the Assistant (#613, shared claim-support.ts).
  it("supports an offer whose fact has an unrelated negation, and still refuses a negated or withdrawn one", async () => {
    const { parseJSON } = await import("@/lib/llm");
    const { validateConcept } = await import("@/lib/creative/concept");
    const { AD_ANGLES } = await import("@/lib/templates/ads");
    const recorded = haiku.responses[0];
    const angle = AD_ANGLES.find(({ name }) => name === recorded.angleName)!;
    const reply = parseJSON<{ sourceQuotes: string[]; headline: string }>(recorded.content);
    expect(reply.headline).toContain("$49");
    const withFact = (offer: string) => ({ brand: { ...run4.brand, offers: [offer] }, brief: run4.brief, angle });
    // The copy states $49 with no quote for it, so the validator cites the one fact that has it.
    const uncited = { ...reply, sourceQuotes: reply.sourceQuotes.filter((quote) => !quote.includes("$49")) };

    expect(validateConcept(uncited, withFact("$49 new-patient exam and consultation, no referral needed"))).toMatchObject({ success: true });
    expect(validateConcept(uncited, withFact("$49 new-patient exam no longer offered"))).toMatchObject({
      success: false, claims: ["claim:currency:negated-quote"],
    });
    expect(validateConcept({ ...reply, sourceQuotes: [...uncited.sourceQuotes, "Not $49 any more"] }, withFact("Not $49 any more"))).toMatchObject({
      success: false, claims: ["claim:currency:negated-quote"],
    });
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
      claims: ["claim:free:uncited"],
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

  describe("hook and offer above Meta's 125-character mobile fold (#194)", () => {
    const fold = 125;
    const firstOffer = (text: string) => text.search(/[$\u20b9]\s*\d/);

    it("saves the recorded #194-prompt replies as short lines with the hook and offer in the first line", async () => {
      vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(requestBody(init));
        const reply = haiku.responses.find(({ angleName }) => body.messages[1].content.includes(angleName))!;
        expect(body.messages).toHaveLength(2);
        return openAIReply(reply.content, haiku.model, reply.usage);
      }));
      const { generateVariants } = await import("@/lib/creative/generate");
      const variants = await generateVariants({ brand: run4.brand, brief: run4.brief, count: 3 });
      expect(variants).toHaveLength(3);
      for (const { primaryText } of variants) {
        const lines = primaryText.split("\n");
        expect(lines.length, primaryText).toBeGreaterThanOrEqual(2);
        expect(lines[0].length, primaryText).toBeLessThanOrEqual(fold);
        expect(firstOffer(primaryText), primaryText).toBeGreaterThanOrEqual(0);
        expect(firstOffer(primaryText), primaryText).toBeLessThan(lines[0].length);
      }
    });

    it("splits Haiku's recorded one-paragraph replies into sentence lines and repairs the one with its offer below the fold", async () => {
      const { parseJSON } = await import("@/lib/llm");
      const { validateConcept, conceptValidationRules } = await import("@/lib/creative/concept");
      const { AD_ANGLES } = await import("@/lib/templates/ads");
      const outcomes = haiku.paragraphResponses.responses.map(({ angleName, content }) => {
        const angle = AD_ANGLES.find(({ name }) => name === angleName)!;
        const draft = parseJSON<{ primary_text: string }>(content);
        expect(draft.primary_text).not.toContain("\n");
        expect(draft.primary_text.length).toBeGreaterThan(fold);
        const result = validateConcept(draft, { brand: run4.brand, brief: run4.brief, angle });
        return { angleName, offerAt: firstOffer(draft.primary_text), draft, result };
      });
      for (const { offerAt, draft, result } of outcomes) {
        if (offerAt < fold) {
          expect(result.success).toBe(true);
          if (!result.success) continue;
          const lines = result.concept.primary_text.split("\n");
          expect(lines.length).toBeGreaterThanOrEqual(2);
          expect(lines[0].length).toBeLessThanOrEqual(fold);
          expect(lines.join(" ")).toBe(draft.primary_text);
        } else {
          expect(result.success ? [] : conceptValidationRules(result.issues)).toEqual(["offer-below-fold"]);
        }
      }
      expect(outcomes.filter(({ offerAt }) => offerAt >= fold).map(({ angleName }) => angleName)).toEqual(["Solve a pain point"]);
    });
  });
});
