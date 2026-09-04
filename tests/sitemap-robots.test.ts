import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { LEGAL_LINKS } from "@/lib/legal-links";
import { absoluteUrl, siteConfig } from "@/lib/site";

describe("LEGAL_LINKS", () => {
  it("covers the compliance pages Meta app review requires", () => {
    expect(LEGAL_LINKS.map((l) => l.href)).toEqual([
      "/privacy",
      "/terms",
      "/data-deletion",
    ]);
  });

  it("only points at public routes that are in the sitemap", () => {
    const urls = new Set(sitemap().map((e) => e.url));
    for (const link of LEGAL_LINKS) {
      expect(urls.has(absoluteUrl(link.href))).toBe(true);
    }
  });

  it("is never blocked from crawling by robots", () => {
    const rules = robots();
    const rule = Array.isArray(rules.rules) ? rules.rules[0] : rules.rules;
    const disallow = ([] as string[]).concat(rule?.disallow ?? []);
    for (const link of LEGAL_LINKS) {
      expect(disallow).not.toContain(link.href);
    }
  });

  it("labels every link", () => {
    for (const l of LEGAL_LINKS) expect(l.label.trim().length).toBeGreaterThan(0);
  });
});

describe("sitemap", () => {
  const entries = sitemap();
  const urls = entries.map((e) => e.url);

  it("lists exactly the public, indexable routes", () => {
    expect(new Set(urls)).toEqual(
      new Set([
        absoluteUrl("/"),
        absoluteUrl("/privacy"),
        absoluteUrl("/terms"),
        absoluteUrl("/data-deletion"),
      ]),
    );
  });

  it("includes the Meta-required data-deletion URL", () => {
    // Meta app review requires a reachable, indexable data-deletion page.
    expect(urls).toContain(absoluteUrl("/data-deletion"));
  });

  it("uses absolute URLs and valid priorities, with the homepage highest", () => {
    for (const e of entries) {
      expect(e.url.startsWith(siteConfig.url)).toBe(true);
      expect(e.priority).toBeGreaterThanOrEqual(0);
      expect(e.priority).toBeLessThanOrEqual(1);
    }
    const home = entries.find((e) => e.url === absoluteUrl("/"));
    expect(home?.priority).toBe(1);
  });

  it("has no duplicate URLs", () => {
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("robots", () => {
  const rules = robots();
  const rule = Array.isArray(rules.rules) ? rules.rules[0] : rules.rules;
  const disallow = ([] as string[]).concat(rule?.disallow ?? []);

  it("keeps every auth-gated app route and the api/auth surfaces out of the index", () => {
    for (const path of [
      "/api/",
      "/auth/",
      "/dashboard",
      "/create",
      "/brand",
      "/studio",
      "/campaigns",
      "/leads",
      "/assets",
      "/settings",
    ]) {
      expect(disallow).toContain(path);
    }
  });

  it("allows the marketing root and points at the sitemap", () => {
    expect(rule?.allow).toBe("/");
    expect(rules.sitemap).toBe(absoluteUrl("/sitemap.xml"));
  });

  it("does not disallow public content pages", () => {
    for (const path of ["/privacy", "/terms", "/data-deletion"]) {
      expect(disallow).not.toContain(path);
    }
  });
});
