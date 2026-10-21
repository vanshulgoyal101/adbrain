import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import run4 from "./fixtures/create-cedar-ridge-run4.json";
import evalRows from "./fixtures/eval-concepts.json";
import { googleReply, openAIReply, requestBody, requestUrl, settleInVirtualTime, useVirtualDeadlines, wait } from "./replay";

// Core regression gate (#110): brief -> 3 concepts -> validation -> images -> 3 saved ads.
// Everything from the route to the AI SDK, the validator and the image provider is real;
// only the provider network, Supabase and storage are replaced.

const SUPABASE = "https://core-test.supabase.co";
const IMAGE_MODEL = "openai/gpt-image-2.5-flare";
const mocks = vi.hoisted(() => ({
  inserts: [] as Record<string, unknown>[],
  progress: [] as Record<string, unknown>[],
  fastRaster: false,
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
vi.mock("@/lib/creative/references", () => ({ creativeReferences: async () => [], recentCreativeCopy: async () => [] }));
vi.mock("@/lib/preferences/store", () => ({ preferenceContext: async () => "" }));
vi.mock("@/lib/creative/persist", () => ({
  persistCreativeImage: async (_client: unknown, businessId: string, group: string, angle: string) =>
    `${SUPABASE}/storage/v1/object/public/creatives/${businessId}/${group}/${angle}.webp`,
  renderAndPersistDesign: async (_client: unknown, _businessId: string, _group: string, _angle: string, _design: unknown, photoUrl: string) => photoUrl,
}));
vi.mock("@/lib/llm/persist", () => ({
  configuredMonthlyTokenLimit: () => 0,
  monthlyTokenUsage: async () => 0,
  persistLLMUsage: async () => true,
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
type Replay = {
  provider?: "google" | "openrouter";
  /** Text for the given 1-based attempt of an angle. */
  text?: (angle: Angle, attempt: number) => string;
  textLatency?: (angle: Angle, attempt: number) => number;
  googleStatus?: number;
};

let png: string;
let calls: { url: string; body: string }[];

beforeAll(async () => {
  png = (await sharp({ create: { width: 64, height: 96, channels: 3, background: "#74A7FE" } }).png().toBuffer()).toString("base64");
});

beforeEach(() => {
  vi.resetModules();
  mocks.inserts.length = 0;
  mocks.progress.length = 0;
  mocks.fastRaster = false;
  calls = [];
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    GOOGLE_AI_API_KEYS: "core-google",
    OPENROUTER_API_KEYS: "core-openrouter",
    GROQ_API_KEYS: "core-groq",
    CEREBRAS_API_KEYS: "",
    // Production values; CREATIVE_PROVIDER_ORDER is unset there, so the code default applies.
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
    if (url.startsWith("https://generativelanguage.googleapis.com/") || url === "https://openrouter.ai/api/v1/chat/completions") {
      const provider = url.startsWith("https://generativelanguage") ? "google" : "openrouter";
      if (provider === "google" && replay.googleStatus) return Response.json({ error: { code: replay.googleStatus, message: "Unavailable", status: "UNAVAILABLE" } }, { status: replay.googleStatus });
      const angle = angleFor(body);
      const attempt = (attempts.get(angle.angleId) ?? 0) + 1;
      attempts.set(angle.angleId, attempt);
      const usage = angle.textAttempts[Math.min(attempt, angle.textAttempts.length) - 1];
      if (replay.textLatency) await wait(replay.textLatency(angle, attempt), init?.signal);
      const reply = text(angle, attempt);
      const tokens = { prompt: usage.promptTokens, completion: usage.completionTokens };
      return provider === "google" ? googleReply(reply, tokens) : openAIReply(reply, "qwen/qwen3.8-max-0902", tokens);
    }
    if (url === `https://openrouter.ai/api/v1/images/models/${IMAGE_MODEL}/endpoints`) {
      return Response.json({ endpoints: [{ provider_tag: "openai", supported_parameters: {
        aspect_ratio: { values: ["1:1", "2:3", "3:2"] }, quality: { values: ["low", "medium", "high"] },
        resolution: { values: ["1K", "2K"] }, output_format: { values: ["png", "jpeg", "webp"] }, input_references: { max: 16 },
      } }] });
    }
    if (url === "https://openrouter.ai/api/v1/images") {
      const angle = run4.angles.find((candidate) => body.includes(JSON.stringify(candidate.concept.visual.direction.slice(0, 80)).slice(1, -1)));
      if (replay.textLatency) {
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
  }
  expect(mocks.progress.at(-1)).toMatchObject({ p_complete: true, p_uncertain: false });
  return body;
}

describe("Create core loop (recorded run 4)", () => {
  it("saves all three recorded concepts through the production creative route", async () => {
    stubProviders();
    await expectThreeSavedAds(await (await postCreate())());
    const text = calls.filter(({ url }) => !url.includes("/images"));
    expect(text).toHaveLength(3);
    expect(text.every(({ url }) => url.startsWith("https://generativelanguage.googleapis.com/"))).toBe(true);
    expect(calls.filter(({ url }) => url === "https://openrouter.ai/api/v1/images")).toHaveLength(3);
  });

  it("repairs the rejected first value concept and still saves 3/3", async () => {
    stubProviders({
      // Run 4 rejected value attempt 1 (unsupported-commercial-claim); its text was not stored.
      text: (angle, attempt) => angle.angleId === "value" && attempt === 1
        ? JSON.stringify({ ...angle.concept, primary_text: `${angle.concept.primary_text} Results guaranteed.` })
        : recorded(angle),
    });
    await expectThreeSavedAds(await (await postCreate())());
    const value = calls.filter(({ url, body }) => url.includes("generativelanguage") && body.includes("Save money / value"));
    expect(value).toHaveLength(2);
    expect(value[1].body).toContain("unsupported-commercial-claim");
  });

  it("falls back to OpenRouter with the recorded responses when Gemini is unavailable", async () => {
    stubProviders({ googleStatus: 503 });
    await expectThreeSavedAds(await (await postCreate())());
    expect(calls.filter(({ url }) => url === "https://openrouter.ai/api/v1/chat/completions")).toHaveLength(3);
  });

  it("fits the 270 s route deadline when every text attempt runs to its attempt deadline", async () => {
    mocks.fastRaster = true;
    const post = await postCreate();
    const clock = useVirtualDeadlines();
    stubProviders({
      text: (angle, attempt) => angle.angleId === "value" && attempt === 1
        ? JSON.stringify({ ...angle.concept, primary_text: `${angle.concept.primary_text} Results guaranteed.` })
        : recorded(angle),
      // Recorded run-4 text latencies (64-89 s) exceed the current 45 s attempt deadline and no
      // Gemini Create latency is recorded yet, so each attempt answers 1 ms inside the deadline
      // the code requests: the slowest the code allows. Raising that deadline is caught here.
      textLatency: () => clock.llmAttemptDeadlines.at(-1)! - 1,
    });
    const response = await settleInVirtualTime(post());
    const elapsed = Date.now() - clock.startedAt;
    await expectThreeSavedAds(response);
    // Three concepts plus the value repair, each answering 1 ms inside the same deadline.
    expect(clock.llmAttemptDeadlines).toHaveLength(4);
    expect(new Set(clock.llmAttemptDeadlines).size).toBe(1);
    // Value repair overlaps the problem concept, then offer runs, then the offer image.
    const offer = run4.angles.find((angle) => angle.angleId === "offer")!;
    expect(elapsed).toBeGreaterThanOrEqual(3 * (clock.llmAttemptDeadlines[0] - 1) + offer.imageLatencyMs);
    expect(elapsed).toBeLessThan(run4.routeDeadlineMs);
  });
});

describe("Create validator on eval fixtures", () => {
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
