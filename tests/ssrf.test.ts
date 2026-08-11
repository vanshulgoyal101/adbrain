import { describe, expect, it } from "vitest";
import { isBlockedHost, parsePublicUrl } from "@/lib/security/ssrf";

describe("isBlockedHost", () => {
  it("blocks loopback and named internal hosts", () => {
    for (const h of [
      "localhost",
      "app.localhost",
      "db.local",
      "svc.internal",
      "127.0.0.1",
      "0.0.0.0",
      "::1",
      "::",
    ]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("blocks private and link-local IPv4 ranges", () => {
    for (const h of [
      "10.0.0.1",
      "192.168.1.1",
      "172.16.5.5",
      "172.31.255.255",
      "169.254.169.254", // cloud metadata endpoint
    ]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("allows public IPv4 outside private ranges", () => {
    for (const h of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1"]) {
      expect(isBlockedHost(h), h).toBe(false);
    }
  });

  it("blocks IPv6 link-local and unique-local", () => {
    for (const h of ["fe80::1", "fc00::1", "fd12:3456::1", "[::1]"]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("blocks IPv4-mapped IPv6 loopback bypass", () => {
    expect(isBlockedHost("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedHost("::ffff:169.254.169.254")).toBe(true);
  });

  it("blocks multicast and malformed octets, and empty host", () => {
    expect(isBlockedHost("224.0.0.1")).toBe(true);
    expect(isBlockedHost("999.1.1.1")).toBe(true);
    expect(isBlockedHost("")).toBe(true);
    expect(isBlockedHost("   ")).toBe(true);
  });

  it("allows a normal public hostname", () => {
    expect(isBlockedHost("solaride.in")).toBe(false);
    expect(isBlockedHost("www.example.com")).toBe(false);
  });
});

describe("parsePublicUrl", () => {
  it("adds https:// when missing", () => {
    expect(parsePublicUrl("example.com")?.toString()).toBe("https://example.com/");
  });

  it("preserves an explicit scheme and path", () => {
    expect(parsePublicUrl("http://example.com/about")?.toString()).toBe(
      "http://example.com/about",
    );
  });

  it("rejects blocked hosts", () => {
    expect(parsePublicUrl("http://localhost:3000")).toBeNull();
    expect(parsePublicUrl("169.254.169.254")).toBeNull();
    expect(parsePublicUrl("http://10.0.0.1/secret")).toBeNull();
  });

  it("rejects non-http(s) schemes", () => {
    expect(parsePublicUrl("ftp://example.com")).toBeNull();
    expect(parsePublicUrl("file:///etc/passwd")).toBeNull();
    expect(parsePublicUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects empty or unparseable input", () => {
    expect(parsePublicUrl("")).toBeNull();
    expect(parsePublicUrl("   ")).toBeNull();
    expect(parsePublicUrl("http://")).toBeNull();
  });
});
