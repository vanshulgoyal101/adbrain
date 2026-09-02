import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "@/lib/security/headers";

describe("SECURITY_HEADERS", () => {
  const map = new Map(SECURITY_HEADERS.map((h) => [h.key, h.value]));

  it("sets the OWASP baseline headers", () => {
    expect(map.get("X-Content-Type-Options")).toBe("nosniff");
    expect(map.get("X-Frame-Options")).toBe("DENY");
    expect(map.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(map.get("Permissions-Policy")).toContain("geolocation=()");
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
