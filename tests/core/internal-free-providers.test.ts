import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/create/cedar-ridge-concept.json";
import { googleReply, openAIReply, requestUrl, settleInVirtualTime, useVirtualDeadlines } from "./replay";

// #449/#466 (CTO): the OpenRouter key is shared and nearly spent. Internal (team, owner, test)
// accounts write on Haiku like customers (about $0.006 a Create; the free text tiers allow 20
// requests a day) but make free Pollinations images, one at a time, waiting out its Retry-After.
// The router, AI SDK providers and image code are real; the network is replaced. The concept is the
// recorded Cedar Ridge reply; the 402 is Pollinations' recorded answer past its free rate (Oct 24).

const INTERNAL = { id: "6c1f4f0e-5a43-4c55-9b1f-3f7a3f0c2a10", email: "qa@adbrain.vanshul.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
// CTO (#466): the App Review reviewer and the owner keep the paid models; listed by user id.
const REVIEWER = { id: "0dc149e7-2b7a-459c-82e5-04aa9915e342", email: "reviewer@adbrain.vanshul.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
const OWNER = { id: "da0771ca-c07f-4e86-b6da-023aaf517d74", email: null, email_confirmed_at: null };
const CUSTOMER = { id: "7d2a5b1f-6b54-4d66-8c2a-4a8b4a1d3b21", email: "owner@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
let png: Buffer;
// The timing cases run on a virtual clock, which cannot wait for sharp's thread pool (as in create-route).
vi.mock("@/lib/imageGen/raster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/imageGen/raster")>();
  const isPng = (bytes: Uint8Array) => bytes[0] === 0x89 && bytes[1] === 0x50;
  return { ...actual, validateRaster: async (bytes: Uint8Array) => (isPng(bytes)
    ? { bytes, contentType: "image/png", width: 1024, height: 1536 } : actual.validateRaster(bytes)) };
});

beforeEach(async () => {
  vi.resetModules();
  png ??= await sharp({ create: { width: 1024, height: 1536, channels: 3, background: "#d9e3dc" } }).png().toBuffer();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    OPENROUTER_API_KEYS: "core-openrouter",
    OPENROUTER_MODEL: "anthropic/claude-haiku-5.5",
    GOOGLE_AI_API_KEYS: "core-google",
    GEMINI_MODEL: "gemini-3.6-flash",
    GROQ_API_KEYS: "core-groq",
    // Production today: Create text and images on the paid key.
    CREATIVE_PROVIDER_ORDER: "openrouter",
    LLM_BUDGET_PROVIDER_ORDER: "groq,google,openrouter",
    IMAGE_PROVIDER: "openrouter",
    IMAGE_PROVIDER_FALLBACK: "none",
  })) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

type Pollinations = (index: number) => Response | undefined;
const PAYMENT_REQUIRED = () => Response.json({ error: "Payment required" }, { status: 402, headers: { "retry-after": "8" } });

function network({ freeBusy = false, pollinations }: { freeBusy?: boolean; pollinations?: Pollinations } = {}) {
  const calls: string[] = [];
  let inFlight = 0;
  let images = 0;
  const stats = { maxConcurrentImages: 0 };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(requestUrl(input));
    calls.push(`${url.hostname}${url.pathname.startsWith("/prompt/") ? "/prompt" : url.pathname}`);
    if (freeBusy && ["api.groq.com", "generativelanguage.googleapis.com"].includes(url.hostname)) {
      return Response.json({ error: { message: "Rate limit reached", code: 429 } }, { status: 429 });
    }
    if (url.hostname === "generativelanguage.googleapis.com") return googleReply(JSON.stringify(recorded.concept));
    if (url.hostname === "openrouter.ai" && url.pathname.endsWith("/chat/completions")) return openAIReply(JSON.stringify(recorded.concept), "anthropic/claude-haiku-5.5");
    if (url.hostname === "image.pollinations.ai") {
      inFlight += 1;
      stats.maxConcurrentImages = Math.max(stats.maxConcurrentImages, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      inFlight -= 1;
      const response = pollinations?.(images++);
      return response ?? new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
    }
    throw new Error(`Unexpected request to ${url.hostname}${url.pathname}`);
  }));
  return { calls, stats };
}

