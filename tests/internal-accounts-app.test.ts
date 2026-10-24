import { afterEach, describe, expect, it, vi } from "vitest";
import { isInternalUser } from "@/lib/internal-accounts";

const confirmed = "2026-10-01T00:00:00Z";

describe("isInternalUser (#398)", () => {
  it("is true for a confirmed team-domain email or a listed owner id", () => {
    expect(isInternalUser({ id: "x", email: "QA@AdBrain.vanshul.com", email_confirmed_at: confirmed })).toBe(true);
    expect(isInternalUser({ id: "da0771ca-c07f-4e86-b6da-023aaf517d74", email: "someone@gmail.com" })).toBe(true);
  });

  it("is false for customers, unconfirmed team emails and look-alike domains", () => {
    expect(isInternalUser({ id: "x", email: "owner@gmail.com", email_confirmed_at: confirmed })).toBe(false);
    expect(isInternalUser({ id: "x", email: "qa@adbrain.vanshul.com" })).toBe(false);
    expect(isInternalUser({ id: "x", email: "qa@evil-adbrain.vanshul.com.example", email_confirmed_at: confirmed })).toBe(false);
    expect(isInternalUser(null)).toBe(false);
  });
});

describe("configuredMonthlyTokenLimit (#398)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps the customer limit and lifts it (0 = no limit) for internal accounts", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("LLM_MONTHLY_TOKEN_LIMIT", "1000000");
    vi.resetModules();
    const { configuredMonthlyTokenLimit } = await import("@/lib/llm/persist");
    expect(configuredMonthlyTokenLimit({ id: "x", email: "owner@gmail.com", email_confirmed_at: confirmed })).toBe(1_000_000);
    expect(configuredMonthlyTokenLimit({ id: "x", email: "demo@adbrain.vanshul.com", email_confirmed_at: confirmed })).toBe(0);
  });
});
