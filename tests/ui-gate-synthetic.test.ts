import { describe, expect, it } from "vitest";
import { syntheticSession } from "../scripts/lib/ui-gate-synthetic.mjs";

const local = {
  SMOKE_EMAIL: "meta-qa@example.test",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-anon",
  SUPABASE_SERVICE_ROLE_KEY: "local-service",
  TEST_SESSION_SECRET: "must-not-be-used",
};

describe("isolated UI gate session (#2748)", () => {
  it("uses only the explicitly supplied synthetic local session", () => {
    expect(syntheticSession(local, "http://localhost:3001")).toEqual({
      email: "meta-qa@example.test",
      config: { url: "http://127.0.0.1:54321", apikey: "local-anon", serviceRoleKey: "local-service" },
    });
  });

  it.each([
    ["remote app", local, "https://adbrain.vanshul.com"],
    ["remote Supabase", { ...local, NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" }, "http://localhost:3001"],
    ["URL credentials", { ...local, NEXT_PUBLIC_SUPABASE_URL: "http://x:y@localhost:54321" }, "http://localhost:3001"],
    ["real email", { ...local, SMOKE_EMAIL: "owner@example.com" }, "http://localhost:3001"],
    ["missing service key", { ...local, SUPABASE_SERVICE_ROLE_KEY: "" }, "http://localhost:3001"],
  ])("rejects %s", (_description, env, origin) => {
    expect(() => syntheticSession(env, origin)).toThrow();
  });
});
