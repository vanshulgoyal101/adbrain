import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import run4 from "./fixtures/create/cedar-ridge-run4.json";
import recorded from "./fixtures/images/pollinations-busy-batch.json";
import { requestUrl, settleInVirtualTime, useVirtualDeadlines } from "./replay";

// #2378 (CTO): on free pictures alone a 3-ad Create saved 1 of 3 (production request 32b92b65): one picture busied out
// past the 90 s cap, the queue parked (#2153) and the third failed at once. An ad whose free picture busies out now
// reuses a sibling's picture under its own copy, $0, marked `batch_reuse`. Concepts are run 4's recorded ones (no text
// call); image code, the free queue and its park are real; the network replays Pollinations' recorded busy reply.

const INTERNAL = { id: "6c1f4f0e-5a43-4c55-9b1f-3f7a3f0c2a10", email: "qa@adbrain.vanshul.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
let png: Buffer;
vi.mock("@/lib/imageGen/raster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/imageGen/raster")>();
  const isPng = (bytes: Uint8Array) => bytes[0] === 0x89 && bytes[1] === 0x50;
  return { ...actual, validateRaster: async (bytes: Uint8Array) => (isPng(bytes)
    ? { bytes, contentType: "image/png", width: 1024, height: 1536 } : actual.validateRaster(bytes)) };
});

beforeEach(async () => {
  vi.resetModules();
  png ??= await sharp({ create: { width: 1024, height: 1536, channels: 3, background: "#d9e3dc" } }).png().toBuffer();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    OPENROUTER_API_KEYS: "core-openrouter",
    IMAGE_PROVIDER: "openrouter",
    IMAGE_PROVIDER_FALLBACK: "none",
  })) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const busy = () => new Response(recorded.busy.body, { status: recorded.busy.status });
const picture = () => new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });

/** Pollinations answers in queue order: `answers[n]` for its n-th request, the last one from then on. */
function pollinations(answers: (() => Response)[]) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(requestUrl(input));
    if (url.hostname !== "image.pollinations.ai") throw new Error(`Unexpected request to ${url.hostname}${url.pathname}`);
    calls.push(url.pathname);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    return answers[Math.min(calls.length - 1, answers.length - 1)]();
  }));
  return calls;
}

async function create() {
  const { generateVariants } = await import("@/lib/creative/generate");
  const { eventContext, newEventContext, observeVerifiedUser } = await import("@/lib/observability/context");
  const failures: string[] = [];
  const saved: string[] = [];
  const variants = await settleInVirtualTime(eventContext.run(newEventContext(), () => {
    observeVerifiedUser(INTERNAL);
    return generateVariants({
      brand: run4.brand as never, brief: run4.brief, angleIds: run4.angles.map((angle) => angle.angleId), count: 3,
      concepts: Object.fromEntries(run4.angles.map((angle) => [angle.angleId, angle.concept])) as never,
      onVariant: async (variant) => { saved.push(variant.angleId); },
      onFailure: async (angle, error) => { failures.push(`${angle.id}: ${(error as Error).message}`); },
    });
  }));
  return { variants, failures, saved };
}

describe("core: a free picture that busies out reuses a sibling's picture (#2378)", () => {
  it("saves 3 of 3 on the recorded batch (1 made, 2 busy): 2 marked batch_reuse at $0, each with its own words", async () => {
    const calls = pollinations([picture, busy]);
    useVirtualDeadlines();
    const { variants, failures, saved } = await create();
    expect(failures).toEqual([]);
    expect(saved.sort()).toEqual(["offer", "problem", "value"]);
    const made = variants.filter((v) => v.imageUsage.fallbackFrom !== "batch_reuse");
    const reused = variants.filter((v) => v.imageUsage.fallbackFrom === "batch_reuse");
    expect(made).toHaveLength(1);
    expect(reused).toHaveLength(2);
    // The production shape: one picture made, the next busy past the cap (it parks the queue), the third busy at once.
    const attempts = variants.flatMap((v) => v.imageAttempts ?? []).map(({ provider, status, errorCode }) => ({ provider, status, ...(errorCode ? { errorCode } : {}) }));
    expect(attempts.sort((a, b) => a.status.localeCompare(b.status))).toEqual([...recorded.batch].sort((a, b) => a.status.localeCompare(b.status)));
    for (const ad of reused) {
      const own = run4.angles.find((angle) => angle.angleId === ad.angleId)!.concept;
      expect(ad).toMatchObject({ headline: own.headline, primaryText: own.primary_text, cta: own.cta, imageUrl: made[0].imageUrl, llmUsage: [] });
      expect(ad.imageUsage).toEqual({ provider: "pollinations", model: made[0].imageUsage.model, estimatedCostUsd: 0, width: 1024, height: 1536, fallbackFrom: "batch_reuse" });
      expect(ad.design.backgroundUrl).toBe(made[0].imageUrl);
      expect(ad.design.headline ?? ad.headline).toBe(own.headline);
    }
    // No picture is asked for again once the queue parks: 1 made + the busy one's waits up to the 90 s cap.
    expect(calls.length).toBeLessThanOrEqual(8);
  });

  it("still fails an ad whose picture fails for another reason (Pollinations down), as before", async () => {
    pollinations([picture, () => new Response("Bad gateway", { status: 502 })]);
    useVirtualDeadlines();
    const { variants, failures } = await create();
    expect(variants).toHaveLength(1);
    expect(variants[0].imageUsage.fallbackFrom).toBeUndefined();
    expect(failures).toHaveLength(2);
  });

  it("fails as before when no picture in the batch was made", async () => {
    pollinations([busy]);
    useVirtualDeadlines();
    const { variants, failures } = await create();
    expect(variants).toEqual([]);
    expect(failures).toHaveLength(3);
  });
});
