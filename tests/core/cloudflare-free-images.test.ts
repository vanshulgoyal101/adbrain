import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import cloudflare from "./fixtures/cloudflare/flux-schnell.json";
import creditExhausted from "./fixtures/openrouter/credit-exhausted.json";

// #1476 (CTO): Create's free pictures come from Cloudflare Workers AI FLUX-1-schnell when its token is set, with
// Pollinations last (54 s median, busy/404). Internal accounts and a customer whose paid image key is out of credit
// both take this path. Image code is real; the network is replaced with Cloudflare's response envelope.

const INTERNAL = { id: "6c1f4f0e-5a43-4c55-9b1f-3f7a3f0c2a10", email: "qa@adbrain.vanshul.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
const ACCOUNT = "0123456789abcdef0123456789abcdef";
let jpeg: string;
let png: Buffer;

beforeEach(async () => {
  vi.resetModules();
  jpeg ??= (await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#cfe0d6" } }).jpeg().toBuffer()).toString("base64");
  png ??= await sharp({ create: { width: 1024, height: 1536, channels: 3, background: "#d9e3dc" } }).png().toBuffer();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    OPENROUTER_API_KEYS: "core-openrouter",
    IMAGE_PROVIDER: "openrouter",
    IMAGE_PROVIDER_FALLBACK: "none",
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
    CLOUDFLARE_AI_TOKEN: "cf-test-token",
  })) vi.stubEnv(name, value);
  vi.doMock("@/lib/security/ssrf", async (original) => ({
    ...(await original<typeof import("@/lib/security/ssrf")>()),
    fetchPublicUrl: async (url: string) => {
      calls.push(new URL(url).hostname);
      return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
    },
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/security/ssrf");
});

let calls: string[] = [];
const bodies: Record<string, unknown>[] = [];
const headers: Headers[] = [];

function network(answer: () => Response = () => Response.json({ ...cloudflare.success.body, result: { image: jpeg } })) {
  calls = [];
  bodies.length = 0;
  headers.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push(`${url.hostname}${url.pathname}`);
    if (url.hostname === "api.cloudflare.com") {
      bodies.push(JSON.parse(String(init?.body)));
      headers.push(new Headers(init?.headers));
      return answer();
    }
    if (url.pathname.includes("/images/models/")) return Response.json({ endpoints: [{ supported_parameters: {} }] });
    if (url.pathname.endsWith("/api/v1/images")) return Response.json(creditExhausted.body, { status: creditExhausted.status });
    throw new Error(`Unexpected request to ${url.hostname}${url.pathname}`);
  }));
}

async function asInternal<T>(work: () => Promise<T>): Promise<T> {
  const { eventContext, newEventContext, observeVerifiedUser } = await import("@/lib/observability/context");
  return eventContext.run(newEventContext(), () => {
    observeVerifiedUser(INTERNAL);
    return work();
  });
}

const image = { prompt: "A rooftop solar install in Mohali at golden hour", width: 1024, height: 1536, seed: 42 };
type Attempt = { provider: string; status: string; errorCode?: string; estimatedCostUsd?: number };