async function asUser<T>(user: { id: string; email: string | null; email_confirmed_at: string | null }, work: () => Promise<T>): Promise<T> {
  const { eventContext, newEventContext, observeVerifiedUser } = await import("@/lib/observability/context");
  return eventContext.run(newEventContext(), () => {
    observeVerifiedUser(user);
    return work();
  });
}

const image = { prompt: "A chiropractic front desk", width: 1024, height: 1536 };

describe("core: internal accounts write on Haiku and make free images (#449, #466)", () => {
  it("writes an internal account's concept on Haiku like a customer's, and its image on Pollinations without references", async () => {
    const { calls } = network();
    const { complete } = await import("@/lib/llm");
    const { generateImage } = await import("@/lib/imageGen");
    const clock = useVirtualDeadlines();
    const [text, picture] = await settleInVirtualTime(asUser(INTERNAL, async () => [
      await complete([{ role: "user", content: "Write the concept." }], { routing: "creative", json: true }),
      await generateImage({ ...image, referenceImages: ["https://core-test.supabase.co/brand/logo.png"] }),
    ] as const));
    expect(clock.startedAt).toBeGreaterThan(0);
    expect(text).toMatchObject({ provider: "openrouter", model: "anthropic/claude-haiku-5.5" });
    expect(JSON.parse(text.text).headline).toBe(recorded.concept.headline);
    expect(picture).toMatchObject({ provider: "pollinations", estimatedCostUsd: 0 });
    expect(calls).toEqual(["openrouter.ai/api/v1/chat/completions", "image.pollinations.ai/prompt"]);
  });

  it("makes an internal account's three images one at a time, waiting out Pollinations' Retry-After", async () => {
    const { calls, stats } = network({ pollinations: (index) => (index === 1 || index === 2 ? PAYMENT_REQUIRED() : undefined) });
    const { generateImage } = await import("@/lib/imageGen");
    const clock = useVirtualDeadlines();
    const pictures = await settleInVirtualTime(asUser(INTERNAL, () => Promise.all([generateImage(image), generateImage(image), generateImage(image)])));
    expect(pictures.map((picture) => picture.provider)).toEqual(["pollinations", "pollinations", "pollinations"]);
    expect(stats.maxConcurrentImages).toBe(1);
    expect(calls.filter((call) => call === "image.pollinations.ai/prompt")).toHaveLength(5);
    // 5 requests of 2 s each, plus two waits raised from the 8 s Retry-After to the 15 s floor (#634).
    expect(Date.now() - clock.startedAt).toBe(40_000);
  });

  // #634: Pollinations' recorded free-tier answer (Oct 25) says Retry-After: 1 but allows one image
  // per 45 s per address. Production saw a fast 404 in the same spot, so a 404 is treated as busy too.
  it.each([
    ["402 FREE_LIMIT with Retry-After: 1", () => Response.json({ status: 402, success: false, error: { code: "FREE_LIMIT",
      message: "Free limit reached: 1 image every 45 seconds per IP. Retry after 1s" } }, { status: 402, headers: { "retry-after": "1" } })],
    ["404", () => new Response("Not Found", { status: 404 })],
  ])("makes three internal images past Pollinations' 45 s free limit without hammering it (%s)", async (_case, limited) => {
    let lastImageAt = -Infinity;
    const { calls } = network({ pollinations: () => {
      if (Date.now() - lastImageAt < 45_000) return limited();
      lastImageAt = Date.now();
      return undefined;
    } });
    const { generateImage } = await import("@/lib/imageGen");
    useVirtualDeadlines();
    const pictures = await settleInVirtualTime(asUser(INTERNAL, () => Promise.all([generateImage(image), generateImage(image), generateImage(image)])));
    expect(pictures.map((picture) => picture.provider)).toEqual(["pollinations", "pollinations", "pollinations"]);
    expect(calls.filter((call) => call === "image.pollinations.ai/prompt").length).toBeLessThanOrEqual(9);
  });

  it("fails an internal image clearly once Pollinations stays busy for about 90 s, never trying the paid model", async () => {
    vi.stubEnv("IMAGE_PROVIDER_FALLBACK", "openrouter");
    const { calls } = network({ pollinations: () => PAYMENT_REQUIRED() });
    const { generateImage } = await import("@/lib/imageGen");
    const clock = useVirtualDeadlines();
    await expect(settleInVirtualTime(asUser(INTERNAL, () => generateImage(image)))).rejects.toThrow("Free test images are busy");
    expect(Date.now() - clock.startedAt).toBeLessThanOrEqual(92_000);
    expect(calls.every((call) => call === "image.pollinations.ai/prompt")).toBe(true);
  });

  it.each([
    ["stays busy past the cap", () => PAYMENT_REQUIRED(), "IMAGE_FREE_BUSY"],
    ["is down", () => new Response("Bad gateway", { status: 502 }), "IMAGE_HTTP_502"],
    ["answers 200 with a message instead of a picture", () => Response.json({ error: "Free limit reached" }), "IMAGE_INVALID"],
  ])("records why an internal image failed when Pollinations %s (#451)", async (_case, answer, code) => {
    network({ pollinations: answer });
    const { generateImage } = await import("@/lib/imageGen");
    useVirtualDeadlines();
    const attempts: { status: string; errorCode?: string }[] = [];
    await expect(settleInVirtualTime(asUser(INTERNAL, () => generateImage({ ...image, onAttempt: (entry) => attempts.push(entry) })))).rejects.toThrow();
    expect(attempts.map(({ status, errorCode }) => [status, errorCode])).toEqual([["error", code]]);
  });

  it("fails an internal image at once when Pollinations is down, never trying the paid model", async () => {
    vi.stubEnv("IMAGE_PROVIDER_FALLBACK", "openrouter");
    const { calls } = network({ pollinations: () => new Response("Bad gateway", { status: 502 }) });
    const { generateImage } = await import("@/lib/imageGen");
    useVirtualDeadlines();
    await expect(settleInVirtualTime(asUser(INTERNAL, () => generateImage(image)))).rejects.toThrow();
    expect(calls).toEqual(["image.pollinations.ai/prompt"]);
  });

  // #1547: a sales visit's lost picture is tried again with the words that already passed: one Pollinations call, no text call.
  it("makes only the picture again for a reused concept, with no concept call", async () => {
    const { calls } = network();
    const { generateVariants } = await import("@/lib/creative/generate");
    const { AD_ANGLES } = await import("@/lib/templates/ads");
    const stages: string[] = [];
    const variants = await settleInVirtualTime(asUser(INTERNAL, () => generateVariants({
      brand: recorded.brand as never, brief: "Invite adults near Austin to enquire about a new-patient visit.", sourceFacts: recorded.sourceFacts,
      angleIds: [AD_ANGLES[1].id], count: 1, concepts: { [AD_ANGLES[1].id]: recorded.concept as never },
      onProgress: (event) => stages.push(event.stage),
    })));
    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({ angleId: AD_ANGLES[1].id, headline: recorded.concept.headline, llmUsage: [] });
    expect(calls).toEqual(["image.pollinations.ai/prompt"]);
    expect(stages).toEqual(["queued", "image", "ready"]);
  });

  it("gives an internal interview the same paid fallback as a customer when the free tiers are busy", async () => {
    for (const user of [INTERNAL, CUSTOMER]) {
      const { calls } = network({ freeBusy: true });
      const { complete } = await import("@/lib/llm");
      const result = await asUser(user, () => complete([{ role: "user", content: "Plan." }], { routing: "budget", json: true }));
      expect(result.provider, user.id).toBe("openrouter");
      expect(calls.at(-1)).toBe("openrouter.ai/api/v1/chat/completions");
    }
  });

  it.each([["the App Review reviewer", REVIEWER], ["the owner", OWNER], ["a customer", CUSTOMER]])("keeps the paid image model for %s", async (_who, user) => {
    const { isInternalUser } = await import("@/lib/internal-accounts");
    const { freeImagesOnly } = await import("@/lib/llm/spend-policy");
    const { eventContext, newEventContext, observeVerifiedUser } = await import("@/lib/observability/context");
    const free = eventContext.run(newEventContext(), () => { observeVerifiedUser(user); return freeImagesOnly(); });
    expect(free).toBe(false);
    if (user !== CUSTOMER) expect(isInternalUser(user)).toBe(true);
  });
});
