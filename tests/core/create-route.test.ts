import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import run4 from "./fixtures/create/cedar-ridge-run4.json";
import evalRows from "./fixtures/create/eval-concepts.json";
import { googleReply, openAIReply, requestBody, requestUrl, settleInVirtualTime, useVirtualDeadlines, wait } from "./replay";
import { CREATE_HEARTBEAT_MS, CREATE_IDLE_MS } from "@/lib/creative/stream";

// Core regression gate (#110): brief -> 3 concepts -> validation -> images -> 3 saved ads.
// Everything from the route to the AI SDK, the validator and the image provider is real;
// only the provider network, Supabase and storage are replaced.

const SUPABASE = "https://core-test.supabase.co";
const OWNER_PHOTO = `${SUPABASE}/storage/v1/object/public/brand-assets/cedar-ridge/front-desk.jpg`;
const IMAGE_MODEL = "openai/gpt-image-2.5-flare";
const mocks = vi.hoisted(() => ({
  inserts: [] as Record<string, unknown>[],
  progress: [] as Record<string, unknown>[],
  fastRaster: false,
  ownerPhotos: [] as string[],
  ownerPhotoStatus: 200,
  usage: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "creative_generation_admit") return { data: { action: "start", status: "processing" }, error: null };
      if (name === "creative_generation_progress") {
        mocks.progress.push(args);
        return { data: { status: args.p_uncertain ? "unresolved" : args.p_complete ? "complete" : "processing" }, error: null };
      }
      return { data: null, error: { message: `Unexpected RPC ${name}` } };
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: table === "businesses" ? run4.brand : null, error: null }) }),
        limit: async () => ({ error: null }),
      }),
      insert: (row: Record<string, unknown>) => {
        mocks.inserts.push(row);
        return { select: () => ({ single: async () => ({ data: { id: `creative-${mocks.inserts.length}`, ...row }, error: null }) }) };
      },
    }),
  }),
}));
vi.mock("@/lib/creative/references", () => ({ creativeAssets: async () => ({ references: [], photos: mocks.ownerPhotos }), recentCreativeCopy: async () => [] }));
vi.mock("@/lib/preferences/store", () => ({ preferenceContext: async () => "" }));
vi.mock("@/lib/creative/persist", () => ({
  persistCreativeImage: async (_client: unknown, businessId: string, group: string, angle: string) =>
    `${SUPABASE}/storage/v1/object/public/creatives/${businessId}/${group}/${angle}.webp`,
  renderAndPersistDesign: async (_client: unknown, _businessId: string, _group: string, _angle: string, _design: unknown, photoUrl: string) => photoUrl,
}));
vi.mock("@/lib/llm/persist", () => ({
  configuredMonthlyTokenLimit: () => 0,
  monthlyTokenUsage: async () => 0,
  persistLLMUsage: async (events: Record<string, unknown>[]) => { mocks.usage.push(...events); return true; },
}));
vi.mock("@/lib/supabase/queries", () => ({ getActiveInstructionsText: async () => "" }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/audit", () => ({ logEvent: async () => {} }));
// The timing replay runs on a virtual clock, which cannot wait for sharp's thread pool.
vi.mock("@/lib/imageGen/raster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/imageGen/raster")>();
  return {
    ...actual,
    validateRaster: (bytes: Uint8Array) => mocks.fastRaster
      ? Promise.resolve({ bytes, contentType: "image/png", width: 1024, height: 1536 })
      : actual.validateRaster(bytes),
  };
});

type Angle = (typeof run4.angles)[number];
type TextProvider = "groq" | "openrouter" | "google";
const TEXT_URLS: Record<TextProvider, string> = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  google: "https://generativelanguage.googleapis.com/",
};
type Replay = {
  /** Providers that answer with this HTTP status instead of a concept. */
  down?: Partial<Record<TextProvider, number>>;
  /** Text for the given 1-based attempt of an angle. */
  text?: (angle: Angle, attempt: number) => string;
  /** Wait the recorded run-4 latencies (on the virtual clock) for text and image calls. */
  recordedLatency?: boolean;
  /** Overrides the text latency, in virtual milliseconds. */
  textLatency?: () => number;
};

let png: string;
let calls: { url: string; body: string }[];
const textCalls = (provider: TextProvider) => calls.filter(({ url }) => url.startsWith(TEXT_URLS[provider]));

beforeAll(async () => {
  png = (await sharp({ create: { width: 64, height: 96, channels: 3, background: "#74A7FE" } }).png().toBuffer()).toString("base64");
});

