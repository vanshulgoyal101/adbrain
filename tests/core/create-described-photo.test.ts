import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import run4 from "./fixtures/create/cedar-ridge-run4.json";
import recorded from "./fixtures/openrouter/photo-describe.json";
import { openAIReply, requestBody, requestUrl } from "./replay";

// #780: an owner's library photo is described by one paid vision call (OpenRouter, data collection denied), and its
// ad's words are written for what it shows. Vision and concept replies are real, recorded Nov 2 by
// scripts/record-photo-describe-fixtures.ts: a price sign, a cake with no text, a Hindi sign.
vi.mock("@/lib/imageGen", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/imageGen")>(),
  generateImage: async () => { throw new Error("A described owner-photo ad must not call the image model."); },
}));

const PHOTO = "https://core-test.supabase.co/storage/v1/object/sign/media/biz/photo.jpg?token=t";
const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";

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

const jpeg = () => sharp({ create: { width: 48, height: 32, channels: 3, background: "#233a2e" } }).jpeg().toBuffer();
const describeReply = (id: string) => recorded.describes.find((entry) => entry.id === id)!;

describe("core: Create describes the owner's library photo with a paid vision call (#780)", () => {
  it.each([
    ["price-sign", { visibleText: "Haircut ₹149 | Beard trim ₹99 | Open 9am-9pm" }],
    ["no-text", { visibleText: null }],
    ["hindi-sign", { visibleText: "ताज़ा समोसे | ₹20 प्लेट".normalize("NFC") }],
  ])("turns the recorded answer for %s into notes, sending the photo only to OpenRouter's vision model", async (id, expected) => {
    const reply = describeReply(id);
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(requestUrl(input)).toBe(OPENROUTER);
      bodies.push(JSON.parse(requestBody(init)));
      return openAIReply(reply.content, reply.model, reply.usage);
    }));
    const { describePhoto } = await import("@/lib/media/describe");
    const { VISION_MODEL } = await import("@/lib/llm");
    const attempts: { provider: string; model: string; usage?: { totalTokens: number } }[] = [];
    const notes = await describePhoto({ data: new Uint8Array(await jpeg()), mediaType: "image/jpeg" }, { onAttempt: (attempt) => attempts.push(attempt) });

    expect(notes).toMatchObject(expected);
    expect(notes!.description.length).toBeGreaterThan(20);
    expect(notes!.description.length).toBeLessThanOrEqual(300);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ model: VISION_MODEL, provider: { data_collection: "deny" }, reasoning: { effort: "minimal", exclude: true } });
    const user = (bodies[0].messages as { role: string; content: unknown }[])[1];
    expect(JSON.stringify(user.content)).toMatch(/"url":"data:image\/jpeg;base64,/);
    expect(attempts).toEqual([expect.objectContaining({ provider: "openrouter", model: VISION_MODEL, usage: expect.objectContaining({ totalTokens: reply.usage.prompt + reply.usage.completion }) })]);
  });

  it("never sends a photo to a free model: no OpenRouter key means no call, and a key out of credit means no notes", async () => {
    const hits: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      hits.push(new URL(url).hostname);
      return Response.json({ error: { message: "Insufficient credits", code: 402 } }, { status: 402 });
    }));
    const { describePhoto } = await import("@/lib/media/describe");
    const photo = { data: new Uint8Array(await jpeg()), mediaType: "image/jpeg" };
    expect(await describePhoto(photo)).toBeNull();
    expect(new Set(hits)).toEqual(new Set(["openrouter.ai"]));

    vi.resetModules();
    vi.stubEnv("OPENROUTER_API_KEYS", "");
    hits.length = 0;
    const fresh = await import("@/lib/media/describe");
    expect(await fresh.describePhoto(photo)).toBeNull();
    expect(hits).toEqual([]);
  });

  it("refuses pictures on any other route", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no call expected"); }));
    const { complete } = await import("@/lib/llm");
    await expect(complete([{ role: "user", content: "x", images: [{ data: new Uint8Array([1]), mediaType: "image/jpeg" }] }], { routing: "creative" }))
      .rejects.toThrow(/vision route/);
  });

  it("writes the ad for the described photo with the recorded concept, and never takes its price as a claim", async () => {
    const photo = await jpeg();
    const { photoNotes, describeReplySchema } = await import("@/lib/media/describe");
    const notes = photoNotes(describeReplySchema.parse(JSON.parse(describeReply("price-sign").content)));
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url === PHOTO) return new Response(new Uint8Array(photo), { headers: { "content-type": "image/jpeg" } });
      expect(url).toBe(OPENROUTER);
      bodies.push(JSON.parse(requestBody(init)));
      return openAIReply(recorded.concept.content, recorded.concept.model, recorded.concept.usage);
    }));
    const { generateVariants } = await import("@/lib/creative/generate");
    const [variant] = await generateVariants({ brand: run4.brand, brief: run4.brief, count: 1, ownerPhotos: [PHOTO], ownerPhotoNotes: { [PHOTO]: notes } });

    expect(bodies).toHaveLength(1);
    const [system, user] = (bodies[0].messages as { content: string }[]);
    expect(system.content).toContain('When imageSource is "owner_photo_described"');
    expect(JSON.parse(user.content)).toMatchObject({ angle: { name: recorded.concept.angleName }, imageSource: "owner_photo_described", photo: notes });
    expect(variant.ownerPhotoUrl).toBe(PHOTO);
    expect(variant.imageUsage).toMatchObject({ provider: "owner-photo", estimatedCostUsd: 0 });
    expect(`${variant.headline} ${variant.primaryText}`).not.toMatch(/₹\s?149|₹\s?99/);

    // The photo's price copied into the words is refused: only Brand facts back a price.
    const { validateConcept } = await import("@/lib/creative/concept");
    const copied = { ...JSON.parse(recorded.concept.content.replace(/^```json\s*|```\s*$/g, "")), headline: "Haircut ₹149 in Austin" };
    const result = validateConcept(copied, { brand: run4.brand, brief: run4.brief, angle: { id: "value", name: recorded.concept.angleName, description: "", imageHint: "", compositionHint: "" }, ownerPhoto: PHOTO, ownerPhotoNotes: notes });
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.issues.join("\n")).toMatch(/unsupported-commercial-claim: ₹149/);
  });

  it("keeps every other ad's prompt as recorded: no photo rule or field without notes", async () => {
    const { buildConceptMessages } = await import("@/lib/creative/concept");
    const { AD_ANGLES } = await import("@/lib/templates/ads");
    const [system, user] = buildConceptMessages({ brand: run4.brand, brief: run4.brief, angle: AD_ANGLES[0], ownerPhoto: PHOTO });
    expect(system.content).not.toContain("owner_photo_described");
    expect(JSON.parse(user.content)).toMatchObject({ imageSource: "owner_photo" });
    expect(JSON.parse(user.content)).not.toHaveProperty("photo");
  });

  it("fails the ad rather than putting words written for the photo over a generated picture", async () => {
    const { photoNotes, describeReplySchema } = await import("@/lib/media/describe");
    const notes = photoNotes(describeReplySchema.parse(JSON.parse(describeReply("no-text").content)));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (requestUrl(input) === PHOTO) return new Response("gone", { status: 404 });
      return openAIReply(recorded.concept.content, recorded.concept.model, recorded.concept.usage);
    }));
    const { generateVariants, CreativeImageError } = await import("@/lib/creative/generate");
    const failures: unknown[] = [];
    const made = await generateVariants({ brand: run4.brand, brief: run4.brief, count: 1, ownerPhotos: [PHOTO], ownerPhotoNotes: { [PHOTO]: notes },
      onFailure: async (_angle, error) => { failures.push(error); } });
    expect(made).toEqual([]);
    expect(failures[0]).toBeInstanceOf(CreativeImageError);
    expect((failures[0] as InstanceType<typeof CreativeImageError>).concept).toBeUndefined();
  });
});
