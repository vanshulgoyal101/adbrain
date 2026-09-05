import { describe, expect, it } from "vitest";
import { getSecurityHeaders, SECURITY_HEADERS } from "@/lib/security/headers";

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

  it("uses non-empty string values for every header", () => {
    for (const { key, value } of SECURITY_HEADERS) {
      expect(key.length).toBeGreaterThan(0);
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
