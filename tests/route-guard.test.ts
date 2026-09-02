import { readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route guard (src/lib/supabase/middleware.ts, wired up by src/proxy.ts).
 * Anonymous users must be bounced from every app route *at the edge*, keeping
 * the page they wanted so login can return them there.
 */

const getUser = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

const request = (path: string, cookies: Record<string, string> = {}) => {
  const req = new NextRequest(`https://adbrain.vanshul.com${path}`);
  for (const [k, v] of Object.entries(cookies)) req.cookies.set(k, v);
  return req;
};

const anon = () => getUser.mockResolvedValue({ data: { user: null } });
const signedIn = () => getUser.mockResolvedValue({ data: { user: { id: "u1" } } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  delete process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS;
});

/** Every folder under src/app/(app) is a signed-in route. */
function appRoutes(): string[] {
  const dir = join(process.cwd(), "src", "app", "(app)");
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `/${e.name}`);
}

describe("route guard: protected routes", () => {
  it("redirects an anonymous visitor to login", async () => {
    anon();
    const { updateSession } = await import("@/lib/supabase/middleware");
    const res = await updateSession(request("/dashboard"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
  });

  it("remembers where the visitor was heading", async () => {
    anon();
    const { updateSession } = await import("@/lib/supabase/middleware");
    const res = await updateSession(request("/campaigns"));
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("redirect")).toBe("/campaigns");
  });

  it("guards nested paths too", async () => {
    anon();
    const { updateSession } = await import("@/lib/supabase/middleware");
    const res = await updateSession(request("/studio/abc"));
    expect(res.headers.get("location")).toContain("/login");
  });

  it("lets a signed-in user through", async () => {
    signedIn();
    const { updateSession } = await import("@/lib/supabase/middleware");
    const res = await updateSession(request("/dashboard"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("guards EVERY route under src/app/(app) — no page may be forgotten", async () => {
    anon();
    const { updateSession } = await import("@/lib/supabase/middleware");
    for (const route of appRoutes()) {
      const res = await updateSession(request(route));
      expect(
        res.headers.get("location"),
        `${route} is not guarded by the middleware`,
      ).toContain("/login");
    }
  });
});

describe("route guard: public routes", () => {
  it.each(["/", "/login", "/privacy", "/terms", "/data-deletion"])(
    "leaves %s reachable when signed out",
    async (path) => {
      anon();
      const { updateSession } = await import("@/lib/supabase/middleware");
      const res = await updateSession(request(path));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    },
  );

  it("errs on the side of guarding prefix lookalikes", async () => {
    anon();
    const { updateSession } = await import("@/lib/supabase/middleware");
    // Matching is prefix-based, so "/brandnew" is guarded too. That is the safe
    // direction to fail; a new public page must not start with a private prefix.
    const res = await updateSession(request("/brandnew"));
    expect(res.headers.get("location")).toContain("/login");
  });
});

describe("route guard: developer bypass", () => {
  it("ignores the dev cookie when the bypass is disabled", async () => {
    anon();
    const { updateSession } = await import("@/lib/supabase/middleware");
    const { DEV_AUTH_COOKIE } = await import("@/lib/dev-auth");
    const res = await updateSession(request("/dashboard", { [DEV_AUTH_COOKIE]: "1" }));
    expect(res.headers.get("location")).toContain("/login");
  });

  it("honours the dev cookie only when the bypass is enabled", async () => {
    anon();
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS = "true";
    const { updateSession } = await import("@/lib/supabase/middleware");
    const { DEV_AUTH_COOKIE } = await import("@/lib/dev-auth");
    const res = await updateSession(request("/dashboard", { [DEV_AUTH_COOKIE]: "1" }));
    expect(res.status).toBe(200);
  });

  it("rejects a forged dev cookie value", async () => {
    anon();
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS = "true";
    const { updateSession } = await import("@/lib/supabase/middleware");
    const { DEV_AUTH_COOKIE } = await import("@/lib/dev-auth");
    const res = await updateSession(request("/dashboard", { [DEV_AUTH_COOKIE]: "yes" }));
    expect(res.headers.get("location")).toContain("/login");
  });
});

describe("proxy config", () => {
  it("skips static assets and images", async () => {
    const { config } = await import("@/proxy");
    const matcher = config.matcher[0];
    expect(matcher).toContain("_next/static");
    expect(matcher).toContain("_next/image");
    expect(matcher).toContain("favicon.ico");
    for (const ext of ["svg", "png", "jpg", "jpeg", "gif", "webp"]) {
      expect(matcher).toContain(ext);
    }
  });

  it("delegates to updateSession", async () => {
    signedIn();
    const { proxy } = await import("@/proxy");
    const res = await proxy(request("/dashboard"));
    expect(res.status).toBe(200);
    expect(getUser).toHaveBeenCalled();
  });
});
