import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/create/solaride-regenerate.json";
import { conceptValidationRules, validateConcept, type ConceptInput } from "@/lib/creative/concept";
import { parseJSON } from "@/lib/llm";
import type { AdFormat } from "@/lib/creative/design";
import { getAngleByName, type BrandContext } from "@/lib/templates/ads";
import { openAIReply, requestUrl } from "./replay";

// Regenerate (#281): six real Claude Haiku 5.5 replies for the Solaride ad that failed in
// production, recorded by scripts/record-regenerate-fixtures.ts from the route's own input.
// The route, generation loop, fact check and usage receipts are real; only the network,
// Supabase, storage and images are replaced.

const CREATIVE = "f5727105-521b-49a0-bb67-8905e2225acd";
const [current, ...recent] = recorded.recentCopy;
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

const input: ConceptInput = {
  brand: recorded.brand as BrandContext, brief: recorded.brief, angle: getAngleByName(recorded.angle)!,
  instructions: recorded.instructions, language: recorded.language ?? undefined, format: recorded.format as AdFormat,
  recentCopy: recorded.recentCopy, sourceFacts: recorded.sourceFacts,
};
const rules = (content: string) => {
  const result = validateConcept(parseJSON<unknown>(content), input);
  return result.success ? [] : conceptValidationRules(result.issues);
};
const run = (index: number) => recorded.replies.filter((reply) => reply.run === index).map((reply) => reply.content);

let textCalls = 0;
function replay(...replies: string[][]) {
  const queue = replies.flat();
  vi.stubGlobal("fetch", vi.fn(async (request: RequestInfo | URL) => {
    expect(requestUrl(request)).toBe("https://openrouter.ai/api/v1/chat/completions");
    const content = queue.shift();
    if (content === undefined) throw new Error("No recorded reply left for this request.");
    textCalls++;
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
  textCalls = 0;
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

describe("core: Regenerate fact check on recorded Solaride replies (#281)", () => {
  it("accepts ₹10,000 when the cited fact says 10,000 rupees, and keeps the real failures", () => {
    expect(recorded.replies.map(({ rulesOnMain }) => rulesOnMain)).toEqual([
      ["unsupported-commercial-claim"], [], ["sourceQuotes", "unsupported-commercial-claim"],
      ["schema:headline:too_big"], ["sourceQuotes"], ["unsupported-commercial-claim"],
    ]);
    expect(recorded.replies.map(({ content }) => rules(content))).toEqual([
      [], [], ["sourceQuotes"], ["schema:headline:too_big"], ["sourceQuotes"], ["unsupported-commercial-claim"],
    ]);
  });

  it("still rejects a rupee amount the cited fact does not state", () => {
    const [first] = run(0);
    for (const amount of ["₹1,000", "₹100,000", "₹10,000.50"]) {
      expect(rules(first.replaceAll("₹10,000", amount)), amount).toEqual(["unsupported-commercial-claim"]);
    }
  });
});

describe("core: Regenerate route on recorded Solaride replies (#281)", () => {
  it("saves the first reply in one text call", async () => {
    replay(run(0));
    const { status, body } = await regenerate();
    expect(status, JSON.stringify(body)).toBe(200);
    expect(textCalls).toBe(1);
    expect(mocks.updates).toEqual([expect.objectContaining({ headline: "Act Before the 31 Dec Cost Jump", status: "draft" })]);
    const generation = mocks.updates[0].generation as { photoUrl?: string; design?: Record<string, unknown> };
    expect(generation.photoUrl).toBe("https://core-test.supabase.co/storage/v1/object/public/creatives/photo.webp");
    expect(generation.design).toMatchObject({ headline: "Act Before the 31 Dec Cost Jump" });
    expect(generation.design).not.toHaveProperty("backgroundUrl");
    expect(mocks.claims.size).toBe(0);
  });

  it("names the uncited claim in a plain 422, keeps the ad and lets the owner try again", async () => {
    replay(run(2), run(0));
    const rejected = await regenerate();
    expect(rejected.status).toBe(422);
    expect(rejected.body.error).toBe(
      "The new version made a claim our fact check couldn't match to your Brand (10%, free). Your current ad is unchanged. Try again.",
    );
    expect(textCalls).toBe(2);
    expect(mocks.updates).toEqual([]);
    expect(mocks.usage.map(({ errorCode }) => errorCode)).toEqual(["CreativeValidationError", "CreativeValidationError"]);
    expect(mocks.claims.size).toBe(0);

    const retried = await regenerate();
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(mocks.updates).toHaveLength(1);
  });

  it("explains other failed checks without naming a claim or asking for a refresh", async () => {
    replay(run(1));
    const { status, body } = await regenerate();
    expect(status).toBe(422);
    expect(body.error).toBe("The new version didn't pass our ad checks. Your current ad is unchanged. Try again.");
    expect(mocks.updates).toEqual([]);
    expect(mocks.claims.size).toBe(0);
  });
});
