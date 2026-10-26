import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/create/solaride-regenerate.json";
import { parseJSON } from "@/lib/llm";
import { openAIReply, requestBody, requestUrl } from "./replay";

// #281 (CTO, Oct 24): a headline over the 40-character limit or a shortened quote gets one retry
// with the exact error fed back, then a plain 422 that keeps the ad. Replays the real recorded
// Solaride replies (solaride-regenerate.json); the route, generation loop and fact check are real.

const CREATIVE = "f5727105-521b-49a0-bb67-8905e2225acd";
const [current, ...recent] = recorded.recentCopy;
const reply = (index: number) => recorded.replies[index].content;
const concept = (content: string) => parseJSON<{ headline: string; sourceQuotes: string[] }>(content);
// Real replies from the recording: #1 passes every check, #3 has a 42-character headline,
// #4 cites a shortened quote of the Brand's source fact.
const VALID = reply(1);
const LONG_HEADLINE = reply(3);
const SHORTENED_QUOTE = reply(4);
const LONG = "Don't Let the 31 Dec Hike Hit Your Factory";
const SHORTENED = "the cost of the solar installation will go more than 10,000 rupees per kilowatt";

const mocks = vi.hoisted(() => ({
  claims: new Map<string, { attempt: string; state: "processing" | "unresolved" }>(),
  updates: [] as Record<string, unknown>[],
  usage: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: { p_creative_id: string; p_attempt_id: string; p_unresolved?: boolean }) => {
      const claim = mocks.claims.get(args.p_creative_id);
      if (name === "creative_regeneration_claim") {
        if (claim) return { data: { action: "busy", status: claim.state }, error: null };
        mocks.claims.set(args.p_creative_id, { attempt: args.p_attempt_id, state: "processing" });
        return { data: { action: "start" }, error: null };
      }
      if (name === "creative_regeneration_finish") {
        if (!claim || claim.attempt !== args.p_attempt_id || claim.state !== "processing") return { data: { status: "missing" }, error: null };
        if (args.p_unresolved) claim.state = "unresolved";
        else mocks.claims.delete(args.p_creative_id);
        return { data: { status: args.p_unresolved ? "unresolved" : "released" }, error: null };
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
        eq: () => ({
          maybeSingle: async () => ({
            data: table === "creatives" ? {
              id: CREATIVE, business_id: "solaride", angle: recorded.angle, brief: recorded.brief, status: "approved",
              headline: current.headline, primary_text: current.primary_text, variant_group: null,
              generation: { format: recorded.format, language: recorded.language, sourceFacts: recorded.sourceFacts },
            } : { id: "solaride", ...recorded.brand },
            error: null,
          }),
        }),
        limit: async () => ({ error: null }),
      }),
      update: (row: Record<string, unknown>) => {
        mocks.updates.push(row);
        return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: CREATIVE, ...row }, error: null }) }) }) };
      },
    }),
  }),
}));
vi.mock("@/lib/supabase/queries", () => ({ getActiveInstructionsText: async () => recorded.instructions }));
vi.mock("@/lib/creative/references", () => ({ creativeReferences: async () => [], recentCreativeCopy: async () => recent }));
vi.mock("@/lib/preferences/store", () => ({ preferenceContext: async () => "" }));
vi.mock("@/lib/creative/persist", () => ({
  persistCreativeImage: async () => "https://core-test.supabase.co/storage/v1/object/public/creatives/photo.webp",
  renderAndPersistDesign: async () => "https://core-test.supabase.co/storage/v1/object/public/creatives/final.webp",
}));
vi.mock("@/lib/imageGen", () => ({
  generateImage: async (req: { prompt: string; width: number; height: number }) => ({
    url: "https://core-test.supabase.co/storage/v1/object/public/creatives/background.webp",
    provider: "openrouter", model: "openai/gpt-image-2.5-flare", prompt: req.prompt, width: req.width, height: req.height,
  }),
}));
vi.mock("@/lib/llm/persist", () => ({
  configuredMonthlyTokenLimit: () => 0,
  monthlyTokenUsage: async () => 0,
  persistLLMUsage: async (events: Record<string, unknown>[]) => { mocks.usage.push(...events); return true; },
}));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/audit", () => ({ logEvent: async () => {} }));

