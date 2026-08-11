import { describe, expect, it } from "vitest";
import { absoluteUrl, siteConfig } from "@/lib/site";
import {
  marketingGraph,
  organizationSchema,
  softwareApplicationSchema,
  webSiteSchema,
} from "@/lib/seo/jsonLd";

describe("site config", () => {
  it("exposes a normalized, slash-trimmed url", () => {
    expect(siteConfig.url).not.toMatch(/\/$/);
    expect(siteConfig.url).toMatch(/^https?:\/\//);
  });

  it("builds absolute urls for site-relative paths", () => {
    expect(absoluteUrl("/")).toBe(siteConfig.url);
    expect(absoluteUrl("/login")).toBe(`${siteConfig.url}/login`);
    expect(absoluteUrl("login")).toBe(`${siteConfig.url}/login`);
  });
});

describe("jsonLd builders", () => {
  it("organization has stable @id and required fields", () => {
    const org = organizationSchema();
    expect(org["@type"]).toBe("Organization");
    expect(org["@id"]).toBe(`${siteConfig.url}/#organization`);
    expect(org.name).toBe(siteConfig.name);
    expect(org.url).toBe(siteConfig.url);
  });

  it("website references the organization as publisher", () => {
    const site = webSiteSchema();
    expect(site["@type"]).toBe("WebSite");
    expect(site.publisher).toEqual({ "@id": `${siteConfig.url}/#organization` });
  });

  it("software application is a BusinessApplication with an offer", () => {
    const app = softwareApplicationSchema();
    expect(app["@type"]).toBe("SoftwareApplication");
    expect(app.applicationCategory).toBe("BusinessApplication");
    expect(app.offers).toMatchObject({ "@type": "Offer", price: "0" });
    expect(Array.isArray(app.featureList)).toBe(true);
  });

  it("graph embeds all three entities under a single @context", () => {
    const graph = marketingGraph();
    expect(graph["@context"]).toBe("https://schema.org");
    expect(graph["@graph"]).toHaveLength(3);
    // Nested entities must not repeat @context inside the graph.
    for (const node of graph["@graph"]) {
      expect(node).not.toHaveProperty("@context");
      expect(node).toHaveProperty("@type");
    }
    const types = graph["@graph"].map((n) => n["@type"]);
    expect(types).toEqual(["Organization", "WebSite", "SoftwareApplication"]);
  });

  it("produces valid serializable JSON", () => {
    expect(() => JSON.stringify(marketingGraph())).not.toThrow();
  });
});
