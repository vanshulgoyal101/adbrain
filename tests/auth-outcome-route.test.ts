import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/auth/outcome/route";

const mocks = vi.hoisted(() => ({ record: vi.fn(), rate: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({ observeRoute: (_route: string, _method: string, handler: unknown) => handler, recordProductEvent: mocks.record }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: mocks.rate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));

function beacon(body: unknown, headers: Record<string, string> = {}) {
  return POST(new Request("https://adbrain.example/api/auth/outcome", {
    method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { origin: "https://adbrain.example", "x-forwarded-for": "203.0.113.9, 10.0.0.1", ...headers },
  }));
}
const events = () => mocks.record.mock.calls.map(([event]) => [event.name, event.outcome, event.attributes?.errorCode ?? null]);

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  mocks.rate.mockResolvedValue(null);
  mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
});

describe("POST /api/auth/outcome (#451 L4)", () => {
  it("records a password failure with Supabase's code, rate limited per address and overall", async () => {
    expect((await beacon({ method: "password", outcome: "failed", code: "invalid_credentials" })).status).toBe(204);
    expect(events()).toEqual([["auth.sign_in.password", "failed", "AUTH_CLIENT:invalid_credentials"]]);
    expect(mocks.rate.mock.calls.map(([key]) => key)).toEqual(["auth-outcome:203.0.113.9", "auth-outcome:all"]);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("records a sent sign-in link as started and a password sign-in as the signed-in user's success", async () => {
    await beacon({ method: "email_link", outcome: "started" });
    await beacon({ method: "password", outcome: "success" });
    expect(events()).toEqual([["auth.sign_in.email_link", "started", null], ["auth.sign_in.password", "success", null]]);
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it.each([
    ["another origin", { method: "password", outcome: "failed", code: "other" }, { origin: "https://evil.example" }, 403],
    ["an email in the body", { method: "password", outcome: "failed", code: "other", email: "owner@example.com" }, {}, 400],
    ["a code outside the list", { method: "password", outcome: "failed", code: "drop table" }, {}, 400],
    ["a body over 512 bytes", JSON.stringify({ method: "password", outcome: "failed", code: "other", pad: "x".repeat(600) }), {}, 413],
  ])("refuses %s without recording anything", async (_case, body, headers, status) => {
    expect((await beacon(body, headers)).status).toBe(status);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("stops at the rate limit and honours Do Not Track", async () => {
    mocks.rate.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await beacon({ method: "google", outcome: "failed", code: "other" })).status).toBe(429);
    expect((await beacon({ method: "google", outcome: "failed", code: "other" }, { dnt: "1" })).status).toBe(204);
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
