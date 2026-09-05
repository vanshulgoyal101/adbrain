import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.IMAGE_PROVIDER = "pollinations";
  process.env.POLLINATIONS_MODEL = "flux";
});

describe("imageGen (pollinations)", () => {
  it("builds a pollinations URL with encoded prompt and params", async () => {
    const { generateImage } = await import("@/lib/imageGen");
    const img = await generateImage({
      prompt: "rooftop solar panels",
      width: 1024,
      height: 1024,
      seed: 42,
    });
    expect(img.provider).toBe("pollinations");
    expect(img.url).toContain("https://image.pollinations.ai/prompt/");
    expect(img.url).toContain("rooftop%20solar%20panels");
    expect(img.url).toContain("width=1024");
    expect(img.url).toContain("seed=42");
    expect(img.url).toContain("model=flux");
    expect(img.url).toContain("nologo=true");
  });
});

describe("imageGen (OpenRouter)", () => {
  it("requests a 1K image and returns a data URL", async () => {
    vi.resetModules();
    process.env.IMAGE_PROVIDER = "openrouter";
    process.env.IMAGE_PROVIDER_FALLBACK = "pollinations";
    process.env.OPENROUTER_API_KEYS = "test-key";
    process.env.OPENROUTER_IMAGE_MODEL = "openai/gpt-image-2";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: "aW1hZ2U=", media_type: "image/png" }] }),
    }) as unknown as typeof fetch;

    const { generateImage } = await import("@/lib/imageGen");
    const image = await generateImage({ prompt: "a storefront", width: 1024, height: 1024, referenceImages: ["https://cdn.example/product.jpg"] });

    expect(image.provider).toBe("openrouter-image");
    expect(image.url).toBe("data:image/png;base64,aW1hZ2U=");
    expect(fetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/images",
      expect.objectContaining({ method: "POST" }),
    );
    const request = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    expect(request.quality).toBe("high");
    expect(request.input_references).toEqual([
      { type: "image_url", image_url: { url: "https://cdn.example/product.jpg" } },
    ]);
  });
});
