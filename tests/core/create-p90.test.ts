import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import run4 from "./fixtures/create/cedar-ridge-run4.json";
import haiku from "./fixtures/create/cedar-ridge-haiku.json";
import { openAIReply, requestBody, settleInVirtualTime, useVirtualDeadlines, wait } from "./replay";

// QA (#713): Create's customer path on a virtual clock with recorded latencies only.
// Concepts: the three Claude Haiku 5.5 replies production uses today (Oct 22 recordings, the pain-point angle
// re-recorded Oct 26 for #738; three takes of it, 14.8–17.7 s). Images: gpt-image latencies by angle from
// production run 4 (13.5–14.2 s). Each take of the pain-point reply is one Create run; p90 is over those runs.
// Target (#713, #681 Create row): p90 < 30 s. Measured here: generateVariants only, so the route adds to it.
const TARGET_MS = 30_000;
const imageMs = Object.fromEntries(run4.angles.map((angle) => [angle.angleName, angle.imageLatencyMs]));
const painTakes = haiku.painPointV738.replies;
type Reply = (typeof haiku.responses)[number];
// #713 (Dev): CREATIVE_REASONING_EFFORT=low, recorded Oct 26: 3 takes × 3 angles, 8.9–13.4 s (medium: 13.2–17.7 s).
// The worst run with no repair: every angle's slowest valid take. Runs that need a repair (2 of 9 takes failed
// validation; parallel siblings can share a headline) take a second concept call and are not covered here.
const lowSlowest = haiku.responses.map(({ angleName }) =>
  haiku.byEffort.low.replies
    .filter((reply) => reply.angleName === angleName && reply.rulesAtRecording.length === 0)
    .reduce((slowest, reply) => (reply.latencyMs > slowest.latencyMs ? reply : slowest)));

let imageDelay = () => 0;
vi.mock("@/lib/imageGen", () => ({
  generateImage: async (req: { prompt: string; width: number; height: number }) => {
    await wait(imageDelay());
    return { url: "https://core-test.supabase.co/storage/v1/object/public/creatives/p90.webp", provider: "openrouter", model: "openai/gpt-image-2.5-flare", prompt: req.prompt, width: req.width, height: req.height };
  },
}));

beforeEach(() => {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    OPENROUTER_API_KEYS: "core-openrouter", GOOGLE_AI_API_KEYS: "core-google", GROQ_API_KEYS: "core-groq", CEREBRAS_API_KEYS: "",
    LLM_PROVIDER_ORDER: "openrouter,google,groq", CREATIVE_PROVIDER_ORDER: undefined, OPENROUTER_MODEL: undefined,
  })) vi.stubEnv(name, value);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const withPain = (pain: (typeof painTakes)[number]): Reply[] =>
  haiku.responses.map((reply) => reply.angleName === pain.angleName ? { ...reply, ...pain } : reply);

async function runMs(schedule: "serial" | "parallel", replies: Pick<Reply, "angleName" | "content" | "latencyMs" | "usage">[]): Promise<number> {
  vi.stubEnv("CREATIVE_CONCEPT_SCHEDULE", schedule);
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(requestBody(init));
    const reply = replies.find(({ angleName }) => body.messages[1].content.includes(angleName))!;
    await wait(reply.latencyMs);
    return openAIReply(reply.content, haiku.model, reply.usage);
  }));
  // Images are matched to their angle by the order concepts finish; every angle's image time is recorded.
  const order: string[] = [];
  imageDelay = () => imageMs[order.shift() ?? ""] ?? Math.max(...Object.values(imageMs));
  const { generateVariants } = await import("@/lib/creative/generate");
  // Not a React hook; the replay helper only shares the prefix.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { startedAt } = useVirtualDeadlines();
  const variants = await settleInVirtualTime(generateVariants({
    brand: run4.brand, brief: run4.brief, count: 3,
    onProgress: ({ angleName, stage }) => { if (stage === "image") order.push(angleName); },
  }));
  const ms = Date.now() - startedAt;
  vi.useRealTimers();
  expect(variants).toHaveLength(3);
  return ms;
}

const p90 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(0.9 * values.length) - 1];
const seconds = (runs: number[]) => `runs ${runs.map((ms) => (ms / 1000).toFixed(1)).join(", ")} s; p90 ${(p90(runs) / 1000).toFixed(1)} s`;

describe("core: Create p90 on recorded latencies (QA, #713)", () => {
  it("serial concepts (today's default) miss the 30 s target", async () => {
    const runs: number[] = [];
    for (const take of painTakes) runs.push(await runMs("serial", withPain(take)));
    expect(p90(runs), seconds(runs)).toBeGreaterThan(TARGET_MS);
  });

  it("parallel concepts at medium reasoning (today's effort) still miss it", async () => {
    const runs: number[] = [];
    for (const take of painTakes) runs.push(await runMs("parallel", withPain(take)));
    expect(p90(runs), seconds(runs)).toBeGreaterThan(TARGET_MS);
  });

  it("parallel concepts at low reasoning: a run with no repair stays under 30 s, even on the slowest takes", async () => {
    const runs = [await runMs("parallel", lowSlowest)];
    expect(p90(runs), seconds(runs)).toBeLessThan(TARGET_MS);
  });
});
