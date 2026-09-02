import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Environment validation. A bad env is a production outage, so the schema's
 * required/optional split, coercion and defaults are pinned here.
 */

const BASE = {
  NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
};

async function loadEnv(over: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...BASE, ...over })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const { getEnv } = await import("@/lib/env");
  return getEnv();
}

beforeEach(() => {
  // Clear anything a previous test set so defaults are observable.
  for (const key of [
    "GOOGLE_AI_API_KEYS",
    "GROQ_API_KEYS",
    "OPENROUTER_API_KEYS",
    "CEREBRAS_API_KEYS",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SITE_URL",
    "GEMINI_MODEL",
    "GEMINI_THINKING_HEADROOM",
    "TRAFFIC_GENERATOR_MAX_ROUNDS",
    "TRAFFIC_GENERATOR_ALLOWED_EMAILS",
  ]) {
    delete process.env[key];
  }
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getEnv: required values", () => {
  it("throws when Supabase config is missing", async () => {
    await expect(
      loadEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined }),
    ).rejects.toThrow(/environment/i);
  });

  it("rejects a non-URL Supabase URL", async () => {
    await expect(
      loadEnv({ NEXT_PUBLIC_SUPABASE_URL: "not-a-url" }),
    ).rejects.toThrow(/environment/i);
  });
});

describe("getEnv: comma-separated key pools", () => {
  it("splits, trims and drops empties", async () => {
    const env = await loadEnv({ GOOGLE_AI_API_KEYS: " k1 , k2 ,, k3 " });
    expect(env.GOOGLE_AI_API_KEYS).toEqual(["k1", "k2", "k3"]);
  });

  it("defaults to an empty pool, which disables the provider", async () => {
    const env = await loadEnv();
    expect(env.GROQ_API_KEYS).toEqual([]);
    expect(env.CEREBRAS_API_KEYS).toEqual([]);
  });

  it("parses the traffic-runner allowlist the same way", async () => {
    const env = await loadEnv({
      TRAFFIC_GENERATOR_ALLOWED_EMAILS: "a@x.com, b@y.com",
    });
    expect(env.TRAFFIC_GENERATOR_ALLOWED_EMAILS).toEqual(["a@x.com", "b@y.com"]);
  });
});

describe("getEnv: optional values and defaults", () => {
  it("treats an empty service-role key as absent", async () => {
    const env = await loadEnv({ SUPABASE_SERVICE_ROLE_KEY: "" });
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });

  it("keeps a real service-role key", async () => {
    const env = await loadEnv({ SUPABASE_SERVICE_ROLE_KEY: "service-key" });
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("service-key");
  });

  it("defaults the site URL for local development", async () => {
    const env = await loadEnv();
    expect(env.NEXT_PUBLIC_SITE_URL).toBe("http://localhost:3000");
  });

  it("coerces numeric settings and applies defaults", async () => {
    const withDefaults = await loadEnv();
    expect(withDefaults.GEMINI_THINKING_HEADROOM).toBe(3000);
    expect(withDefaults.TRAFFIC_GENERATOR_MAX_ROUNDS).toBe(20);

    const overridden = await loadEnv({
      GEMINI_THINKING_HEADROOM: "0",
      TRAFFIC_GENERATOR_MAX_ROUNDS: "7",
    });
    expect(overridden.GEMINI_THINKING_HEADROOM).toBe(0);
    expect(overridden.TRAFFIC_GENERATOR_MAX_ROUNDS).toBe(7);
  });

  it("rejects an out-of-range round cap", async () => {
    await expect(
      loadEnv({ TRAFFIC_GENERATOR_MAX_ROUNDS: "1000" }),
    ).rejects.toThrow(/environment/i);
  });

  it("rejects a negative thinking headroom", async () => {
    await expect(
      loadEnv({ GEMINI_THINKING_HEADROOM: "-1" }),
    ).rejects.toThrow(/environment/i);
  });
});

describe("getEnv: memoization", () => {
  it("returns the same object on repeated calls", async () => {
    vi.resetModules();
    Object.assign(process.env, BASE);
    const { getEnv } = await import("@/lib/env");
    expect(getEnv()).toBe(getEnv());
  });
});
