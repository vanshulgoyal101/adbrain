import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

let png: Buffer;
const nativeFetch = global.fetch;
const capabilities = {
  endpoints: [
    {
      provider_tag: "openai",
      supported_parameters: {
        aspect_ratio: { type: "enum", values: ["1:1", "3:4", "9:16"] },
        quality: { type: "enum", values: ["medium"] },
        input_references: { type: "range", min: 0, max: 3 },
      },
    },
  ],
};

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("IMAGE_PROVIDER", "openrouter");
  vi.stubEnv("IMAGE_PROVIDER_FALLBACK", "none");
  vi.stubEnv("OPENROUTER_API_KEYS", "test-key");
  png = await sharp({
    create: { width: 120, height: 160, channels: 3, background: "#ff0000" },
  })
    .png()
    .toBuffer();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function mockProvider(result?: Response | Error) {
  const fetchMock = vi.fn<
    (url: string | URL | Request, options?: RequestInit) => Promise<Response>
  >(async (url) => {
    if (String(url).startsWith("data:")) return nativeFetch(url);
    if (String(url).endsWith("/endpoints")) return Response.json(capabilities);
    if (result instanceof Error) throw result;
    return (
      result ??
      Response.json({
        data: [{ b64_json: png.toString("base64"), media_type: "image/png" }],
        usage: { cost: 0.13 },
      })
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("image execution", () => {
  it("sends supported options and references and records actual dimensions", async () => {
    const fetchMock = mockProvider();
    const { generateImage } = await import("@/lib/imageGen");
    const image = await generateImage({
      prompt: "A storefront",
      width: 1080,
      height: 1350,
      seed: 3,
      referenceImages: ["https://cdn.example/product.jpg"],
    });
    expect(image).toMatchObject({
      provider: "openrouter-image",
      width: 120,
      height: 160,
      estimatedCostUsd: 0.13,
    });
    expect(image.seed).toBeUndefined();
    const request = JSON.parse(
      fetchMock.mock.calls.find(([url]) => String(url).endsWith("/images"))![1]!
        .body as string,
    );
    expect(request).toMatchObject({
      aspect_ratio: "3:4",
      quality: "medium",
      input_references: [
        {
          type: "image_url",
          image_url: { url: "https://cdn.example/product.jpg" },
        },
      ],
    });
    expect(request).not.toHaveProperty("resolution");
    expect(request).not.toHaveProperty("output_format");
  });

  it("does not substitute a free model on errors", async () => {
    mockProvider(
      Response.json({ error: { message: "Unavailable" } }, { status: 503 }),
    );
    const { generateImage } = await import("@/lib/imageGen");
    await expect(generateImage({ prompt: "test" })).rejects.toThrow("503");
  });

  it("rejects a missing paid key before any call", async () => {
    vi.stubEnv("OPENROUTER_API_KEYS", "");
    const fetchMock = mockProvider();
    const { generateImage } = await import("@/lib/imageGen");
    await expect(generateImage({ prompt: "test" })).rejects.toThrow("no key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid image bytes even when labelled PNG", async () => {
    mockProvider(
      Response.json({
        data: [{ b64_json: Buffer.from("not an image").toString("base64") }],
      }),
    );
    const { generateImage } = await import("@/lib/imageGen");
    await expect(generateImage({ prompt: "test" })).rejects.toThrow();
  });

  it("never retries ambiguous timeouts through a fallback", async () => {
    vi.stubEnv("IMAGE_PROVIDER_FALLBACK", "pollinations");
    const fetchMock = mockProvider(
      new DOMException("Timed out", "TimeoutError"),
    );
    const { generateImage } = await import("@/lib/imageGen");
    await expect(generateImage({ prompt: "test" })).rejects.toThrow(
      "Timed out",
    );
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("pollinations"),
      ),
    ).toBe(false);
  });

  it("rejects unsupported references before a Pollinations call", async () => {
    vi.stubEnv("IMAGE_PROVIDER", "pollinations");
    const fetchMock = mockProvider();
    const { generateImage } = await import("@/lib/imageGen");
    await expect(
      generateImage({
        prompt: "test",
        referenceImages: ["https://example.com/product.png"],
      }),
    ).rejects.toThrow("does not support");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not count a Pollinations URL as a completed image", async () => {
    vi.stubEnv("IMAGE_PROVIDER", "pollinations");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })),
    );
    const { generateImage } = await import("@/lib/imageGen");
    await expect(generateImage({ prompt: "test" })).rejects.toThrow("503");
  });
});
