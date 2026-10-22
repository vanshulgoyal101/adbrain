import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import run4 from "./fixtures/create/cedar-ridge-run4.json";
import recorded from "./fixtures/create/cedar-ridge-owner-photo.json";
import { openAIReply, requestBody, requestUrl } from "./replay";

// #195: one Create ad uses the business's own uploaded photo as its image. The concept reply is a real
// Haiku 5.5 answer recorded with imageSource "owner_photo"; download, validation and rotation are real.
vi.mock("@/lib/imageGen", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/imageGen")>(),
  generateImage: async () => { throw new Error("The owner-photo ad must not call the image model."); },
}));

const PHOTO = "https://core-test.supabase.co/storage/v1/object/public/brand-assets/cedar-ridge/front-desk.jpg";

beforeEach(() => {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    OPENROUTER_API_KEYS: "core-openrouter",
    LLM_PROVIDER_ORDER: "openrouter",
    CREATIVE_PROVIDER_ORDER: undefined,
    OPENROUTER_MODEL: undefined,
  })) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("core: Create uses the owner's own photo for one ad (#195)", () => {
  it("saves the recorded owner-photo concept over the real photo, turned upright, with no image model call", async () => {
    // A phone photo stored sideways with EXIF orientation 6 (rotate 90° to display).
    const sideways = await sharp({ create: { width: 60, height: 40, channels: 3, background: "#74A7FE" } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url === PHOTO) return new Response(new Uint8Array(sideways), { headers: { "content-type": "image/jpeg" } });
      expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
      bodies.push(JSON.parse(requestBody(init)));
      return openAIReply(recorded.response.content, recorded.model, recorded.response.usage);
    }));
    const { generateVariants } = await import("@/lib/creative/generate");
    const [variant] = await generateVariants({ brand: run4.brand, brief: run4.brief, count: 1, ownerPhotos: [PHOTO] });

    expect(bodies).toHaveLength(1);
    const user = JSON.parse((bodies[0].messages as { content: string }[])[1].content);
    expect(user).toMatchObject({ angle: { name: recorded.angleName }, imageSource: "owner_photo" });
    expect(variant.ownerPhotoUrl).toBe(PHOTO);
    expect(variant.imageUrl).toBe(PHOTO);
    expect(variant.imageUsage).toMatchObject({ provider: "owner-photo", estimatedCostUsd: 0, width: 40, height: 60 });
    expect(variant.imageAttempts).toEqual([]);
    expect(variant.design.backgroundUrl).toBe(PHOTO);
    // The model cannot see the photo, so the copy must not describe it.
    expect(`${variant.headline} ${variant.primaryText}`).not.toMatch(/\b(?:pictured|photo|shown|this image)\b/i);
  });

  it("keeps an unreadable photo from costing the ad: it falls back to a generated image", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (requestUrl(input) === PHOTO) return new Response("<html>not an image</html>", { headers: { "content-type": "text/html" } });
      return openAIReply(recorded.response.content, recorded.model, recorded.response.usage);
    }));
    const { generateVariants } = await import("@/lib/creative/generate");
    const failures: unknown[] = [];
    await generateVariants({ brand: run4.brand, brief: run4.brief, count: 1, ownerPhotos: [PHOTO], onFailure: async (_angle, error) => { failures.push(error); } });
    // The generated-image path ran (and hit this test's blocked image model), so the photo was not used.
    expect(String((failures[0] as Error).message)).toContain("must not call the image model");
  });
});
