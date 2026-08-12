import { afterEach, describe, expect, it, vi } from "vitest";
import { isDevAuthEnabled, DEV_USER } from "@/lib/dev-auth";

afterEach(() => vi.unstubAllEnvs());

describe("isDevAuthEnabled", () => {
  it("is enabled outside production when the flag is 'true'", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DEV_AUTH_BYPASS", "true");
    expect(isDevAuthEnabled()).toBe(true);
  });

  it("is disabled in production even when the flag is 'true'", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DEV_AUTH_BYPASS", "true");
    expect(isDevAuthEnabled()).toBe(false);
  });

  it("is disabled when the flag is not exactly 'true'", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DEV_AUTH_BYPASS", "1");
    expect(isDevAuthEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_DEV_AUTH_BYPASS", "");
    expect(isDevAuthEnabled()).toBe(false);
  });
});

describe("DEV_USER", () => {
  it("has a stable id and email for RLS-scoped local work", () => {
    expect(DEV_USER.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(DEV_USER.email).toContain("@");
  });
});