beforeEach(() => {
  vi.resetModules();
  mocks.inserts.length = 0;
  mocks.progress.length = 0;
  mocks.fastRaster = false;
  mocks.ownerPhotos = [];
  mocks.ownerPhotoStatus = 200;
  mocks.usage.length = 0;
  calls = [];
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    GOOGLE_AI_API_KEYS: "core-google",
    OPENROUTER_API_KEYS: "core-openrouter",
    GROQ_API_KEYS: "core-groq",
    CEREBRAS_API_KEYS: "",
    // Production values; CREATIVE_PROVIDER_ORDER is unset there, so Create follows LLM_PROVIDER_ORDER.
    LLM_PROVIDER_ORDER: "openrouter,google,groq",
    CREATIVE_PROVIDER_ORDER: undefined,
    IMAGE_PROVIDER: "openrouter",
    IMAGE_PROVIDER_FALLBACK: "none",
    OPENROUTER_IMAGE_MODEL: IMAGE_MODEL,
    AD_DESIGN_OVERLAY: undefined,
  })) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const recorded = (angle: Angle) => JSON.stringify(angle.concept);

function angleFor(body: string): Angle {
  const angle = run4.angles.find((candidate) => body.includes(candidate.angleName));
  if (!angle) throw new Error("Concept request did not name a recorded angle.");
  return angle;
}

function stubProviders(replay: Replay = {}) {
  const attempts = new Map<string, number>();
  const text = replay.text ?? ((angle) => recorded(angle));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const body = requestBody(init);
    calls.push({ url, body });
    const provider = (Object.keys(TEXT_URLS) as TextProvider[]).find((name) => url.startsWith(TEXT_URLS[name]));
    if (url === OWNER_PHOTO) {
      return mocks.ownerPhotoStatus === 200
        ? new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } })
        : new Response("Not found", { status: mocks.ownerPhotoStatus });
    }
    if (provider) {
      const status = replay.down?.[provider];
      if (status) return Response.json({ error: { code: status, message: "Service unavailable", status: "UNAVAILABLE" } }, { status });
      const angle = angleFor(body);
      const attempt = (attempts.get(angle.angleId) ?? 0) + 1;
      attempts.set(angle.angleId, attempt);
      const usage = angle.textAttempts[Math.min(attempt, angle.textAttempts.length) - 1];
      if (replay.textLatency) await wait(replay.textLatency(), init?.signal);
      else if (replay.recordedLatency) await wait(usage.latencyMs, init?.signal);
      const reply = text(angle, attempt);
      const tokens = { prompt: usage.promptTokens, completion: usage.completionTokens };
      if (provider === "google") return googleReply(reply, tokens);
      return openAIReply(reply, provider === "groq" ? "qwen/qwen3.8-27b" : "qwen/qwen3.8-max-0902", tokens);
    }
    if (url === `https://openrouter.ai/api/v1/images/models/${IMAGE_MODEL}/endpoints`) {
      return Response.json({ endpoints: [{ provider_tag: "openai", supported_parameters: {
        aspect_ratio: { values: ["1:1", "2:3", "3:2"] }, quality: { values: ["low", "medium", "high"] },
        resolution: { values: ["1K", "2K"] }, output_format: { values: ["png", "jpeg", "webp"] }, input_references: { max: 16 },
      } }] });
    }
    if (url === "https://openrouter.ai/api/v1/images") {
      const angle = run4.angles.find((candidate) => body.includes(JSON.stringify(candidate.concept.visual.direction.slice(0, 80)).slice(1, -1)));
      if (replay.recordedLatency) {
        if (!angle) throw new Error("Image request did not match a recorded concept.");
        await wait(angle.imageLatencyMs, init?.signal);
      }
      return Response.json({ id: "gen-image-core-replay", data: [{ b64_json: png, media_type: "image/png" }], usage: { cost: 0.04 } });
    }
    throw new Error(`Unexpected provider request: ${url}`);
  }));
}

async function postCreate() {
  const { POST } = await import("@/app/api/creatives/generate/route");
  return () => POST(new Request("http://localhost/api/creatives/generate", {
    method: "POST",
    body: JSON.stringify({ businessId: run4.brand.id, brief: run4.brief, count: 3, generationId: "6d0e7324-171e-45df-894a-28ef6c910196" }),
  }));
}

