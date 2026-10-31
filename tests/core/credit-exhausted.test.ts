import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import recorded from "./fixtures/openrouter/credit-exhausted.json";
import run4 from "./fixtures/create/cedar-ridge-run4.json";
import ownerReply from "./fixtures/create/cedar-ridge-owner-photo.json";
import { openAIReply, requestBody, requestUrl } from "./replay";

// #449 (CEO, Oct 25): when the OpenRouter key runs out, Create must fall back to the free models,
// not fail. Replays OpenRouter's real 402 for a request the key can't afford (recorded Oct 25:
// refused before generating, usage unchanged), plus the 403 'Key limit exceeded' it gave on Oct 24.
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.OPENROUTER_API_KEYS = "or-key";
  process.env.GROQ_API_KEYS = "groq-key";
  process.env.GOOGLE_AI_API_KEYS = "";
  process.env.CEREBRAS_API_KEYS = "";
  // Production-like: Create's concepts go to OpenRouter (Haiku) only.
  process.env.CREATIVE_PROVIDER_ORDER = "openrouter";
});

afterEach(() => vi.restoreAllMocks());

const ok = () => Response.json({ choices: [{ message: { content: "a concept" } }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } });

function stub(openrouterAnswer: () => Response) {
  const hits: string[] = [];
  global.fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("openrouter.ai")) { hits.push("openrouter"); return openrouterAnswer(); }
    if (url.includes("api.groq.com")) { hits.push("groq"); return ok(); }
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch;
  return hits;
}

describe("core: Create keeps working when the OpenRouter key is out of credit (#449)", () => {
  it("falls back to a free model on OpenRouter's recorded 402, and stops asking the exhausted key", async () => {
    vi.resetModules();
    const { complete } = await import("@/lib/llm");
    const hits = stub(() => Response.json(recorded.body, { status: recorded.status }));
    const first = await complete([{ role: "user", content: "concept please" }], { routing: "creative" });
    expect(first).toMatchObject({ text: "a concept", provider: "groq" });
    expect(hits).toEqual(["openrouter", "groq"]);

    const second = await complete([{ role: "user", content: "another concept" }], { routing: "creative" });
    expect(second.provider).toBe("groq");
    expect(hits.slice(2)).toEqual(["groq"]);
  });

  it("treats the 403 'Key limit exceeded' the same way", async () => {
    vi.resetModules();
    const { complete } = await import("@/lib/llm");
    const hits = stub(() => Response.json({ error: { message: "Key limit exceeded (total limit). Manage it using https://openrouter.ai/settings/keys", code: 403 } }, { status: 403 }));
    expect((await complete([{ role: "user", content: "x" }], { routing: "creative" })).provider).toBe("groq");
    expect(hits).toEqual(["openrouter", "groq"]);
  });

  it("does not add free models for other failures (a plain 400 stays an error)", async () => {
    vi.resetModules();
    const { complete, AllLLMProvidersFailedError } = await import("@/lib/llm");
    const hits = stub(() => Response.json({ error: { message: "bad request", code: 400 } }, { status: 400 }));
    await expect(complete([{ role: "user", content: "x" }], { routing: "creative" })).rejects.toBeInstanceOf(AllLLMProvidersFailedError);
    expect(hits.every((hit) => hit === "openrouter")).toBe(true);
  });
});

describe("core: Create's pictures keep coming when the OpenRouter key is out of credit (#449)", () => {
  it("falls back to the free image model on a credit-exhausted OpenRouter image call, even with no fallback configured", async () => {
    vi.resetModules();
    process.env.IMAGE_PROVIDER = "openrouter";
    process.env.IMAGE_PROVIDER_FALLBACK = "none";
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#e8f0e8" } }).png().toBuffer();
    vi.doMock("@/lib/security/ssrf", async (original) => ({
      ...(await original<typeof import("@/lib/security/ssrf")>()),
      fetchPublicUrl: async () => new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } }),
    }));
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url.replace(/\?.*$/, ""));
      if (url.includes("/images/models/")) return Response.json({ endpoints: [{ supported_parameters: { input_references: { max: 3 } } }] });
      if (url.endsWith("/api/v1/images")) return Response.json(recorded.body, { status: recorded.status });
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;
    const attempts: { provider: string; status: string; errorCode?: string }[] = [];
    const { generateImage } = await import("@/lib/imageGen");
    const image = await generateImage({ prompt: "rooftop solar panels on a house", width: 1024, height: 1024,
      onAttempt: (attempt) => attempts.push(attempt) });
    expect(image).toMatchObject({ provider: "pollinations", fallbackFrom: "openrouter-image" });
    expect(image.url.startsWith("data:image/png;base64,")).toBe(true);
    expect(attempts.map((a) => [a.provider, a.status, a.errorCode])).toEqual([
      ["openrouter-image", "error", "IMAGE_CREDIT_EXHAUSTED"], ["pollinations", "success", undefined],
    ]);
    vi.doUnmock("@/lib/security/ssrf");
  });
});

