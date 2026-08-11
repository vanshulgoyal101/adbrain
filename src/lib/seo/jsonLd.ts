import { absoluteUrl, siteConfig } from "@/lib/site";

/**
 * Pure schema.org JSON-LD builders for the marketing surface. Kept
 * dependency-free and side-effect-free so they can be unit tested and embedded
 * in a server-rendered <script type="application/ld+json">.
 */

export interface JsonLdObject {
  "@context": "https://schema.org";
  "@type": string;
  "@id"?: string;
  [key: string]: unknown;
}

const ORG_ID = `${siteConfig.url}/#organization`;
const WEBSITE_ID = `${siteConfig.url}/#website`;
const APP_ID = `${siteConfig.url}/#app`;

/** The publishing organization behind AdBrain. */
export function organizationSchema(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORG_ID,
    name: siteConfig.name,
    url: siteConfig.url,
    description: siteConfig.shortDescription,
    logo: absoluteUrl("/icon.svg"),
    founder: { "@type": "Person", name: siteConfig.author },
  };
}

/** The website entity (enables sitelinks + name in search results). */
export function webSiteSchema(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: siteConfig.name,
    url: siteConfig.url,
    description: siteConfig.description,
    inLanguage: "en",
    publisher: { "@id": ORG_ID },
  };
}

/**
 * The product itself as a SoftwareApplication — the entity Google uses for
 * app/product rich results.
 */
export function softwareApplicationSchema(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": APP_ID,
    name: siteConfig.name,
    url: siteConfig.url,
    description: siteConfig.description,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    inLanguage: "en",
    publisher: { "@id": ORG_ID },
    featureList: [
      "AI-generated solar ad creative (image + copy)",
      "Brand Brain: reusable brand voice, USPs, and offers",
      "One-click Meta lead campaigns with AI-picked targeting",
      "Plain-language results and campaign summaries",
    ],
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
  };
}

/** The full @graph embedded on the marketing pages. */
export function marketingGraph(): { "@context": "https://schema.org"; "@graph": JsonLdObject[] } {
  const strip = (o: JsonLdObject) => {
    const { "@context": _omit, ...rest } = o;
    void _omit;
    return rest as JsonLdObject;
  };
  return {
    "@context": "https://schema.org",
    "@graph": [
      strip(organizationSchema()),
      strip(webSiteSchema()),
      strip(softwareApplicationSchema()),
    ],
  };
}