describe("core: free pictures come from Cloudflare FLUX-1-schnell first (#1476)", () => {
  it("makes an internal account's picture on Cloudflare at $0, with no Pollinations call", async () => {
    network();
    const { generateImage } = await import("@/lib/imageGen");
    const attempts: Attempt[] = [];
    const picture = await asInternal(() => generateImage({ ...image, referenceImages: ["https://core-test.supabase.co/logo.png"], onAttempt: (a) => attempts.push(a) }));
    expect(picture).toMatchObject({ provider: "cloudflare", model: "@cf/black-forest-labs/flux-1-schnell", estimatedCostUsd: 0, width: 1024, height: 1024 });
    expect(picture.url).toMatch(/^data:image\/png;base64,/);
    expect(calls).toEqual([`api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/black-forest-labs/flux-1-schnell`]);
    expect(bodies[0]).toEqual({ prompt: image.prompt, steps: 4, seed: 42 });
    expect(headers[0].get("authorization")).toBe("Bearer cf-test-token");
    expect(attempts.map(({ provider, status, estimatedCostUsd }) => [provider, status, estimatedCostUsd])).toEqual([["cloudflare", "success", 0]]);
  });

  it("caps the prompt at Cloudflare's 2048 characters", async () => {
    network();
    const { generateImage } = await import("@/lib/imageGen");
    await asInternal(() => generateImage({ ...image, prompt: "x".repeat(3000) }));
    expect((bodies[0].prompt as string).length).toBe(2048);
  });

  it.each([
    ["is busy (429)", () => new Response("Too Many Requests", { status: 429 }), "IMAGE_FREE_BUSY"],
    ["has used its daily free allowance (4006)", () => Response.json(cloudflare.dailyLimit.body, { status: cloudflare.dailyLimit.status }), "IMAGE_FREE_BUSY"],
    ["is down (502)", () => new Response("Bad gateway", { status: 502 }), "IMAGE_FREE_BUSY"],
    ["refuses the token (401)", () => Response.json(cloudflare.badToken.body, { status: cloudflare.badToken.status }), "IMAGE_PROVIDER"],
    ["answers 200 with no picture", () => Response.json({ result: {}, success: true, errors: [] }), "IMAGE_PROVIDER"],
  ])("falls to Pollinations when Cloudflare %s, recording a fixed code (#451)", async (_case, answer, code) => {
    network(answer);
    const { generateImage } = await import("@/lib/imageGen");
    const attempts: Attempt[] = [];
    const picture = await asInternal(() => generateImage({ ...image, onAttempt: (a) => attempts.push(a) }));
    expect(picture.provider).toBe("pollinations");
    expect(attempts.map(({ provider, status, errorCode }) => [provider, status, errorCode])).toEqual([
      ["cloudflare", "error", code], ["pollinations", "success", undefined],
    ]);
    expect(calls.at(-1)).toBe("image.pollinations.ai");
  });

  it("skips Cloudflare when its account id or token is missing", async () => {
    for (const missing of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_AI_TOKEN"]) {
      vi.resetModules();
      vi.stubEnv(missing, "");
      network();
      const { generateImage } = await import("@/lib/imageGen");
      expect((await asInternal(() => generateImage(image))).provider, missing).toBe("pollinations");
      expect(calls, missing).toEqual(["image.pollinations.ai"]);
      vi.stubEnv(missing, missing === "CLOUDFLARE_ACCOUNT_ID" ? ACCOUNT : "cf-test-token");
    }
  });

  it("gives a customer whose paid image key is out of credit a Cloudflare picture first", async () => {
    network();
    const { generateImage } = await import("@/lib/imageGen");
    const attempts: Attempt[] = [];
    const onFallback = vi.fn();
    const picture = await generateImage({ ...image, onAttempt: (a) => attempts.push(a), onFallback });
    expect(picture).toMatchObject({ provider: "cloudflare", fallbackFrom: "openrouter-image", estimatedCostUsd: 0 });
    expect(attempts.map(({ provider, status, errorCode }) => [provider, status, errorCode])).toEqual([
      ["openrouter-image", "error", "IMAGE_CREDIT_EXHAUSTED"], ["cloudflare", "success", undefined],
    ]);
    expect(calls.some((call) => call.startsWith("image.pollinations.ai"))).toBe(false);
    // #1542: Create hears about the fallback (so it can say pictures are slower), and again for the parked key.
    expect(onFallback).toHaveBeenCalledTimes(1);
    await generateImage({ ...image, onFallback });
    expect(onFallback).toHaveBeenCalledTimes(2);
  });

  it("doesn't report a fallback for an internal account's normal free picture (#1542)", async () => {
    network();
    const { generateImage } = await import("@/lib/imageGen");
    const onFallback = vi.fn();
    await asInternal(() => generateImage({ ...image, onFallback }));
    expect(onFallback).not.toHaveBeenCalled();
  });
});