// #1593 (Reviewer): the free pictures can't use the owner's product photo, so an ad made from it came back with a
// generic product. Now that picture fails with an honest reason, on the first 402 and while the key is parked.
describe("core: an ad from the owner's product photo never silently becomes a generic product (#1593)", () => {
  it("credit runs out → that picture fails, no free picture is made; while parked, the same", async () => {
    vi.resetModules();
    process.env.IMAGE_PROVIDER = "openrouter";
    process.env.IMAGE_PROVIDER_FALLBACK = "none";
    const free: string[] = [];
    vi.doMock("@/lib/security/ssrf", async (original) => ({
      ...(await original<typeof import("@/lib/security/ssrf")>()),
      fetchPublicUrl: async (url: string) => { free.push(url); throw new Error("no free picture should be fetched"); },
    }));
    const paid: string[] = [];
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/images/models/")) return Response.json({ endpoints: [{ supported_parameters: { input_references: { max: 3 } } }] });
      if (url.endsWith("/api/v1/images")) { paid.push("openrouter"); return Response.json(recorded.body, { status: recorded.status }); }
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;
    const { generateImage } = await import("@/lib/imageGen");
    const { ReferencePhotoPausedError } = await import("@/lib/imageGen/types");
    const attempts: [string, string, string | undefined][] = [];
    const fallbacks: string[] = [];
    const request = { prompt: "our 5 kW panel on a Mohali rooftop", width: 1024, height: 1024,
      referenceImages: ["https://example.com/owner-panel.jpg"], onFallback: () => fallbacks.push("fallback"),
      onAttempt: (attempt: { provider: string; status: string; errorCode?: string }) => attempts.push([attempt.provider, attempt.status, attempt.errorCode]) };

    try {
      await expect(generateImage(request)).rejects.toBeInstanceOf(ReferencePhotoPausedError);
      expect(attempts).toEqual([["openrouter-image", "error", "IMAGE_CREDIT_EXHAUSTED"]]);
      await expect(generateImage(request)).rejects.toBeInstanceOf(ReferencePhotoPausedError);
      expect(paid).toEqual(["openrouter"]);
      expect(free).toEqual([]);
      expect(fallbacks).toEqual([]);
    } finally {
      vi.doUnmock("@/lib/security/ssrf");
    }
  });
});

