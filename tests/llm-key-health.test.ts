import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyKey, keyProbes, probeKeys } from "@/lib/llm/key-health";

// #1569: the ₹0 key probe. Status bodies below are what each provider returned to an invalid key (Oct 28).
const GEMINI_INVALID = JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } });
const env = {
  GROQ_API_KEYS: ["gsk-a", "gsk-b"], OPENROUTER_API_KEYS: ["sk-or-a"], GOOGLE_AI_API_KEYS: ["AIza-a"], CEREBRAS_API_KEYS: [],
  CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_AI_TOKEN: "cf-token", FALAI_API_KEY: "fal-key", OPENAI_API_KEY: "",
};

describe("AI key health probe (#1569)", () => {
  it("probes every configured key on a free endpoint, named by env var and index", () => {
    expect(keyProbes(env).map(({ name, probe }) => [name, probe.url])).toEqual([
      ["GROQ_API_KEYS[0]", "https://api.groq.com/openai/v1/models"],
      ["GROQ_API_KEYS[1]", "https://api.groq.com/openai/v1/models"],
      ["OPENROUTER_API_KEYS[0]", "https://openrouter.ai/api/v1/key"],
      ["GOOGLE_AI_API_KEYS[0]", "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1"],
      ["CLOUDFLARE_AI_TOKEN", "https://api.cloudflare.com/client/v4/accounts/acct/ai/models/search?per_page=1"],
      ["FALAI_API_KEY", "https://api.fal.ai/v1/models?limit=1"],
    ]);
    // Never a generation endpoint.
    for (const { probe } of keyProbes(env)) expect(probe.url).not.toMatch(/completions|generate|chat|images/);
  });

  it("401/402/403 and Gemini's API_KEY_INVALID are dead; 429, 5xx and other 400s only report", () => {
    expect(classifyKey("groq", 200, "")).toEqual({ status: "ok", detail: "HTTP_200" });
    expect(classifyKey("groq", 401, "")).toEqual({ status: "dead", detail: "HTTP_401" });
    expect(classifyKey("openrouter", 402, "")).toEqual({ status: "dead", detail: "HTTP_402" });
    expect(classifyKey("cloudflare", 403, "")).toEqual({ status: "dead", detail: "HTTP_403" });
    expect(classifyKey("google", 400, GEMINI_INVALID)).toEqual({ status: "dead", detail: "HTTP_400_API_KEY_INVALID" });
    expect(classifyKey("google", 400, "{}")).toEqual({ status: "unknown", detail: "HTTP_400" });
    expect(classifyKey("groq", 429, "")).toEqual({ status: "unknown", detail: "HTTP_429" });
    expect(classifyKey("fal", 503, "")).toEqual({ status: "unknown", detail: "HTTP_503" });
  });

  it("returns names and statuses only, never a key", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const auth = JSON.stringify(init?.headers);
      if (auth.includes("gsk-b")) return new Response("{}", { status: 401 });
      if (url.includes("googleapis")) return new Response(GEMINI_INVALID, { status: 400 });
      if (url.includes("fal.ai")) throw new Error("timeout");
      return new Response("{}", { status: 200 });
    });
    const health = await probeKeys(env, fetcher as unknown as typeof fetch);
    expect(health.filter((key) => key.status !== "ok")).toEqual([
      { name: "GROQ_API_KEYS[1]", provider: "groq", status: "dead", detail: "HTTP_401" },
      { name: "GOOGLE_AI_API_KEYS[0]", provider: "google", status: "dead", detail: "HTTP_400_API_KEY_INVALID" },
      { name: "FALAI_API_KEY", provider: "fal", status: "unknown", detail: "UNREACHABLE" },
    ]);
    expect(JSON.stringify(health)).not.toMatch(/gsk-|sk-or|AIza|cf-token|fal-key/);
  });
});

describe("/api/cron/llm-credit reports dead keys (#1569)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("PRODUCT_LOGGING_DATABASE_ENABLED", "false");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("OPENROUTER_API_KEYS", "sk-or-a");
    vi.stubEnv("GROQ_API_KEYS", "gsk-a,gsk-b");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("lists the dead key by name; the credit check is unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (JSON.stringify(init?.headers).includes("gsk-b")) return new Response("{}", { status: 401 });
      if (url === "https://openrouter.ai/api/v1/key") return Response.json({ data: { limit: 9, limit_remaining: 5 } });
      return new Response("{}", { status: 200 });
    }));
    const { GET } = await import("@/app/api/cron/llm-credit/route");
    const body = await (await GET(new Request("http://localhost/api/cron/llm-credit", { headers: { authorization: "Bearer cron-secret" } }))).json();
    expect(body).toMatchObject({ ok: true, low: false, minRemainingUsd: 5, dead: ["GROQ_API_KEYS[1]"] });
    expect(body.health).toContainEqual({ name: "GROQ_API_KEYS[0]", provider: "groq", status: "ok", detail: "HTTP_200" });
    expect(JSON.stringify(body)).not.toMatch(/gsk-|sk-or/);
  });
});
