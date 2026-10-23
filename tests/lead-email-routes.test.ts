import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signUnsubscribeToken } from "@/lib/leads/notify";

const mocks = vi.hoisted(() => ({ adminRpc: vi.fn(), userRpc: vi.fn(), getUser: vi.fn(), rateLimit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.adminRpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.userRpc }) }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: mocks.rateLimit }));

const SECRET = "link-secret-of-16+chars";
const businessId = "816aaafb-7ebc-4ad7-bbda-001beff172f8";
const origin = "https://adbrain.vanshul.com";
const token = signUnsubscribeToken(businessId, SECRET);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("EMAIL_LINK_SECRET", SECRET);
  mocks.adminRpc.mockResolvedValue({ data: null, error: null });
  mocks.rateLimit.mockResolvedValue(null);
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});
afterEach(() => vi.unstubAllEnvs());

describe("unsubscribe link", () => {
  it("GET shows a confirm button and changes nothing, so a mail scanner cannot unsubscribe anyone", async () => {
    const { GET } = await import("@/app/api/email/unsubscribe/route");
    const response = await GET(new Request(`${origin}/api/email/unsubscribe?token=${token}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain('<form method="post" action="/api/email/unsubscribe">');
    expect(html).toContain(`value="${token}"`);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("POST from the confirm button switches that business off", async () => {
    const { POST } = await import("@/app/api/email/unsubscribe/route");
    const response = await POST(new Request(`${origin}/api/email/unsubscribe`, { method: "POST", body: new URLSearchParams({ token }) }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("You are unsubscribed");
    expect(mocks.adminRpc).toHaveBeenCalledExactlyOnceWith("lead_email_unsubscribe", { p_business_id: businessId });
  });

  it("POST to the link itself is a one-click unsubscribe (RFC 8058)", async () => {
    const { POST } = await import("@/app/api/email/unsubscribe/route");
    const response = await POST(new Request(`${origin}/api/email/unsubscribe?token=${token}`, {
      method: "POST", body: new URLSearchParams({ "List-Unsubscribe": "One-Click" }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.adminRpc).toHaveBeenCalledExactlyOnceWith("lead_email_unsubscribe", { p_business_id: businessId });
  });

  it("rejects forged, foreign and missing tokens without touching the database", async () => {
    const { GET, POST } = await import("@/app/api/email/unsubscribe/route");
    const foreign = signUnsubscribeToken(businessId, "another-secret-16+chars");
    for (const bad of [foreign, `${token}x`, "", "x".repeat(60), `22222222-2222-4222-8222-222222222222.${token.split(".")[1]}`]) {
      expect((await GET(new Request(`${origin}/api/email/unsubscribe?token=${encodeURIComponent(bad)}`))).status, bad).toBe(400);
      expect((await POST(new Request(`${origin}/api/email/unsubscribe`, { method: "POST", body: new URLSearchParams({ token: bad }) }))).status, bad).toBe(400);
    }
    expect((await POST(new Request(`${origin}/api/email/unsubscribe`, { method: "POST" }))).status).toBe(400);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("refuses every token when the link secret is not set", async () => {
    vi.stubEnv("EMAIL_LINK_SECRET", "");
    const { GET } = await import("@/app/api/email/unsubscribe/route");
    expect((await GET(new Request(`${origin}/api/email/unsubscribe?token=${token}`))).status).toBe(400);
  });

  it("does not claim success when the database fails", async () => {
    mocks.adminRpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
    const { POST } = await import("@/app/api/email/unsubscribe/route");
    const response = await POST(new Request(`${origin}/api/email/unsubscribe`, { method: "POST", body: new URLSearchParams({ token }) }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("You are unsubscribed");
  });
});

describe("Settings switch", () => {
  const configured = () => {
    vi.stubEnv("LEAD_EMAIL_ENABLED", "true");
    vi.stubEnv("RESEND_API_KEY", "re_key");
    vi.stubEnv("LEAD_EMAIL_FROM", "a@b.c");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", origin);
  };
  const post = (body: unknown, requestOrigin = origin) => new Request(`${origin}/api/lead-email`, {
    method: "POST", headers: { origin: requestOrigin, "content-type": "application/json" }, body: JSON.stringify(body),
  });

  it("requires a signed-in owner", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const { GET, POST } = await import("@/app/api/lead-email/route");
    expect((await GET(new Request(`${origin}/api/lead-email?businessId=${businessId}`))).status).toBe(401);
    expect((await POST(post({ businessId, enabled: false }))).status).toBe(401);
    expect(mocks.userRpc).not.toHaveBeenCalled();
  });

  it("reads the setting and says whether sending is switched on", async () => {
    mocks.userRpc.mockResolvedValue({ data: true, error: null });
    const { GET } = await import("@/app/api/lead-email/route");
    expect(await (await GET(new Request(`${origin}/api/lead-email?businessId=${businessId}`))).json()).toEqual({ enabled: true, available: false });
    configured();
    expect(await (await GET(new Request(`${origin}/api/lead-email?businessId=${businessId}`))).json()).toEqual({ enabled: true, available: true });
    expect((await GET(new Request(`${origin}/api/lead-email?businessId=nope`))).status).toBe(400);
  });

  it("saves the switch through the owner-checked function", async () => {
    mocks.userRpc.mockResolvedValue({ data: false, error: null });
    const { POST } = await import("@/app/api/lead-email/route");
    const response = await POST(post({ businessId, enabled: false }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false, available: false });
    expect(mocks.userRpc).toHaveBeenCalledWith("lead_email_setting_set", { p_business_id: businessId, p_enabled: false });
  });

  it("rejects cross-origin, malformed and foreign-business requests", async () => {
    const { POST } = await import("@/app/api/lead-email/route");
    expect((await POST(post({ businessId, enabled: false }, "https://evil.example"))).status).toBe(403);
    for (const body of [{ businessId }, { businessId, enabled: "no" }, { businessId, enabled: true, extra: 1 }, null]) {
      expect((await POST(post(body))).status).toBe(400);
    }
    expect(mocks.userRpc).not.toHaveBeenCalled();
    mocks.userRpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect((await POST(post({ businessId, enabled: true }))).status).toBe(404);
  });
});