// #2222: paid pictures out of credit used to fail every product-photo ad with a false "try again in 15 minutes".
// Now those ads use the owner's own photo ($0, the real product); with no photo, the honest line stays.
describe("core: product-photo ads use the owner's photo while paid pictures are out of credit (#2222)", () => {
  const PHOTO = "https://core-test.supabase.co/storage/v1/object/public/brand-assets/cedar-ridge/front-desk.jpg";
  async function batch(photos: string[]) {
    vi.resetModules();
    for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co", IMAGE_PROVIDER: "openrouter",
      IMAGE_PROVIDER_FALLBACK: "none", LLM_PROVIDER_ORDER: "openrouter", CREATIVE_PROVIDER_ORDER: undefined, OPENROUTER_MODEL: undefined })) vi.stubEnv(name, value);
    const upright = await sharp({ create: { width: 40, height: 60, channels: 3, background: "#74A7FE" } }).jpeg().toBuffer();
    const replies: Record<string, string> = Object.fromEntries(run4.angles.map((angle) => [angle.angleName, JSON.stringify(angle.concept)]));
    replies[ownerReply.angleName] = ownerReply.response.content;
    const hits: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url === PHOTO) return new Response(new Uint8Array(upright), { headers: { "content-type": "image/jpeg" } });
      if (url.includes("/images/models/")) return Response.json({ endpoints: [{ supported_parameters: { input_references: { max: 3 } } }] });
      if (url.endsWith("/api/v1/images")) { hits.push("paid-image"); return Response.json(recorded.body, { status: recorded.status }); }
      if (url.endsWith("/chat/completions")) {
        const user = JSON.parse((JSON.parse(requestBody(init)).messages as { content: string }[])[1].content);
        return openAIReply(replies[user.angle.name], ownerReply.model, ownerReply.response.usage);
      }
      hits.push(url);
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;
    const { generateVariants } = await import("@/lib/creative/generate");
    const { creativeFailureMessage } = await import("@/lib/creative/failure-message");
    const failures: string[] = [];
    const variants = await generateVariants({ brand: run4.brand, brief: run4.brief, count: 3, ownerPhotos: photos,
      referenceImages: photos.length ? photos : ["https://core-test.supabase.co/storage/v1/object/public/brand-assets/cedar-ridge/past-ad.jpg"],
      onFailure: async (_angle, error) => { failures.push(creativeFailureMessage(error)); } });
    vi.unstubAllEnvs();
    return { variants, failures, hits };
  }

  it("3/3 ads from one owner photo on the recorded 402: $0, receipt says owner photo, no free stand-in", async () => {
    const { variants, failures, hits } = await batch([PHOTO]);
    expect(failures).toEqual([]);
    expect(variants).toHaveLength(3);
    for (const variant of variants) {
      expect(variant).toMatchObject({ imageUrl: PHOTO, ownerPhotoUrl: PHOTO });
      expect(variant.imageUsage).toMatchObject({ provider: "owner-photo", estimatedCostUsd: 0 });
      expect(variant.design.backgroundUrl).toBe(PHOTO);
    }
    // The two product-photo ads met the recorded 402 (nothing charged) or the parked key, and fell back to the photo.
    const fellBack = variants.filter((variant) => variant.imageUsage.fallbackFrom);
    expect(fellBack).toHaveLength(2);
    expect(variants.filter((variant) => variant.imageAttempts?.length)).toHaveLength(hits.length);
    for (const variant of fellBack) {
      expect(variant.imageUsage.fallbackFrom).toBe("openrouter-image");
      expect(variant.imagePrompt).toMatch(/own photo/);
    }
    expect(hits.every((hit) => hit === "paid-image")).toBe(true);
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it("with no owner photo, the ad fails honestly and promises no '15 minutes'", async () => {
    const { variants, failures } = await batch([]);
    expect(variants).toEqual([]);
    expect(failures).toHaveLength(3);
    for (const message of failures) {
      expect(message).not.toMatch(/15 minutes/);
      expect(message).toMatch(/Add a photo of your product in Brand/);
    }
  });
});

