import { beforeEach, describe, expect, it, vi } from "vitest";
import { pilotReadiness } from "@/lib/config/pilot-readiness";

// #1875: production settings a pilot needs, reported by name only (never a value).
const complete: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service-secret",
  NEXT_PUBLIC_SITE_URL: "https://adbrain.vanshul.com", CRON_SECRET: "cron-secret",
  GROQ_API_KEYS: "k1", OPENROUTER_API_KEYS: "k2", CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_AI_TOKEN: "cf-secret",
  META_APP_ID: "1", META_APP_SECRET: "app-secret", META_TOKEN_ENCRYPTION_KEY: "key-secret", META_CONNECT_ROLLOUT: "enabled",
  SUPPORT_WHATSAPP: "+919800000000", NEXT_PUBLIC_SUPPORT_WHATSAPP: "+919800000000",
  OWNER_ALERTS_ENABLED: "true", ALERTS_WHATSAPP: "+919800000001", ALERTS_WHATSAPP_PHONE_ID: "123", ALERTS_WHATSAPP_TOKEN: "wa-secret", WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify",
  AD_RESULTS_ENABLED: "true",
};

describe("pilot readiness (#1875)", () => {
  it("is ready when every pilot setting is there", () => {
    expect(pilotReadiness(complete)).toEqual({ ok: true, missing: [] });
  });

  it("names what's missing or switched off, and never a value", () => {
    const env = { ...complete, SUPPORT_WHATSAPP: "", CLOUDFLARE_AI_TOKEN: " ", OWNER_ALERTS_ENABLED: "false", META_CONNECT_ROLLOUT: "pilot", GROQ_API_KEYS: "", OPENROUTER_API_KEYS: "" };
    const result = pilotReadiness(env);
    expect(result.ok).toBe(false);
    expect(result.missing.map((item) => item.name)).toEqual(expect.arrayContaining([
      "SUPPORT_WHATSAPP", "CLOUDFLARE_AI_TOKEN", "OWNER_ALERTS_ENABLED", "META_CONNECT_ROLLOUT", "OPENROUTER_API_KEYS",
    ]));
    expect(result.missing.find((item) => item.name === "META_CONNECT_ROLLOUT")?.state).toBe("not enabled");
    expect(JSON.stringify(result)).not.toMatch(/secret|\+9198|pilot"|https:\/\/x/);
  });

  it("needs at least one text AI key pool", () => {
    const env = { ...complete, GROQ_API_KEYS: "", OPENROUTER_API_KEYS: "", GOOGLE_AI_API_KEYS: "", CEREBRAS_API_KEYS: "" };
    expect(pilotReadiness(env).missing.map((item) => item.name)).toContain("GOOGLE_AI_API_KEYS | GROQ_API_KEYS | OPENROUTER_API_KEYS | CEREBRAS_API_KEYS");
  });
});

describe("GET /api/cron/pilot-readiness (#1875)", () => {
  beforeEach(() => { vi.resetModules(); vi.unstubAllEnvs(); });
  const call = async (auth?: string) => {
    const { GET } = await import("@/app/api/cron/pilot-readiness/route");
    const response = await GET(new Request("https://app.test/api/cron/pilot-readiness", { headers: auth ? { authorization: auth } : {} }));
    return { status: response.status, body: await response.json() };
  };

  it("answers only the scheduler, with names", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("SUPPORT_WHATSAPP", "");
    expect((await call()).status).toBe(401);
    const { status, body } = await call("Bearer cron-secret");
    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.missing.map((item: { name: string }) => item.name)).toContain("SUPPORT_WHATSAPP");
    expect(JSON.stringify(body)).not.toContain("cron-secret");
  });
});
