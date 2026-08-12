import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchPublicUrlText,
  isBlockedHost,
  parsePublicUrl,
  resolveRedirectTarget,
  SafeFetchError,
} from "@/lib/security/ssrf";

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

describe("resolveRedirectTarget", () => {
  const base = new URL("https://example.com/page");

  it("resolves and allows a public absolute redirect", () => {
    expect(resolveRedirectTarget("https://other.com/x", base)?.toString()).toBe(
      "https://other.com/x",
    );
  });

  it("resolves relative redirects against the base", () => {
    expect(resolveRedirectTarget("/next", base)?.toString()).toBe(
      "https://example.com/next",
    );
  });

  it("blocks a redirect to an internal IP (the SSRF bypass)", () => {
    expect(
      resolveRedirectTarget("http://169.254.169.254/latest/meta-data", base),
    ).toBeNull();
    expect(resolveRedirectTarget("http://localhost/admin", base)).toBeNull();
    expect(resolveRedirectTarget("http://10.0.0.5/", base)).toBeNull();
  });

  it("blocks a redirect to a non-http(s) scheme", () => {
    expect(resolveRedirectTarget("file:///etc/passwd", base)).toBeNull();
  });
});

describe("fetchPublicUrlText", () => {
  afterEach(() => vi.restoreAllMocks());

  const redirect = (location: string) =>
    new Response(null, { status: 302, headers: { location } });

  it("returns the body for a direct 200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>hi</html>", { status: 200 }),
    );
    await expect(fetchPublicUrlText("https://example.com")).resolves.toBe(
      "<html>hi</html>",
    );
  });

  it("rejects the initial URL when it is a blocked host", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(fetchPublicUrlText("http://169.254.169.254")).rejects.toThrow(
      SafeFetchError,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("blocks a redirect that points at cloud metadata (SSRF bypass)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      redirect("http://169.254.169.254/latest/meta-data"),
    );
    await expect(
      fetchPublicUrlText("https://evil.example.com"),
    ).rejects.toMatchObject({ code: "blocked" });
  });

  it("follows a safe redirect to another public host", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(redirect("https://other.example.com/x"))
      .mockResolvedValueOnce(new Response("final", { status: 200 }));
    await expect(fetchPublicUrlText("https://start.example.com")).resolves.toBe(
      "final",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after too many redirects", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      redirect("https://a.example.com/loop"),
    );
    await expect(
      fetchPublicUrlText("https://a.example.com", { maxRedirects: 2 }),
    ).rejects.toBeInstanceOf(SafeFetchError);
  });

  it("throws a status error for a non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 404 }),
    );
    await expect(
      fetchPublicUrlText("https://example.com"),
    ).rejects.toMatchObject({ code: "status", status: 404 });
  });
});
