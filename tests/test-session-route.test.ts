import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/internal/test-session/route";

const mocks = vi.hoisted(() => ({
  env: { TEST_SESSION_SECRET: "s3cret", TEST_SESSION_EMAILS: ["smoke@example.test"] },
  record: vi.fn(), rate: vi.fn(), generateLink: vi.fn(), verifyOtp: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ getEnv: () => mocks.env }));
vi.mock("@/lib/observability/logger", () => ({ observeRoute: (_r: string, _m: string, handler: unknown) => handler, recordProductEvent: mocks.record }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: mocks.rate }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ auth: { admin: { generateLink: mocks.generateLink } } }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { verifyOtp: mocks.verifyOtp } }) }));

function mint(body: unknown, authorization: string | null = "Bearer s3cret") {
  return POST(new Request("https://adbrain.example/api/internal/test-session", {
    method: "POST", body: JSON.stringify(body),
    headers: { "x-real-ip": "203.0.113.9", ...(authorization === null ? {} : { authorization }) },
  }));
}
const outcomes = () => mocks.record.mock.calls.map(([event]) => [event.name, event.outcome, event.attributes?.status ?? null]);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.env = { TEST_SESSION_SECRET: "s3cret", TEST_SESSION_EMAILS: ["Smoke@Example.test"] };
  mocks.rate.mockResolvedValue(null);
  mocks.generateLink.mockResolvedValue({ data: { properties: { hashed_token: "hash-1" } }, error: null });
  mocks.verifyOtp.mockResolvedValue({ data: { session: { access_token: "at-1", user: { id: "u1", email: "smoke@example.test" } } }, error: null });
});

describe("POST /api/internal/test-session (#2574)", () => {
  it("mints a recovery token for an allowlisted email and verifies it with the app's cookie-writing client", async () => {
    const response = await mint({ email: " SMOKE@example.test " });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ user: { id: "u1", email: "smoke@example.test" }, accessToken: "at-1" });
    expect(mocks.generateLink).toHaveBeenCalledWith({ type: "recovery", email: "smoke@example.test" });
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "hash-1" });
    expect(mocks.rate.mock.calls.map(([key]) => key)).toEqual(["test-session:203.0.113.9", "test-session:all"]);
    expect(outcomes()).toEqual([["auth.test_session", "success", null]]);
  });

  it.each([
    ["no secret", { TEST_SESSION_SECRET: "", TEST_SESSION_EMAILS: ["smoke@example.test"] }],
    ["no allowlist", { TEST_SESSION_SECRET: "s3cret", TEST_SESSION_EMAILS: [] }],
  ])("is not found with %s", async (_case, env) => {
    mocks.env = env;
    expect((await mint({ email: "smoke@example.test" })).status).toBe(404);
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it.each([
    ["no bearer", null],
    ["a wrong secret", "Bearer s3cres"],
    ["a longer secret", "Bearer s3cret-and-more"],
    ["the bare secret", "s3cret"],
  ])("refuses %s before reading the body", async (_case, authorization) => {
    expect((await mint({ email: "smoke@example.test" }, authorization)).status).toBe(401);
    expect(mocks.generateLink).not.toHaveBeenCalled();
    expect(outcomes()).toEqual([["auth.test_session", "rejected", 401]]);
  });

  it("refuses an email outside the allowlist without minting anything", async () => {
    const response = await mint({ email: "owner@example.test" });
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("owner@");
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ email: "not an email" }], [{ email: "smoke@example.test", type: "magiclink" }]])("refuses body %j", async (body) => {
    expect((await mint(body)).status).toBe(422);
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("stops when the address or overall limit is hit", async () => {
    mocks.rate.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await mint({ email: "smoke@example.test" })).status).toBe(429);
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("reports a missing user or a refused token as failed, never as a session", async () => {
    mocks.generateLink.mockResolvedValueOnce({ data: { properties: null }, error: { code: "user_not_found" } });
    expect((await mint({ email: "smoke@example.test" })).status).toBe(502);
    mocks.verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: { code: "otp_expired" } });
    expect((await mint({ email: "smoke@example.test" })).status).toBe(502);
    expect(outcomes()).toEqual([["auth.test_session", "failed", 502], ["auth.test_session", "failed", 502]]);
  });
});