async function expectThreeSavedAds(response: Response) {
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body.failures).toEqual([]);
  expect(body.creatives).toHaveLength(3);
  expect(mocks.inserts.map((row) => row.headline).sort()).toEqual(run4.angles.map((angle) => angle.concept.headline).sort());
  for (const row of mocks.inserts) {
    expect(row).toMatchObject({ status: "draft", variant_group: "6d0e7324-171e-45df-894a-28ef6c910196" });
    expect(String(row.image_url)).toMatch(/^https:\/\/core-test\.supabase\.co\/storage\/v1\/object\/public\/creatives\//);
    // #280: what the "words on the picture" editor needs to re-render without the AI.
    const generation = row.generation as { photoUrl?: string; design?: Record<string, unknown> };
    expect(generation.photoUrl).toMatch(/\/creatives\/[^/]+\/6d0e7324-171e-45df-894a-28ef6c910196\/[a-z-]+\.webp$/);
    expect(generation.design).toMatchObject({ headline: row.headline, ctaLabel: row.cta, format: "portrait" });
    expect(generation.design).not.toHaveProperty("backgroundUrl");
  }
  expect(mocks.progress.at(-1)).toMatchObject({ p_complete: true, p_uncertain: false });
  return body;
}

const valueRejectedFirst = (angle: Angle, attempt: number) => angle.angleId === "value" && attempt === 1
  // Run 4 rejected value attempt 1 (unsupported-commercial-claim); its text was not stored.
  ? JSON.stringify({ ...angle.concept, primary_text: `${angle.concept.primary_text} Results guaranteed.` })
  : recorded(angle);

