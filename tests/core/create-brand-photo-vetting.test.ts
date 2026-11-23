import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/openrouter/photo-describe.json";
import { openAIReply, requestBody, requestUrl } from "./replay";

// A brand's saved product photo is used untouched as an ad picture, so one with printed words is left out. The vision
// replies are the real ones recorded Nov 2 for #780 (a price sign, a cake with no text, a Hindi sign); no live call.
const BASE = "https://core-test.supabase.co/storage/v1/object/sign/media/biz";
const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";
const context = { businessId: "b", userId: "u", route: "/api/creatives/generate", requestId: "r", generationId: "g" };

beforeEach(() => {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    OPENROUTER_API_KEYS: "core-openrouter",
    GOOGLE_AI_API_KEYS: "core-google",
    GROQ_API_KEYS: "core-groq",
    LLM_PROVIDER_ORDER: "openrouter",
    CREATIVE_PROVIDER_ORDER: undefined,
    OPENROUTER_MODEL: undefined,
  })) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("core: Create skips brand photos with printed text or logos", () => {
  it("drops the recorded price sign and Hindi sign, keeps the cake, and describes each photo once", async () => {
    const order = ["price-sign", "no-text", "hindi-sign"];
    // Each photo has its own width so the stand-in provider answers the right recorded reply whatever the call order.
    const widthOf = (id: string) => 40 + order.indexOf(id) * 8;
    const photo = (id: string) => sharp({ create: { width: widthOf(id), height: 32, channels: 3, background: "#233a2e" } }).jpeg().toBuffer();
    let visionCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url === OPENROUTER) {
        visionCalls++;
        const sent = Buffer.from(/base64,([^"]+)"/.exec(requestBody(init))![1], "base64");
        const id = order[((await sharp(sent).metadata()).width! - 40) / 8];
        const reply = recorded.describes.find((entry) => entry.id === id)!;
        return openAIReply(reply.content, reply.model, reply.usage);
      }
      return new Response(new Uint8Array(await photo(order.find((id) => url.endsWith(`${id}.jpg`))!)), { headers: { "content-type": "image/jpeg" } });
    }));
    const urls = order.map((id) => `${BASE}/${id}.jpg`);
    const { vetBrandPhotos } = await import("@/lib/creative/brand-photo-vetting");

    const first = await vetBrandPhotos(urls, context);
    expect(first.photos).toEqual([urls[1]]);
    expect(first.notes[urls[1]].visibleText).toBeNull();
    expect(first.events).toHaveLength(3);

    const second = await vetBrandPhotos(urls, context);
    expect(second.photos).toEqual([urls[1]]);
    expect(visionCalls).toBe(3);
    expect(second.events).toHaveLength(0);
  });
});
