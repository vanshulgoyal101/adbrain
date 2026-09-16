import { describe, expect, it } from "vitest";
import { absoluteUrl, siteConfig } from "@/lib/site";
import { MARKETING_GUIDES } from "@/lib/seo/guides";
import sitemap from "@/app/sitemap";
import { generateMetadata, generateStaticParams } from "@/app/guides/[slug]/page";
import {
  breadcrumbSchema,
  contentPageGraph,
  faqSchema,
  MARKETING_FAQS,
  marketingGraph,
  organizationSchema,
  softwareApplicationSchema,
  serializeJsonLd,
  webPageSchema,
  webSiteSchema,
} from "@/lib/seo/jsonLd";

describe("site config", () => {
  it("discovers every guide with a stable content date and no private routes", () => {
    const entries = sitemap();
    expect(new Set(entries.map(entry => entry.url)).size).toBe(entries.length);
    for (const guide of MARKETING_GUIDES) {
      expect(entries).toContainEqual({ url: absoluteUrl(`/guides/${guide.slug}`), lastModified: guide.updated });
      expect(guide.sections.length).toBeGreaterThanOrEqual(3);
    }
    expect(entries.find(entry => entry.url === siteConfig.url)?.lastModified).toBeUndefined();
    expect(entries.some(entry => /\/(login|dashboard|api|connect)\b/.test(entry.url))).toBe(false);
  });

  it("generates only known guides with unique canonical and social metadata", async () => {
    expect(generateStaticParams()).toEqual(MARKETING_GUIDES.map(({ slug }) => ({ slug })));
    for (const guide of MARKETING_GUIDES) {
      const metadata = await generateMetadata({ params: Promise.resolve({ slug: guide.slug }) });
      expect(metadata.alternates?.canonical).toBe(`/guides/${guide.slug}`);
      expect(metadata.openGraph).toMatchObject({ title: guide.title, type: "article" });
      expect(metadata.twitter).toMatchObject({ title: guide.title, description: guide.description });
    }
    await expect(generateMetadata({ params: Promise.resolve({ slug: "not-a-guide" }) })).rejects.toThrow();
  });

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
  it("escapes HTML script boundaries without changing the JSON value", () => {
    const data = { name: "</script><script>alert(1)</script><!--" };
    const output = serializeJsonLd(data);
    expect(output).not.toContain("<");
    expect(JSON.parse(output)).toEqual(data);
  });
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

  it("describes the business application without inventing a price", () => {
    const app = softwareApplicationSchema();
    expect(app["@type"]).toBe("SoftwareApplication");
    expect(app.applicationCategory).toBe("BusinessApplication");
    expect(app.offers).toBeUndefined();
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

describe("faqSchema", () => {
  it("is a FAQPage with a Question/Answer per FAQ", () => {
    const schema = faqSchema();
    expect(schema["@type"]).toBe("FAQPage");
    const entities = schema.mainEntity as Array<{
      "@type": string;
      name: string;
      acceptedAnswer: { "@type": string; text: string };
    }>;
    expect(entities).toHaveLength(MARKETING_FAQS.length);
    for (const q of entities) {
      expect(q["@type"]).toBe("Question");
      expect(q.name.length).toBeGreaterThan(0);
      expect(q.acceptedAnswer["@type"]).toBe("Answer");
      expect(q.acceptedAnswer.text.length).toBeGreaterThan(0);
    }
  });

  it("has non-empty, unique questions and serializes", () => {
    const questions = MARKETING_FAQS.map((f) => f.question);
    expect(new Set(questions).size).toBe(questions.length);
    expect(() => JSON.stringify(faqSchema())).not.toThrow();
  });
});

describe("webPageSchema", () => {
  it("builds a WebPage tied to the website and org", () => {
    const page = webPageSchema({
      path: "/privacy",
      name: "Privacy Policy",
      description: "How we handle data.",
    });
    expect(page["@type"]).toBe("WebPage");
    expect(page.url).toBe(`${siteConfig.url}/privacy`);
    expect(page["@id"]).toBe(`${siteConfig.url}/privacy#webpage`);
    expect(page.isPartOf).toEqual({ "@id": `${siteConfig.url}/#website` });
  });
});

describe("breadcrumbSchema", () => {
  it("numbers items from 1 and resolves absolute urls", () => {
    const crumb = breadcrumbSchema([
      { name: "Home", path: "/" },
      { name: "Terms", path: "/terms" },
    ]);
    expect(crumb["@type"]).toBe("BreadcrumbList");
    const items = crumb.itemListElement as Array<{
      position: number;
      name: string;
      item: string;
    }>;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ position: 1, name: "Home", item: siteConfig.url });
    expect(items[1]).toMatchObject({
      position: 2,
      name: "Terms",
      item: `${siteConfig.url}/terms`,
    });
  });
});

describe("contentPageGraph", () => {
  it("bundles a WebPage + BreadcrumbList without repeating @context", () => {
    const graph = contentPageGraph({
      path: "/terms",
      name: "Terms of Service",
      description: "The rules.",
    });
    expect(graph["@context"]).toBe("https://schema.org");
    const types = graph["@graph"].map((n) => n["@type"]);
    expect(types).toEqual(["WebPage", "BreadcrumbList"]);
    for (const node of graph["@graph"]) {
      expect(node).not.toHaveProperty("@context");
    }
    expect(() => JSON.stringify(graph)).not.toThrow();
  });
});