/** The last user message of each text request, in order. */
let prompts: string[] = [];
function replay(...replies: string[]) {
  const queue = [...replies];
  vi.stubGlobal("fetch", vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
    expect(requestUrl(request)).toBe("https://openrouter.ai/api/v1/chat/completions");
    const messages = (JSON.parse(requestBody(init)) as { messages: { role: string; content: unknown }[] }).messages;
    prompts.push(String(messages.filter(({ role }) => role === "user").at(-1)?.content ?? ""));
    const content = queue.shift();
    if (content === undefined) throw new Error("No recorded reply left for this request.");
    return openAIReply(content, "anthropic/claude-haiku-5.5");
  }));
}

async function regenerate() {
  const { POST } = await import("@/app/api/creatives/[id]/regenerate/route");
  const response = await POST(new Request(`http://localhost/api/creatives/${CREATIVE}/regenerate`, { method: "POST" }),
    { params: Promise.resolve({ id: CREATIVE }) });
  return { status: response.status, body: await response.json() as { creative?: Record<string, unknown>; error?: string } };
}

beforeEach(() => {
  mocks.claims.clear();
  mocks.updates.length = 0;
  mocks.usage.length = 0;
  prompts = [];
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    OPENROUTER_API_KEYS: "core-openrouter",
    GOOGLE_AI_API_KEYS: "",
    GROQ_API_KEYS: "",
    CEREBRAS_API_KEYS: "",
    LLM_PROVIDER_ORDER: "openrouter,google,groq",
    CREATIVE_PROVIDER_ORDER: undefined,
    OPENROUTER_MODEL: undefined,
  })) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("core: Regenerate retries a recorded over-long headline once, then a plain 422 (#281)", () => {
  it("uses the recorded 42-character headline", () => {
    expect(concept(LONG_HEADLINE).headline).toBe(LONG);
    expect(LONG).toHaveLength(42);
  });

  it("makes exactly one retry and saves it when the retry fixes the headline", async () => {
    replay(LONG_HEADLINE, VALID);
    const { status, body } = await regenerate();
    expect(status, JSON.stringify(body)).toBe(200);
    expect(prompts).toHaveLength(2);
    expect(mocks.updates).toEqual([expect.objectContaining({ headline: concept(VALID).headline })]);
    expect(mocks.claims.size).toBe(0);
  });

  it("feeds the headline error and the 40-character limit back to the retry", async () => {
    replay(LONG_HEADLINE, VALID);
    await regenerate();
    expect(prompts[1]).toMatch(/headline/i);
    expect(prompts[1]).toContain("40");
  });

  it("tells the retry the headline's actual length, so the model knows how much to cut", async () => {
    replay(LONG_HEADLINE, VALID);
    await regenerate();
    expect(prompts[1]).toContain("42");
  });

  it("stops after one retry with a plain 422 that keeps the ad and frees the claim", async () => {
    replay(LONG_HEADLINE, LONG_HEADLINE);
    const { status, body } = await regenerate();
    expect(status).toBe(422);
    expect(body.error).toBe("The new version didn't pass our ad checks. Your current ad is unchanged. Try again.");
    expect(body.error).not.toMatch(/refresh/i);
    expect(prompts).toHaveLength(2);
    expect(mocks.updates).toEqual([]);
    expect(mocks.usage.map(({ errorCode }) => errorCode)).toEqual(["CreativeValidationError", "CreativeValidationError"]);
    expect(mocks.claims.size).toBe(0);
  });
});

describe("core: Regenerate saves a recorded quote with an added 'the' on the first try (#281, #713)", () => {
  it("stores the owner's own words instead of spending a retry", async () => {
    expect(concept(SHORTENED_QUOTE).sourceQuotes).toContain(SHORTENED);
    replay(SHORTENED_QUOTE, VALID);
    const { status, body } = await regenerate();
    expect(status, JSON.stringify(body)).toBe(200);
    expect(prompts).toHaveLength(1);
    expect(mocks.updates).toHaveLength(1);
  });
});
