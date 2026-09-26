import { afterEach, describe, expect, it, vi } from "vitest";
import { getSecurityHeaders, SECURITY_HEADERS } from "@/lib/security/headers";

afterEach(() => vi.unstubAllEnvs());

describe("SECURITY_HEADERS", () => {
  const map = new Map(SECURITY_HEADERS.map((h) => [h.key, h.value]));

  it("sets the OWASP baseline headers", () => {
    expect(map.get("X-Content-Type-Options")).toBe("nosniff");
    expect(map.get("X-Frame-Options")).toBe("DENY");
    expect(map.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(map.get("Permissions-Policy")).toContain("geolocation=()");
  });

  it("sets a restrictive CSP for the known runtime boundaries", () => {
    const csp = new Map(
      getSecurityHeaders("https://project.supabase.co").map((h) => [h.key, h.value]),
    ).get("Content-Security-Policy");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("https://project.supabase.co");
    expect(csp).toContain("https://vanshul.com");
    expect(csp).not.toContain("connect-src *");
  });

  it("has no duplicate header keys", () => {
    expect(map.size).toBe(SECURITY_HEADERS.length);
  });

  it("adds only explicit Razorpay origins for opted-in local checkout", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "");
    const headers = getSecurityHeaders("http://127.0.0.1:54321", true);
    const csp = headers.find(header => header.key === "Content-Security-Policy")!.value;
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://vanshul.com https://checkout.razorpay.com https://cdn.razorpay.com;");
    expect(csp).toContain("frame-src 'self' https://accounts.google.com https://www.facebook.com https://api.razorpay.com https://checkout.razorpay.com;");
    expect(csp).not.toContain("*.razorpay.com");
    expect(getSecurityHeaders("http://127.0.0.1:54321").some(header => header.value.includes("razorpay.com"))).toBe(false);
  });

  it.each([["production", ""], ["development", "preview"], ["development", "production"]])(
    "never grants checkout CSP in %s / %s even if requested", (nodeEnvironment, vercelEnvironment) => {
      vi.stubEnv("NODE_ENV", nodeEnvironment);
      vi.stubEnv("VERCEL_ENV", vercelEnvironment);
      expect(getSecurityHeaders("https://project.supabase.co", true).some(header => header.value.includes("razorpay.com"))).toBe(false);
    },
  );

  it("uses non-empty string values for every header", () => {
    for (const { key, value } of SECURITY_HEADERS) {
      expect(key.length).toBeGreaterThan(0);
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