describe("core: Create route on recorded run 4", () => {
  it("saves all three recorded concepts through the production creative route", async () => {
    stubProviders();
    await expectThreeSavedAds(await (await postCreate())());
    // Run 4's provider: OpenRouter, first in LLM_PROVIDER_ORDER.
    expect(textCalls("openrouter")).toHaveLength(3);
    expect(calls.filter(({ url }) => !url.includes("/images"))).toHaveLength(3);
    expect(calls.filter(({ url }) => url === "https://openrouter.ai/api/v1/images")).toHaveLength(3);
  });

  it("repairs the rejected first value concept and still saves 3/3", async () => {
    stubProviders({ text: valueRejectedFirst });
    await expectThreeSavedAds(await (await postCreate())());
    const value = textCalls("openrouter").filter(({ body }) => body.includes("Save money / value"));
    expect(value).toHaveLength(2);
    expect(value[1].body).toContain("unsupported-commercial-claim");
  });

  it("falls back to Gemini when OpenRouter is overloaded, without retrying OpenRouter's other keys", async () => {
    vi.stubEnv("OPENROUTER_API_KEYS", "core-openrouter-1,core-openrouter-2");
    stubProviders({ down: { openrouter: 503 } });
    await expectThreeSavedAds(await (await postCreate())());
    expect(textCalls("openrouter")).toHaveLength(3);
    expect(textCalls("google")).toHaveLength(3);
    expect(textCalls("groq")).toHaveLength(0);
  });

  it("fits the 270 s route deadline at run 4's recorded OpenRouter and image latencies", async () => {
    mocks.fastRaster = true;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const post = await postCreate();
    const clock = useVirtualDeadlines();
    // Run 4 was answered by OpenRouter only; the fallbacks are down so a cut-off attempt fails here too.
    stubProviders({ down: { google: 503, groq: 503 }, text: valueRejectedFirst, recordedLatency: true });
    const response = await settleInVirtualTime(post());
    const elapsed = Date.now() - clock.startedAt;
    await expectThreeSavedAds(response);
    expect(textCalls("openrouter")).toHaveLength(4);
    expect(textCalls("google")).toHaveLength(0);
    // Each concept starts once the previous one is first answered; the value repair overlaps
    // the problem concept. The critical path is value 1, problem, offer, then the offer image.
    const [value, problem, offer] = ["value", "problem", "offer"].map((id) => run4.angles.find((angle) => angle.angleId === id)!);
    const criticalPath = value.textAttempts[0].latencyMs + problem.textAttempts[0].latencyMs
      + offer.textAttempts[0].latencyMs + offer.imageLatencyMs;
    expect(elapsed).toBeGreaterThanOrEqual(criticalPath);
    expect(elapsed).toBeLessThan(run4.routeDeadlineMs);
    // Value attempt 1 took 89 s in production; every attempt deadline must allow it.
    expect(Math.min(...clock.llmAttemptDeadlines)).toBeGreaterThan(value.textAttempts[0].latencyMs);
    // #681: the batch event carries the run's own wall time and path, for the scoreboard.
    const batch = info.mock.calls.map(([entry]) => String(entry)).find((entry) => entry.includes('"name":"creative.batch"'));
    expect(JSON.parse(batch!)).toMatchObject({ outcome: "success", durationMs: elapsed, attributes: { count: 3, provider: "paid" } });
  });

  it("fits the 270 s route deadline at a 60 s attempt limit when every concept answers 1 ms before it", async () => {
    vi.stubEnv("CREATIVE_ATTEMPT_TIMEOUT_MS", "60000");
    mocks.fastRaster = true;
    const post = await postCreate();
    const clock = useVirtualDeadlines();
    stubProviders({
      down: { google: 503, groq: 503 },
      text: valueRejectedFirst,
      recordedLatency: true,
      textLatency: () => clock.llmAttemptDeadlines.at(-1)! - 1,
    });
    const response = await settleInVirtualTime(post());
    const elapsed = Date.now() - clock.startedAt;
    await expectThreeSavedAds(response);
    expect(textCalls("openrouter")).toHaveLength(4);
    expect(new Set(clock.llmAttemptDeadlines)).toEqual(new Set([60_000]));
    expect(elapsed).toBeLessThan(run4.routeDeadlineMs);
  });

  // #138: nine such runs held 1.67M of a 2M monthly allowance as "unknown usage" and blocked Create.
  // The database harness proves a settled run then keeps only its recorded usage.
  it("settles a 2/3 run with every token recorded, so its quota hold is released", async () => {
    stubProviders({ text: (angle) => angle.angleId === "value"
      ? JSON.stringify({ ...angle.concept, primary_text: `${angle.concept.primary_text} Results guaranteed.` })
      : recorded(angle) });
    const response = await (await postCreate())();
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.creatives).toHaveLength(2);
    expect(body.failures).toHaveLength(1);
    expect(mocks.progress.some((call) => call.p_uncertain)).toBe(false);
    expect(mocks.progress.at(-1)).toMatchObject({ p_complete: true, p_uncertain: false, p_failed: false });
  });

  it("uses the business's own photo as one ad's image, with no image call or image charge for it (#195)", async () => {
    mocks.ownerPhotos = [OWNER_PHOTO];
    stubProviders();
    await expectThreeSavedAds(await (await postCreate())());
    expect(calls.filter(({ url }) => url === "https://openrouter.ai/api/v1/images")).toHaveLength(2);
    const withPhoto = mocks.inserts.filter((row) => (row.generation as { ownerPhoto?: string }).ownerPhoto === OWNER_PHOTO);
    expect(withPhoto).toHaveLength(1);
    const [photoAd] = withPhoto;
    expect(photoAd.generation).toMatchObject({ image: { provider: "owner-photo", estimatedCostUsd: 0, width: 64, height: 96 }, imageAttempts: [] });
    // Only that ad's concept is told its image is the owner's unseen photo.
    const conceptCalls = textCalls("openrouter");
    expect(conceptCalls.filter(({ body }) => body.includes("\\\"imageSource\\\":\\\"owner_photo\\\""))).toHaveLength(1);
    expect(conceptCalls.find(({ body }) => body.includes("owner_photo\\\""))!.body).toContain(String(photoAd.angle));
    const imageEvents = mocks.usage.filter((event) => event.usageKind === "image");
    expect(imageEvents).toHaveLength(2);
    expect(imageEvents.every((event) => event.provider !== "owner-photo")).toBe(true);
  });

  it("generates the image as usual when the owner's photo can't be read", async () => {
    mocks.ownerPhotos = [OWNER_PHOTO];
    mocks.ownerPhotoStatus = 404;
    stubProviders();
    await expectThreeSavedAds(await (await postCreate())());
    expect(calls.filter(({ url }) => url === "https://openrouter.ai/api/v1/images")).toHaveLength(3);
    expect(mocks.inserts.every((row) => (row.generation as { ownerPhoto?: string }).ownerPhoto === null)).toBe(true);
  });
});

