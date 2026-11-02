import { beforeEach, describe, expect, it, vi } from "vitest";
import { SafeFetchError } from "@/lib/security/ssrf";

const { fetchPublicUrl } = vi.hoisted(() => ({ fetchPublicUrl: vi.fn() }));
vi.mock("@/lib/security/ssrf", async (actual) => ({ ...await actual<typeof import("@/lib/security/ssrf")>(), fetchPublicUrl }));

const { checkWebsiteReach, sameRegistrableDomain } = await import("@/lib/campaign/website-reach");

function landed(url: string) {
  const response = new Response("<html></html>", { status: 200 });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

describe("#2599 website reachability", () => {
  beforeEach(() => fetchPublicUrl.mockReset());

  it("passes a site that answers on its own domain, after a redirect to a subdomain", async () => {
    fetchPublicUrl.mockResolvedValueOnce(landed("https://shop.example.co.in/home"));
    await expect(checkWebsiteReach("https://example.co.in")).resolves.toEqual({ ok: true, finalUrl: "https://shop.example.co.in/home" });
    expect(fetchPublicUrl).toHaveBeenCalledWith("https://example.co.in", expect.objectContaining({ timeoutMs: 8_000 }));
  });

  it("fails a site that lands on another domain", async () => {
    fetchPublicUrl.mockResolvedValueOnce(landed("https://linktr.ee/example"));
    await expect(checkWebsiteReach("https://example.com")).resolves.toEqual({ ok: false, problem: "other_domain", finalHost: "linktr.ee" });
  });

  it.each([
    [new SafeFetchError("status", 404), { ok: false, problem: "status", status: 404 }],
    [new SafeFetchError("blocked"), { ok: false, problem: "blocked" }],
    [new SafeFetchError("fetch"), { ok: false, problem: "unreachable" }],
    [new DOMException("timed out", "TimeoutError"), { ok: false, problem: "unreachable" }],
  ])("names why a site can't be reached: %s", async (error, expected) => {
    fetchPublicUrl.mockRejectedValueOnce(error);
    await expect(checkWebsiteReach("https://example.com")).resolves.toEqual(expected);
  });

  it("treats each site on a shared host as its own domain", () => {
    expect(sameRegistrableDomain("https://www.example.com/a", "example.com")).toBe(true);
    expect(sameRegistrableDomain("https://alice.vercel.app", "https://bob.vercel.app")).toBe(false);
    expect(sameRegistrableDomain("https://example.com", "https://example.co.in")).toBe(false);
    expect(sameRegistrableDomain("http://localhost", "http://localhost")).toBe(false);
  });
});
