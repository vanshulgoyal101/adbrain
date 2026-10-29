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
const SECOND_PHOTO = `${SUPABASE}/storage/v1/object/public/brand-assets/cedar-ridge/treatment-room.jpg`;
const IMAGE_MODEL = "openai/gpt-image-2.5-flare";
const mocks = vi.hoisted(() => ({
  inserts: [] as Record<string, unknown>[],
  progress: [] as Record<string, unknown>[],
  fastRaster: false,
  ownerPhotos: [] as string[],
  ownerPhotoStatus: 200,
  usage: [] as Record<string, unknown>[],
  planGate: null as null | { status: 402; code: "PLAN_UNPAID"; error: string },
}));
vi.mock("@/lib/plan/gate", () => ({ planGate: async () => mocks.planGate }));

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
vi.mock("@/lib/llm/persist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm/persist")>()),
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
  /** The image endpoint answers with this HTTP status instead of an image. */
  imageStatus?: number;
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
  mocks.planGate = null;
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
    if (url === OWNER_PHOTO || url === SECOND_PHOTO) {
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
    if (url === "https://openrouter.ai/api/v1/images" && replay.imageStatus) {
      return Response.json({ error: { message: "Provider returned error", code: replay.imageStatus } }, { status: replay.imageStatus });
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

  // #718: an unpaid own-account plan stops a new batch before any AI spend; paid or exempt is untouched (above).
  it("refuses a new batch with the plan's reason, before any provider call or saved row, when the plan is unpaid", async () => {
    stubProviders();
    mocks.planGate = { status: 402, code: "PLAN_UNPAID", error: "Your ₹999 plan payment is due. Running ads keep running. Pay in Settings to make new ads and campaigns." };
    const response = await (await postCreate())();
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ code: "PLAN_UNPAID", error: mocks.planGate.error });
    expect(calls).toEqual([]);
    expect(mocks.inserts).toEqual([]);
    expect(mocks.progress).toEqual([]);
  });

  it("repairs the rejected first value concept and still saves 3/3", async () => {
    stubProviders({ text: valueRejectedFirst });
    await expectThreeSavedAds(await (await postCreate())());
    const value = textCalls("openrouter").filter(({ body }) => body.includes("Save money / value"));
    expect(value).toHaveLength(2);
    expect(value[1].body).toContain("unsupported-commercial-claim");
    // #687: the refused attempt's usage row says which kind of claim failed and why.
    const refused = mocks.usage.find((row) => (row.metadata as { validationRules?: string[] } | undefined)?.validationRules?.includes("unsupported-commercial-claim"));
    expect((refused!.metadata as { validationRules: string[] }).validationRules).toContain("claim:guarantee:uncited");
  });

  it("falls back to Gemini when OpenRouter is overloaded, without retrying OpenRouter's other keys", async () => {
    vi.stubEnv("OPENROUTER_API_KEYS", "core-openrouter-1,core-openrouter-2");
    stubProviders({ down: { openrouter: 503 } });
    await expectThreeSavedAds(await (await postCreate())());
    expect(textCalls("openrouter")).toHaveLength(3);
    expect(textCalls("google")).toHaveLength(3);
    expect(textCalls("groq")).toHaveLength(0);
  });

  // #687: a failed ad's usage rows name what failed. Production had provider 503/429s logged as
  // CreativeValidationError, and passed copy logged as CreativeImageError when only its image failed.
  it("logs each refused provider attempt with its own code, never as a validation failure (#687)", async () => {
    stubProviders({ down: { openrouter: 503, google: 429, groq: 429 } });
    const response = await (await postCreate())();
    expect(response.status).not.toBe(200);
    expect(mocks.inserts).toHaveLength(0);
    const text = mocks.usage.filter((row) => row.route === "creatives.generate" && row.usageKind !== "image");
    expect(text.length).toBeGreaterThanOrEqual(3);
    expect(new Set(text.map((row) => row.errorCode))).toEqual(new Set(["LLM_HTTP_503", "LLM_HTTP_429"]));
  });

  it("leaves run 4's passed copy uncoded when only the image fails, and codes the image (#687)", async () => {
    stubProviders({ imageStatus: 500 });
    await (await postCreate())();
    const rows = mocks.usage.filter((row) => row.route === "creatives.generate");
    const text = rows.filter((row) => row.usageKind !== "image");
    const images = rows.filter((row) => row.usageKind === "image");
    expect(text.length).toBeGreaterThanOrEqual(3);
    expect(text.map((row) => [row.status, row.errorCode])).toEqual(text.map(() => ["success", undefined]));
    expect(images.length).toBeGreaterThanOrEqual(3);
    for (const row of images) expect(row).toMatchObject({ status: "error", errorCode: expect.stringMatching(/^IMAGE_/) });
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
    // #1468: the run's estimated AI cost, from the same usage rows it saved.
    const { attributes } = JSON.parse(batch!) as { attributes: { costUsd: number; textCostUsd: number; imageCostUsd: number } };
    expect(attributes.textCostUsd).toBeGreaterThan(0);
    expect(attributes.costUsd).toBeCloseTo(attributes.textCostUsd + attributes.imageCostUsd, 6);
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

  // #1123: a batch that saves fewer than asked remakes the missing ads once, in the same request.
  const rejected = (angle: Angle) => JSON.stringify({ ...angle.concept, primary_text: `${angle.concept.primary_text} Results guaranteed.` });
  const batchEvent = (info: { mock: { calls: unknown[][] } }) =>
    JSON.parse(info.mock.calls.map(([entry]) => String(entry)).find((entry) => entry.includes('"name":"creative.batch"'))!);
  const valueCalls = () => textCalls("openrouter").filter(({ body }) => body.includes("Save money / value"));

  it("tops up the two ads the first pass missed and saves 3/3 in the same streamed request (#1123)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    // Value and problem fail their concept and its one repair; their top-up concepts pass.
    stubProviders({ text: (angle, attempt) => angle.angleId !== "offer" && attempt <= 2 ? rejected(angle) : recorded(angle) });
    const { POST } = await import("@/app/api/creatives/generate/route");
    const response = await POST(new Request("http://localhost/api/creatives/generate", {
      method: "POST", headers: { Accept: "application/x-ndjson" },
      body: JSON.stringify({ businessId: run4.brand.id, brief: run4.brief, count: 3, generationId: "6d0e7324-171e-45df-894a-28ef6c910196" }),
    }));
    const lines = (await response.text()).split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
    const topUp = lines.findIndex((line) => line.type === "topUp");
    expect(lines.filter((line) => line.type === "topUp")).toEqual([{ type: "topUp", missing: 2 }]);
    // Announced after both first attempts failed, before the remade ads arrive.
    for (const id of ["value", "problem"]) {
      expect(lines.findIndex((line) => line.angleId === id && line.stage === "failed")).toBeLessThan(topUp);
      expect(lines.findIndex((line) => line.angleId === id && line.type === "creative")).toBeGreaterThan(topUp);
    }
    const result = lines.at(-1);
    expect(result).toMatchObject({ type: "result", status: 200, body: { failures: [] } });
    expect(result.body.creatives).toHaveLength(3);
    expect(mocks.inserts.map((row) => row.headline).sort()).toEqual(run4.angles.map((angle) => angle.concept.headline).sort());
    // Offer 1 call; value and problem 2 each in the first pass and 1 each in the top-up.
    expect(textCalls("openrouter")).toHaveLength(7);
    expect(calls.filter(({ url }) => url === "https://openrouter.ai/api/v1/images")).toHaveLength(3);
    expect(mocks.progress.at(-1)).toMatchObject({ p_complete: true, p_uncertain: false });
    expect(batchEvent(info)).toMatchObject({ outcome: "success", attributes: { count: 3, failedCount: 0, topUp: 2 } });
  });

  it("says 2 of 3 honestly when the top-up also fails (#1123)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    stubProviders({ text: (angle) => angle.angleId === "value" ? rejected(angle) : recorded(angle) });
    const response = await (await postCreate())();
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.creatives).toHaveLength(2);
    expect(body.failures).toEqual([{ angle: "Save money / value", error: expect.any(String) }]);
    // One concept and one repair per round, and only one top-up round.
    expect(valueCalls()).toHaveLength(4);
    expect(mocks.inserts).toHaveLength(2);
    expect(batchEvent(info)).toMatchObject({ outcome: "partial", attributes: { count: 2, failedCount: 1, topUp: 1 } });
  });

  it("does not top up when every provider is down (#1123)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    stubProviders({ down: { openrouter: 503, google: 503, groq: 503 } });
    const response = await (await postCreate())();
    expect(response.status).toBe(502);
    expect(textCalls("openrouter")).toHaveLength(3);
    expect(batchEvent(info)).toMatchObject({ outcome: "failed", attributes: { count: 0, failedCount: 3, topUp: 0 } });
  });

  it("cuts the top-up off at its 45 s budget and returns what was saved (#1123)", async () => {
    mocks.fastRaster = true;
    const post = await postCreate();
    const clock = useVirtualDeadlines();
    stubProviders({
      down: { google: 503, groq: 503 },
      text: (angle) => angle.angleId === "value" ? rejected(angle) : recorded(angle),
      // The first pass answers in 1 s; the top-up's value concept would take 50 s.
      textLatency: () => valueCalls().length >= 3 ? 50_000 : 1_000,
    });
    const response = await settleInVirtualTime(post());
    const elapsed = Date.now() - clock.startedAt;
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.creatives).toHaveLength(2);
    expect(body.failures).toHaveLength(1);
    expect(valueCalls()).toHaveLength(3);
    // The first pass takes 3 s (each concept starts once the one before answers), then the 45 s budget.
    expect(elapsed).toBe(3_000 + 45_000);
  });

  it("does not start a top-up once the first pass ran past 60 s (#1123)", async () => {
    mocks.fastRaster = true;
    const post = await postCreate();
    useVirtualDeadlines();
    stubProviders({
      down: { google: 503, groq: 503 },
      text: (angle) => angle.angleId === "value" ? rejected(angle) : recorded(angle),
      textLatency: () => 31_000,
    });
    const response = await settleInVirtualTime(post());
    const body = await response.json();
    expect(body.creatives).toHaveLength(2);
    expect(valueCalls()).toHaveLength(2);
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

  it("#1901: with two owner photos, two ads each use a different one and only the third makes an AI picture", async () => {
    mocks.ownerPhotos = [OWNER_PHOTO, SECOND_PHOTO];
    stubProviders();
    await expectThreeSavedAds(await (await postCreate())());
    expect(calls.filter(({ url }) => url === "https://openrouter.ai/api/v1/images")).toHaveLength(1);
    const photosUsed = mocks.inserts.map((row) => (row.generation as { ownerPhoto?: string | null }).ownerPhoto ?? null);
    expect(photosUsed.filter(Boolean).sort()).toEqual([OWNER_PHOTO, SECOND_PHOTO].sort());
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
