import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/brand/autofill-solaride.json";
import { openAIReply, requestBody, requestUrl } from "./replay";

// autofill-solaride.json: Solaride's real home page (solaride.in) and the real extraction reply
// (Groq, budget routing), recorded on 2026-10-25 by scripts/record-brand-autofill-fixtures.ts (#650).
// The route runs for real: URL safety, page reading, prompt, provider call, JSON parse, tel: phone.
// Only the owner's session, the rate limiter, the page fetch and the usage write are stubbed.
const mocks = vi.hoisted(() => ({
  fetchPage: vi.fn(),
  persist: vi.fn(),
  owned: new Set<string>(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
    from: (table: string) => {
      expect(table).toBe("businesses");
      let id = "";
      const query = {
        select: () => query,
        eq: (_column: string, value: string) => ((id = value), query),
        maybeSingle: async () => ({ data: mocks.owned.has(id) ? { id } : null, error: null }),
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/security/ssrf", async (original) => ({
  ...await original<typeof import("@/lib/security/ssrf")>(), fetchPublicUrlText: mocks.fetchPage,
}));
vi.mock("@/lib/llm/persist", () => ({ persistLLMUsage: mocks.persist }));

const BUSINESS = "8a1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const usage = { prompt: recorded.reply.usage!.promptTokens, completion: recorded.reply.usage!.completionTokens };

beforeEach(() => {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    GROQ_API_KEYS: "core-groq",
    GROQ_MODEL: recorded.reply.model,
    LLM_BUDGET_PROVIDER_ORDER: "groq",
  })) vi.stubEnv(name, value);
  mocks.fetchPage.mockReset().mockResolvedValue(recorded.page);
  mocks.persist.mockReset().mockResolvedValue(true);
  mocks.owned = new Set([BUSINESS]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function provider(reply: () => Response) {
  const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
    expect(requestUrl(input)).toBe("https://api.groq.com/openai/v1/chat/completions");
    return reply();
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

async function autofill(body: unknown) {
  const { POST } = await import("@/app/api/brand/autofill/route");
  const response = await POST(new Request("https://adbrain.example/api/brand/autofill", { method: "POST", body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() };
}

describe("core: Brand autofill reads a real site into the Brand (#650)", () => {
  it("fills the Brand from the recorded Solaride page and reply, and logs the attempt as usage", async () => {
    const llm = provider(() => openAIReply(recorded.reply.content, recorded.reply.model, usage));
    const { status, body } = await autofill({ url: "solaride.in", businessId: BUSINESS });
    expect(status).toBe(200);
    expect(mocks.fetchPage).toHaveBeenCalledWith("https://solaride.in/", expect.objectContaining({ timeoutMs: 10_000 }));
    expect(requestBody(llm.mock.calls[0][1])).toContain("SOLARIDE");
    expect(body.extraction).toMatchObject({
      description: expect.stringMatching(/rooftop solar/i),
      vertical: "solar energy",
      usps: expect.arrayContaining([expect.stringMatching(/Mohali and Hisar/)]),
      languages: ["English"],
      // From the page's tel: link, never from the model.
      phone: "+917380280874",
    });
    // The site lists no offer, and the model didn't invent one.
    expect(body.extraction.offers).toBeUndefined();
    expect(mocks.persist).toHaveBeenCalledTimes(1);
    expect(mocks.persist.mock.calls[0][0]).toEqual([expect.objectContaining({
      businessId: BUSINESS, userId: "owner-1", route: "brand.autofill", provider: "groq", model: recorded.reply.model,
      usage: { promptTokens: usage.prompt, completionTokens: usage.completion, totalTokens: usage.prompt + usage.completion },
      status: "success", attempt: 1, maxTokens: 1_200, temperature: 0.3, requestId: expect.any(String),
    })]);
  });

  it.each([
    "http://169.254.169.254/latest/meta-data/", "http://localhost:3000/", "http://10.0.0.7/", "http://[::1]/",
    "file:///etc/passwd", "javascript:alert(1)", "ftp://solaride.in/", "http://user:pass@solaride.in/",
  ])("refuses %s before any fetch or model call (SSRF)", async (url) => {
    const llm = provider(() => openAIReply(recorded.reply.content, recorded.reply.model, usage));
    const { status, body } = await autofill({ url, businessId: BUSINESS });
    expect(status).toBe(400);
    expect(body.error).toBe("That URL is not allowed");
    expect(mocks.fetchPage).not.toHaveBeenCalled();
    expect(llm).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("refuses a public name that resolves to a private address, as the safe fetch reports it", async () => {
    const { SafeFetchError } = await import("@/lib/security/ssrf");
    mocks.fetchPage.mockRejectedValue(new SafeFetchError("blocked"));
    const llm = provider(() => openAIReply(recorded.reply.content, recorded.reply.model, usage));
    expect(await autofill({ url: "solaride.in" })).toEqual({ status: 400, body: { error: "That URL is not allowed" } });
    expect(llm).not.toHaveBeenCalled();
  });

  it.each([
    ["the provider is down", () => new Response("upstream unavailable", { status: 503 })],
    ["the reply isn't JSON", () => openAIReply("Sorry, I can't read that website.", recorded.reply.model, usage)],
  ])("returns the documented 502, not a 500, when %s, and logs the attempt", async (_case, reply) => {
    provider(reply);
    const { status, body } = await autofill({ url: "solaride.in", businessId: BUSINESS });
    expect(status).toBe(502);
    expect(body).toEqual({ error: "Could not extract business details. Try again later or enter them manually." });
    expect(mocks.persist).toHaveBeenCalledTimes(1);
    const rows = mocks.persist.mock.calls[0][0] as { route: string; businessId: string | null }[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((row) => row.route === "brand.autofill" && row.businessId === BUSINESS)).toBe(true);
  });

  it("records usage without a business on first Brand setup, and never on a business the owner doesn't own", async () => {
    const llm = provider(() => openAIReply(recorded.reply.content, recorded.reply.model, usage));
    expect((await autofill({ url: "solaride.in" })).status).toBe(200);
    expect(mocks.persist.mock.calls[0][0]).toEqual([expect.objectContaining({ businessId: null, route: "brand.autofill", status: "success", cacheHit: false })]);
    // The same page again is served from the response cache: no provider call, a zero-token row.
    expect((await autofill({ url: "solaride.in", businessId: "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e" })).status).toBe(200);
    expect(llm).toHaveBeenCalledTimes(1);
    expect(mocks.persist.mock.calls[1][0]).toEqual([expect.objectContaining({
      businessId: null, route: "brand.autofill", provider: "groq", status: "success", cacheHit: true,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    })]);
  });
});