// #141: live Create streams each ad's stages and saved ad, then the same final response.
describe("core: Create route streams live progress on recorded run 4", () => {
  async function postStream(body: Record<string, unknown> = { businessId: run4.brand.id, brief: run4.brief, count: 3, generationId: "6d0e7324-171e-45df-894a-28ef6c910196" }) {
    const { POST } = await import("@/app/api/creatives/generate/route");
    return POST(new Request("http://localhost/api/creatives/generate", {
      method: "POST", headers: { Accept: "application/x-ndjson" }, body: JSON.stringify(body),
    }));
  }
  const order = ["queued", "writing", "checking", "fixing", "image", "ready"];

  it("sends every stage in order, each saved ad before its ready, then today's response", async () => {
    stubProviders({ text: valueRejectedFirst });
    const response = await postStream();
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = (await response.text()).split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
    const result = lines.at(-1);
    expect(lines.filter((line) => line.type === "result")).toHaveLength(1);
    expect(result).toMatchObject({ type: "result", status: 200 });
    expect(result.body.failures).toEqual([]);
    expect(result.body.creatives.map((creative: { headline: string }) => creative.headline).sort())
      .toEqual(run4.angles.map((angle) => angle.concept.headline).sort());
    expect(mocks.progress.at(-1)).toMatchObject({ p_complete: true, p_uncertain: false });

    for (const angle of run4.angles) {
      const mine = lines.filter((line) => line.angleId === angle.angleId);
      const stages = mine.filter((line) => line.type === "progress").map((line) => line.stage);
      expect(stages[0]).toBe("queued");
      expect(stages.at(-1)).toBe("ready");
      for (const stage of ["writing", "checking", "image"]) expect(stages).toContain(stage);
      for (let i = 1; i < stages.length; i += 1) {
        // A repair goes back from fixing to checking; otherwise stages only move forward.
        const repair = stages[i - 1] === "fixing" && stages[i] === "checking";
        expect(repair || order.indexOf(stages[i]) >= order.indexOf(stages[i - 1]), stages.join(",")).toBe(true);
      }
      const saved = mine.findIndex((line) => line.type === "creative");
      expect(saved).toBeGreaterThan(-1);
      expect(saved).toBeLessThan(mine.findIndex((line) => line.type === "progress" && line.stage === "ready"));
      expect(result.body.creatives).toContainEqual(mine[saved].creative);
    }
    const value = lines.filter((line) => line.angleId === "value" && line.type === "progress").map((line) => line.stage);
    expect(value).toContain("fixing");
  });

  it("answers a request rejected before admission with its normal JSON status", async () => {
    stubProviders();
    const response = await postStream({ businessId: run4.brand.id, brief: "", count: 3 });
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(mocks.inserts).toHaveLength(0);
  });

  it("keeps the page's stream alive with heartbeats through run 4's recorded 89 s concept (#666)", async () => {
    mocks.fastRaster = true;
    const { POST } = await import("@/app/api/creatives/generate/route");
    const { readCreateResponse } = await import("@/components/create-progress");
    const clock = useVirtualDeadlines();
    stubProviders({ down: { google: 503, groq: 503 }, text: valueRejectedFirst, recordedLatency: true });
    const response = await POST(new Request("http://localhost/api/creatives/generate", {
      method: "POST", headers: { Accept: "application/x-ndjson" },
      body: JSON.stringify({ businessId: run4.brand.id, brief: run4.brief, count: 3, generationId: "6d0e7324-171e-45df-894a-28ef6c910196" }),
    }));
    const [forPage, forTimes] = response.body!.tee();
    const arrivals: number[] = [];
    const reader = forTimes.getReader();
    const timed = (async () => { while (!(await reader.read()).done) arrivals.push(Date.now()); })();
    const page = readCreateResponse(new Response(forPage, { headers: response.headers }), () => {});
    const { status, data } = await settleInVirtualTime(page);
    await timed;
    expect(status).toBe(200);
    expect((data as { creatives: unknown[] }).creatives).toHaveLength(3);
    // Run 4 had silent gaps far over the page's 60 s idle limit; heartbeats keep every gap at 15 s or less.
    const times = [clock.startedAt, ...arrivals];
    const gaps = times.slice(1).map((at, i) => at - times[i]);
    expect(Date.now() - clock.startedAt).toBeGreaterThan(CREATE_IDLE_MS);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(CREATE_HEARTBEAT_MS);
  });
});

describe("core: Create validator on gold-labelled eval concepts", () => {
  it.each(evalRows.cases)("line $line (gold $gold) $verdict: $headline", async ({ verdict, headline, primary_text, cta, sourceQuotes }) => {
    const { validateConcept } = await import("@/lib/creative/concept");
    const { AD_ANGLES } = await import("@/lib/templates/ads");
    const result = validateConcept({
      headline, primary_text, cta, sourceQuotes,
      description: "See what a rooftop survey covers.",
      rationale: "Fixture wrapper: only the eval copy varies.",
      visual: { medium: "photography", direction: "A rooftop in Jaipur at golden hour with installed panels, no people, no text.", textPlacement: "top" },
      supportingText: null,
    }, { brand: evalRows.brand, brief: "Solar leads", angle: AD_ANGLES[0] });
    expect(result.success, JSON.stringify(result)).toBe(verdict === "accept");
  });
});