// #1422 (CTO, production 11:26Z): openrouter-image ran out of credit, then Pollinations answered 404 in the same ms and the
// ad was lost; every later ad asked the exhausted key again. Now: the key is parked, and the free picture waits out one busy.
describe("core: an exhausted image key is parked and the free picture waits out one busy answer (#1422)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("@/lib/security/ssrf");
    process.env.IMAGE_PROVIDER_FALLBACK = "none";
  });

  it("exhausted → Pollinations 404 → one wait → saved; the next picture skips the exhausted key", async () => {
    vi.resetModules();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    process.env.IMAGE_PROVIDER = "openrouter";
    process.env.IMAGE_PROVIDER_FALLBACK = "none";
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#e8f0e8" } }).png().toBuffer();
    const { SafeFetchError } = await import("@/lib/security/ssrf");
    const downloads: string[] = [];
    vi.doMock("@/lib/security/ssrf", async (original) => ({
      ...(await original<typeof import("@/lib/security/ssrf")>()),
      fetchPublicUrl: async () => {
        downloads.push(downloads.length === 0 ? "404" : "ok");
        if (downloads.length === 1) throw new SafeFetchError("status", 404);
        return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
      },
    }));
    const paid: string[] = [];
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/images/models/")) return Response.json({ endpoints: [{ supported_parameters: { input_references: { max: 3 } } }] });
      if (url.endsWith("/api/v1/images")) { paid.push("openrouter"); return Response.json(recorded.body, { status: recorded.status }); }
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;
    const { generateImage } = await import("@/lib/imageGen");
    const attempts: [string, string, string | undefined][] = [];
    const onAttempt = (attempt: { provider: string; status: string; errorCode?: string }) => attempts.push([attempt.provider, attempt.status, attempt.errorCode]);

    const pending = generateImage({ prompt: "rooftop solar panels on a house", width: 1024, height: 1024, onAttempt });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toMatchObject({ provider: "pollinations", fallbackFrom: "openrouter-image" });
    expect(downloads).toEqual(["404", "ok"]);
    expect(attempts).toEqual([["openrouter-image", "error", "IMAGE_CREDIT_EXHAUSTED"], ["pollinations", "success", undefined]]);

    const second = await generateImage({ prompt: "a family on their roof", width: 1024, height: 1024, onAttempt });
    expect(second).toMatchObject({ provider: "pollinations", fallbackFrom: "openrouter-image" });
    expect(paid).toEqual(["openrouter"]);
    vi.useRealTimers();
    vi.doUnmock("@/lib/security/ssrf");
  });

  // #2189 (production, Oct 28 15:28-15:31Z): with the key parked, a paid customer's pictures got one busy wait each, so
  // Pollinations' one-image-per-45 s left 3 of 6 ads blank while free accounts (which wait to the cap) got 3/3.
  it("while the key is out of credit, the free picture waits like a free account's: busy ×3, then saved", async () => {
    const { generateImage, downloads } = await busyThen(3, recorded);
    const pending = generateImage({ prompt: "rooftop solar", width: 1024, height: 1024 });
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(pending).resolves.toMatchObject({ provider: "pollinations", fallbackFrom: "openrouter-image" });
    expect(downloads()).toBe(4);
    // Parked: the next picture skips the key and gets the same patience.
    const next = generateImage({ prompt: "a family on their roof", width: 1024, height: 1024 });
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(next).resolves.toMatchObject({ provider: "pollinations", fallbackFrom: "openrouter-image" });
  });

  it("still busy at the 90 s cap fails that picture (#2153 parks the free pictures)", async () => {
    const { generateImage } = await busyThen(Number.POSITIVE_INFINITY, recorded);
    const pending = generateImage({ prompt: "rooftop solar", width: 1024, height: 1024 });
    const outcome = expect(pending).rejects.toThrow(/busy/i);
    await vi.advanceTimersByTimeAsync(120_000);
    await outcome;
  });

  it("a one-off paid failure (not credit) still waits out only one busy answer, then tries the next picture", async () => {
    process.env.IMAGE_PROVIDER_FALLBACK = "pollinations";
    const { generateImage, release } = await busyThen(Number.POSITIVE_INFINITY, { status: 500, body: { error: { message: "Internal error" } } });
    const pending = generateImage({ prompt: "rooftop solar", width: 1024, height: 1024 });
    const outcome = expect(pending).rejects.toThrow(/busy/i);
    await vi.advanceTimersByTimeAsync(20_000);
    await outcome;
    // #2153: a one-retry busy-out doesn't park the free pictures (only the 90 s cap does); the next one is tried.
    release();
    const next = generateImage({ prompt: "a family on their roof", width: 1024, height: 1024 });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(next).resolves.toMatchObject({ provider: "pollinations" });
  });
});

/** OpenRouter answers `paidAnswer`; Pollinations is busy (404) for the first `busy` downloads, then returns a picture. */
async function busyThen(busy: number, paidAnswer: { status: number; body: unknown }) {
  vi.resetModules();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  process.env.IMAGE_PROVIDER = "openrouter";
  const sharp = (await import("sharp")).default;
  const png = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#e8f0e8" } }).png().toBuffer();
  const { SafeFetchError } = await import("@/lib/security/ssrf");
  let count = 0;
  let limit = busy;
  vi.doMock("@/lib/security/ssrf", async (original) => ({
    ...(await original<typeof import("@/lib/security/ssrf")>()),
    fetchPublicUrl: async () => {
      count += 1;
      if (count <= limit) throw new SafeFetchError("status", 404);
      return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
    },
  }));
  global.fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/images/models/")) return Response.json({ endpoints: [{ supported_parameters: { input_references: { max: 3 } } }] });
    return Response.json(paidAnswer.body, { status: paidAnswer.status });
  }) as unknown as typeof fetch;
  const { generateImage } = await import("@/lib/imageGen");
  return { generateImage, downloads: () => count, release: () => { limit = 0; } };
}
