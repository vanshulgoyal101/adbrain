import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/create/cedar-ridge-concept.json";
import { googleReply, openAIReply, requestUrl } from "./replay";

// #449: the OpenRouter key is shared and nearly spent, so internal (team, owner, test) accounts
// use only free providers and the key is kept for customers. The router, AI SDK providers and
// image code are real; the network is replaced, and the concept is the recorded Cedar Ridge reply.

const INTERNAL = { id: "6c1f4f0e-5a43-4c55-9b1f-3f7a3f0c2a10", email: "qa@adbrain.vanshul.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
// CTO (#466): the App Review reviewer and the owner keep the paid models; listed by user id.
const REVIEWER = { id: "0dc149e7-2b7a-459c-82e5-04aa9915e342", email: "reviewer@adbrain.vanshul.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
const OWNER = { id: "da0771ca-c07f-4e86-b6da-023aaf517d74", email: null, email_confirmed_at: null };
const CUSTOMER = { id: "7d2a5b1f-6b54-4d66-8c2a-4a8b4a1d3b21", email: "owner@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
let png: Buffer;

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

function network({ freeBusy = false, pollinationsDown = false } = {}) {
  const hosts: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(requestUrl(input));
    hosts.push(url.hostname);
    if (freeBusy && ["api.groq.com", "generativelanguage.googleapis.com"].includes(url.hostname)) {
      return Response.json({ error: { message: "Rate limit reached", code: 429 } }, { status: 429 });
    }
    if (url.hostname === "generativelanguage.googleapis.com") return googleReply(JSON.stringify(recorded.concept));
    if (url.hostname === "openrouter.ai" && url.pathname.endsWith("/chat/completions")) return openAIReply(JSON.stringify(recorded.concept), "anthropic/claude-haiku-5.5");
    if (url.hostname === "image.pollinations.ai") {
      return pollinationsDown ? new Response("Bad gateway", { status: 502 }) : new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
    }
    throw new Error(`Unexpected request to ${url.hostname}${url.pathname}`);
  }));
  return hosts;
}

async function asUser<T>(user: { id: string; email: string | null; email_confirmed_at: string | null }, work: () => Promise<T>): Promise<T> {
  const { eventContext, newEventContext, observeVerifiedUser } = await import("@/lib/observability/context");
  return eventContext.run(newEventContext(), () => {
    observeVerifiedUser(user);
    return work();
  });
}

describe("core: internal accounts never spend the paid OpenRouter key (#449)", () => {
  it("writes an internal account's concept on a free provider and makes its image on Pollinations", async () => {
    const hosts = network();
    const { complete } = await import("@/lib/llm");
    const { generateImage } = await import("@/lib/imageGen");
    const [text, image] = await asUser(INTERNAL, async () => [
      await complete([{ role: "user", content: "Write the concept." }], { routing: "creative", json: true }),
      await generateImage({ prompt: "A chiropractic front desk", width: 1024, height: 1536, referenceImages: ["https://core-test.supabase.co/brand/logo.png"] }),
    ] as const);
    expect(text).toMatchObject({ provider: "google", model: "gemini-3.6-flash" });
    expect(JSON.parse(text.text).headline).toBe(recorded.concept.headline);
    expect(image).toMatchObject({ provider: "pollinations", estimatedCostUsd: 0 });
    expect(hosts).not.toContain("openrouter.ai");
  });

  it("fails an internal image when Pollinations is down instead of falling back to the paid image model", async () => {
    vi.stubEnv("IMAGE_PROVIDER_FALLBACK", "openrouter");
    const hosts = network({ pollinationsDown: true });
    const { generateImage } = await import("@/lib/imageGen");
    await expect(asUser(INTERNAL, () => generateImage({ prompt: "A chiropractic front desk", width: 1024, height: 1536 }))).rejects.toThrow();
    expect(hosts).toEqual(["image.pollinations.ai"]);
  });

  it("lets an internal interview fail when the free tiers are busy instead of falling back to the paid key", async () => {
    const hosts = network({ freeBusy: true });
    const { complete, AllLLMProvidersFailedError } = await import("@/lib/llm");
    await expect(asUser(INTERNAL, () => complete([{ role: "user", content: "Plan." }], { routing: "budget", json: true })))
      .rejects.toBeInstanceOf(AllLLMProvidersFailedError);
    expect(hosts).toEqual(["api.groq.com", "generativelanguage.googleapis.com"]);
  });

  it("still falls back to the paid key for a customer when the free tiers are busy", async () => {
    const hosts = network({ freeBusy: true });
    const { complete } = await import("@/lib/llm");
    const result = await asUser(CUSTOMER, () => complete([{ role: "user", content: "Plan." }], { routing: "budget", json: true }));
    expect(result.provider).toBe("openrouter");
    expect(hosts.at(-1)).toBe("openrouter.ai");
  });

  it.each([["the App Review reviewer", REVIEWER], ["the owner", OWNER]])("keeps the paid models for %s, an exempt internal account", async (_who, user) => {
    const hosts = network();
    const { complete } = await import("@/lib/llm");
    const { isInternalUser } = await import("@/lib/internal-accounts");
    expect(isInternalUser(user)).toBe(true);
    const result = await asUser(user, () => complete([{ role: "user", content: "Write the concept." }], { routing: "creative", json: true }));
    expect(result).toMatchObject({ provider: "openrouter", model: "anthropic/claude-haiku-5.5" });
    expect(hosts).toEqual(["openrouter.ai"]);
  });

  it("still uses the configured paid models for a customer", async () => {
    const hosts = network();
    const { complete } = await import("@/lib/llm");
    const result = await asUser(CUSTOMER, () => complete([{ role: "user", content: "Write the concept." }], { routing: "creative", json: true }));
    expect(result).toMatchObject({ provider: "openrouter", model: "anthropic/claude-haiku-5.5" });
    expect(hosts).toEqual(["openrouter.ai"]);
  });
});
