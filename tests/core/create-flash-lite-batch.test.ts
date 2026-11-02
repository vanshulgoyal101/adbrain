import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import evalCases from "../eval/cases.json";
import { googleReply, requestBody, requestUrl } from "./replay";

// #2542 (#2444 slice B): whole three-ad batches on production's free text model (gemini-3.5-flash-lite), first replies and
// repair replies as flash-lite wrote them, replayed through the real concept validators and repair turn. The saved count
// is a ratchet: a change to the prompt, validators or repair can only keep it or raise it.
// Re-record (text only, $0, at most 40 calls; never in CI):
//   env $(grep '^GOOGLE_AI_API_KEYS=' <owner checkout>/.env.local | xargs) RECORD_FLASH_LITE_BATCH=1 \
//     npx vitest run tests/core/create-flash-lite-batch.test.ts
// then set SAVED_FLOOR to the new total if it went up. FLASH_LITE_BATCH_REPORT=1 (with --silent=false) prints the per-batch rule table.
const FIXTURE = fileURLToPath(new URL("./fixtures/gemini/flash-lite-batch-replies.json", import.meta.url));
const RECORD = process.env.RECORD_FLASH_LITE_BATCH === "1";
const MODEL = "gemini-3.5-flash-lite";
const PLAN = ["cedar-ridge-en", "cedar-ridge-en", "cedar-ridge-en", "solaride-factory-hi", "solaride-factory-hi"];
const MAX_CALLS = 40;
const SAVED_FLOOR = 14;

type Call = { angle: string; attempt: number; status: number; text: string };
type Batch = { case: string; calls: Call[] };
type Fixture = { note: string; recordedAt: string; model: string; schedule: string; batches: Batch[] };

vi.mock("@/lib/imageGen", () => ({
  generateImage: async (req: { prompt: string; width: number; height: number }) => ({
    url: "https://core-test.supabase.co/storage/v1/object/public/creatives/batch.webp", provider: "cloudflare",
    model: "flux", prompt: req.prompt, width: req.width, height: req.height,
  }),
}));

beforeEach(() => {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    OPENROUTER_API_KEYS: "", GROQ_API_KEYS: "", CEREBRAS_API_KEYS: "",
    GOOGLE_AI_API_KEYS: RECORD ? process.env.GOOGLE_AI_API_KEYS ?? "" : "core-google",
    LLM_PROVIDER_ORDER: "google", CREATIVE_PROVIDER_ORDER: "google", GEMINI_MODEL: MODEL,
    // Production since Nov 1 (#2444, CTO): concepts one after another; a repair lets the next angle start.
    CREATIVE_CONCEPT_SCHEDULE: "serial",
  })) vi.stubEnv(name, value);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

type Turn = { role: string; parts: { text?: string; thought?: boolean }[] };
/** A request's angle (from the brief JSON in its first turn) and attempt (a repair adds turns after it). */
function callKey(contents: Turn[]) {
  const brief = JSON.parse(contents[0].parts.map((part) => part.text ?? "").join("")) as { angle: { name: string } };
  return { angle: brief.angle.name, attempt: contents.length > 1 ? 1 : 0 };
}

const realFetch = globalThis.fetch;
let budget = MAX_CALLS;
async function runBatch(caseId: string, recorded?: Batch) {
  const item = evalCases.cases.find((entry) => entry.id === caseId)!;
  const calls: Call[] = [];
  const missing: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(requestUrl(input));
    if (url.hostname !== "generativelanguage.googleapis.com") throw new Error(`Unexpected request to ${url.hostname}${url.pathname}`);
    expect(url.pathname).toContain(MODEL);
    const key = callKey(JSON.parse(requestBody(init)).contents);
    if (RECORD) {
      if (budget-- <= 0) throw new Error(`#2542: over the ${MAX_CALLS}-call recording budget`);
      const response = await realFetch(input, init);
      const body = await response.clone().text();
      const text = response.ok
        ? ((JSON.parse(body) as { candidates?: { content?: Turn }[] }).candidates?.[0]?.content?.parts ?? [])
          .filter((part) => !part.thought).map((part) => part.text ?? "").join("")
        : body;
      calls.push({ ...key, status: response.status, text });
      return response;
    }
    const reply = recorded!.calls.find((call) => call.angle === key.angle && call.attempt === key.attempt);
    if (!reply) {
      missing.push(`${key.angle}#${key.attempt}`);
      return new Response(JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "not recorded" } }), { status: 503 });
    }
    calls.push(reply);
    return reply.status === 200 ? googleReply(reply.text) : new Response(reply.text, { status: reply.status });
  }));
  const { generateVariants } = await import("@/lib/creative/generate");
  const rules: string[] = [];
  const failed: string[] = [];
  const variants = await generateVariants({
    brand: item.brand, brief: item.brief, language: item.language, sourceFacts: item.sourceFacts, count: 3,
    onFailure: async (angle, error) => {
      failed.push(angle.id);
      for (const entry of (error as { usage?: { validation?: { rules: string[] } }[] }).usage ?? []) rules.push(...entry.validation?.rules ?? []);
    },
  });
  for (const variant of variants) for (const entry of variant.llmUsage) rules.push(...entry.validation?.rules ?? []);
  return { case: caseId, saved: variants.length, failed, rules, calls, missing };
}

function report(results: Awaited<ReturnType<typeof runBatch>>[]) {
  const lines = ["| batch | case | saved | calls | rule hits |", "| --- | --- | --- | --- | --- |"];
  results.forEach((result, index) => {
    const hits = Object.entries(result.rules.reduce<Record<string, number>>((all, rule) => ({ ...all, [rule]: (all[rule] ?? 0) + 1 }), {}))
      .map(([rule, count]) => `${rule} ×${count}`).join(", ") || "none";
    lines.push(`| ${index + 1} | ${result.case} | ${result.saved}/3 | ${result.calls.length} | ${hits} |`);
  });
  const saved = results.reduce((sum, result) => sum + result.saved, 0);
  lines.push(`| total | | ${saved}/${results.length * 3} | ${results.reduce((sum, result) => sum + result.calls.length, 0)} | |`);
  return lines.join("\n");
}

describe("core: recorded flash-lite three-ad batches keep their saved count (#2542)", () => {
  it.runIf(RECORD)("records five batches from flash-lite (text only, never in CI)", { timeout: 900_000 }, async () => {
    const results = [];
    for (const caseId of PLAN) results.push(await runBatch(caseId));
    const fixture: Fixture = {
      note: "#2542: gemini-3.5-flash-lite concept replies (first tries and repairs) for whole three-ad batches of the eval gate cases, serial schedule, no recent ads. Re-record with RECORD_FLASH_LITE_BATCH=1 (see the test).",
      recordedAt: new Date().toISOString(), model: MODEL, schedule: "serial",
      batches: results.map((result) => ({ case: result.case, calls: result.calls })),
    };
    writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
    console.log(report(results));
  });

  it.skipIf(RECORD)("replays every recorded batch through the real validators and repair, at or above the floor", async () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as Fixture;
    expect(fixture.model).toBe(MODEL);
    expect(fixture.batches.length).toBeGreaterThanOrEqual(5);
    const results = [];
    for (const batch of fixture.batches) results.push(await runBatch(batch.case, batch));
    if (process.env.FLASH_LITE_BATCH_REPORT === "1") console.log(report(results));

    // A request the recording has no reply for means the code now asks flash-lite something new: re-record.
    expect(results.flatMap((result) => result.missing)).toEqual([]);
    expect(results.reduce((sum, result) => sum + result.saved, 0)).toBeGreaterThanOrEqual(SAVED_FLOOR);
  });
});
