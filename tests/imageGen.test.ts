import { beforeAll, describe, expect, it } from "vitest";

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
