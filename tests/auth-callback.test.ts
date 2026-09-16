import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/auth/callback/route";

const { exchangeCodeForSession, verifyOtp } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(), verifyOtp: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession, verifyOtp } }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  exchangeCodeForSession.mockResolvedValue({ error: null });
  verifyOtp.mockResolvedValue({ error: null });
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

  it("returns to login after a failed code exchange", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: "invalid" } });
    const response = await GET(new Request("https://adbrain.example/auth/callback?code=bad"));
    expect(response.headers.get("location")).toBe("https://adbrain.example/login?error=auth");
  });
});