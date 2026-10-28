import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/auth/callback/route";

const { exchangeCodeForSession, verifyOtp, recordProductEvent } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(), verifyOtp: vi.fn(), recordProductEvent: vi.fn(),
}));
vi.mock("@/lib/observability/logger", () => ({ observeRoute: (_route: string, _method: string, handler: unknown) => handler, recordProductEvent }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession, verifyOtp } }),
}));

const NOW = new Date().toISOString();
const returning = { id: "u1", created_at: "2026-09-01T00:00:00Z", email_confirmed_at: "2026-09-01T00:00:05Z", last_sign_in_at: NOW };
const firstTime = { id: "u2", created_at: NOW, email_confirmed_at: NOW, last_sign_in_at: NOW };

beforeEach(() => {
  vi.resetAllMocks();
  exchangeCodeForSession.mockResolvedValue({ data: { user: returning }, error: null });
  verifyOtp.mockResolvedValue({ data: { user: returning }, error: null });
});

const events = () => recordProductEvent.mock.calls.map(([event]) => [event.name, event.outcome, event.attributes?.errorCode ?? null]);

describe("auth callback events (#451 L4)", () => {
  it("records a returning Google sign-in and a first one as a sign-up", async () => {
    await GET(new Request("https://adbrain.example/auth/callback?code=c1"));
    exchangeCodeForSession.mockResolvedValue({ data: { user: firstTime }, error: null });
    await GET(new Request("https://adbrain.example/auth/callback?code=c2"));
    expect(events()).toEqual([["auth.sign_in.google", "success", null], ["auth.sign_up.google", "success", null]]);
  });

  it("records an email-link sign-up when the link confirms the address", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { ...firstTime, created_at: "2026-10-24T10:00:00Z" } }, error: null });
    await GET(new Request("https://adbrain.example/auth/callback?token_hash=h&type=email"));
    expect(events()).toEqual([["auth.sign_up.email_link", "success", null]]);
  });

  it("records a failed callback with Supabase's code, which used to be a silent 302", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: { message: "expired", code: "flow_state_expired" } });
    await GET(new Request("https://adbrain.example/auth/callback?code=old"));
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "expired", code: "otp_expired" } });
    await GET(new Request("https://adbrain.example/auth/callback?token_hash=h&type=email"));
    expect(events()).toEqual([
      ["auth.sign_in.google", "failed", "AUTH_CALLBACK:flow_state_expired"],
      ["auth.sign_in.email_link", "failed", "AUTH_CALLBACK:otp_expired"],
    ]);
  });

  it("records a provider error or a bare callback, keeping only a safe code", async () => {
    for (const query of ["error=access_denied&error_code=bad_oauth_callback", "", "error_code=%3Cscript%3E"]) {
      const response = await GET(new Request(`https://adbrain.example/auth/callback?${query}`));
      expect(response.headers.get("location")).toBe("https://adbrain.example/login?error=auth");
    }
    expect(events()).toEqual([
      ["auth.sign_in", "failed", "AUTH_CALLBACK:bad_oauth_callback"],
      ["auth.sign_in", "failed", "AUTH_CALLBACK:missing_params"],
      ["auth.sign_in", "failed", "AUTH_CALLBACK:other"],
    ]);
  });
});

describe("auth callback destinations", () => {
  it.each(["@evil.example", "//evil.example", "/\\evil.example", "https://evil.example", "/\n/evil.example"])(
    "rejects an external or ambiguous return path: %s", async (redirect) => {
      const query = new URLSearchParams({ code: "test-code", redirect });
      const response = await GET(new Request(`https://adbrain.example/auth/callback?${query}`));
      expect(response.headers.get("location")).toBe("https://adbrain.example/dashboard");
    },
  );

  it("preserves a local path and query after successful OAuth", async () => {
    const query = new URLSearchParams({ code: "test-code", redirect: "/studio?view=drafts" });
    const response = await GET(new Request(`https://adbrain.example/auth/callback?${query}`));
    expect(response.headers.get("location")).toBe("https://adbrain.example/studio?view=drafts");
  });

  it("applies the same destination policy to email callbacks", async () => {
    const query = new URLSearchParams({ token_hash: "test-hash", type: "email", redirect: "@evil.example" });
    const response = await GET(new Request(`https://adbrain.example/auth/callback?${query}`));
    expect(response.headers.get("location")).toBe("https://adbrain.example/dashboard");
    expect(verifyOtp).toHaveBeenCalledOnce();
  });

  // #1414: production's codes (otp_expired ×3, pkce_code_verifier_not_found ×1 in 12 h) each get their own word.
  it.each([
    ["an email link opened late or twice", "error=access_denied&error_code=otp_expired", null, "link_expired"],
    ["Google finished in another browser", "code=c1", { message: "verifier", code: "pkce_code_verifier_not_found" }, "other_browser"],
    ["Google cancelled", "error=access_denied", null, "cancelled"],
  ])("%s → /login?error=%s", async (_case, query, failure, reason) => {
    if (failure) exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: failure });
    const response = await GET(new Request(`https://adbrain.example/auth/callback?${query}`));
    expect(response.headers.get("location")).toBe(`https://adbrain.example/login?error=${reason}`);
  });

  it("#1414: an expired email link keeps where the owner was going", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "expired", code: "otp_expired" } });
    const query = new URLSearchParams({ token_hash: "h", type: "email", redirect: "/studio" });
    const response = await GET(new Request(`https://adbrain.example/auth/callback?${query}`));
    expect(response.headers.get("location")).toBe("https://adbrain.example/login?error=link_expired&redirect=%2Fstudio");
  });

  it("returns to login after a failed code exchange", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: "invalid" } });
    const response = await GET(new Request("https://adbrain.example/auth/callback?code=bad"));
    expect(response.headers.get("location")).toBe("https://adbrain.example/login?error=auth");
  });
});