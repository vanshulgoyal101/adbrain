import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/openrouter/credit-exhausted.json";

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

// #1422 (CTO, production 11:26Z): openrouter-image ran out of credit, then Pollinations answered 404 in the same ms and the
// ad was lost; every later ad asked the exhausted key again. Now: the key is parked, and the free picture waits out one busy.
describe("core: an exhausted image key is parked and the free picture waits out one busy answer (#1422)", () => {
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

  it("a second busy answer fails that picture instead of waiting longer", async () => {
    vi.resetModules();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    process.env.IMAGE_PROVIDER = "openrouter";
    process.env.IMAGE_PROVIDER_FALLBACK = "none";
    const { SafeFetchError } = await import("@/lib/security/ssrf");
    vi.doMock("@/lib/security/ssrf", async (original) => ({
      ...(await original<typeof import("@/lib/security/ssrf")>()),
      fetchPublicUrl: async () => { throw new SafeFetchError("status", 404); },
    }));
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/images/models/")) return Response.json({ endpoints: [{ supported_parameters: { input_references: { max: 3 } } }] });
      return Response.json(recorded.body, { status: recorded.status });
    }) as unknown as typeof fetch;
    const { generateImage } = await import("@/lib/imageGen");
    const pending = generateImage({ prompt: "rooftop solar", width: 1024, height: 1024 });
    const outcome = expect(pending).rejects.toThrow(/busy/i);
    await vi.advanceTimersByTimeAsync(20_000);
    await outcome;
    vi.useRealTimers();
    vi.doUnmock("@/lib/security/ssrf");
  });
});
