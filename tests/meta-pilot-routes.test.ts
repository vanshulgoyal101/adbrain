import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getConnectionAttempt: vi.fn(),
  commitSelectedConnection: vi.fn(),
  retryConnectionDiscovery: vi.fn(),
  createConnectionAttempt: vi.fn(),
  getConnectionStatus: vi.fn(),
  requireOwnedBusiness: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/meta/connection-repository", () => ({
  ...mocks, createBrowserBinding: () => "browser-binding",
}));
vi.mock("@/lib/meta/retry-discovery", () => ({ retryConnectionDiscovery: mocks.retryConnectionDiscovery }));
vi.mock("@/lib/meta/connection-access", () => ({
  getConnectionStatus: mocks.getConnectionStatus,
  requireOwnedBusiness: mocks.requireOwnedBusiness,
  ConnectionAccessError: class extends Error {},
}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ META_APP_ID: "app", NEXT_PUBLIC_SITE_URL: "https://adbrain.example.com" }) }));
vi.mock("@/lib/meta/oauth", () => ({
  metaOAuthConfigured: () => true,
  signState: () => "signed-state",
  verifyState: () => ({ nonce: "nonce" }),
  buildLoginUrl: () => "https://www.facebook.com/dialog/oauth",
  oauthRedirectUri: () => "https://adbrain.example.com/api/meta/oauth/callback",
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("META_CONNECT_ROLLOUT", "pilot");
  vi.stubEnv("META_CONNECT_PILOT_USER_ID", "pilot-owner");
  mocks.getUser.mockResolvedValue({ data: { user: { id: "other-owner" } } });
});
afterEach(() => vi.unstubAllEnvs());

describe("Meta pilot route boundary", () => {
  it("denies attempt reads, selection and retries before repository access", async () => {
    const read = await import("@/app/api/meta/connections/attempts/[id]/route");
    const select = await import("@/app/api/meta/connections/attempts/[id]/select/route");
    const retry = await import("@/app/api/meta/connections/attempts/[id]/retry/route");
    for (const handler of [read.GET, select.POST, retry.POST]) {
      const response = await handler(new NextRequest("https://adbrain.example.com/api/meta/connections/attempts/attempt"), {
        params: Promise.resolve({ id: "attempt" }),
      });
      expect(response.status).toBe(403);
    }
    expect(mocks.getConnectionAttempt).not.toHaveBeenCalled();
    expect(mocks.commitSelectedConnection).not.toHaveBeenCalled();
    expect(mocks.retryConnectionDiscovery).not.toHaveBeenCalled();
  });

  it("starts reconnect against the current generation", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "pilot-owner" } } });
    mocks.requireOwnedBusiness.mockResolvedValue({ businessId: "business", userId: "pilot-owner" });
    mocks.getConnectionStatus.mockResolvedValue({ generation: 7 });
    mocks.createConnectionAttempt.mockResolvedValue({ attemptId: "attempt", expiresAt: new Date(Date.now() + 600_000).toISOString() });
    const { POST } = await import("@/app/api/meta/connections/start/route");
    const response = await POST(new NextRequest("https://adbrain.example.com/api/meta/connections/start", {
      method: "POST", body: JSON.stringify({ businessId: "business", intent: { kind: "setup" } }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.createConnectionAttempt).toHaveBeenCalledWith(expect.objectContaining({ expectedGeneration: 7 }));
  });
});