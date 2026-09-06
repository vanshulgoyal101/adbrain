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

/** A single content page (privacy, terms, etc.), tied to the WebSite entity. */
export function webPageSchema(opts: {
  path: string;
  name: string;
  description: string;
}): JsonLdObject {
  const url = absoluteUrl(opts.path);
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    url,
    name: opts.name,
    description: opts.description,
    inLanguage: "en",
    isPartOf: { "@id": WEBSITE_ID },
    publisher: { "@id": ORG_ID },
  };
}

/** Breadcrumb trail so Google shows the site hierarchy under the result. */
export function breadcrumbSchema(
  items: { name: string; path: string }[],
): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
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
      "AI-generated ad creative (image + copy)",
      "Brand Brain: reusable brand voice, USPs, and offers",
      "Facebook and Instagram campaigns with reviewed targeting and paused creation",
      "Plain-language results and campaign summaries",
      "Instant-form enquiry inbox and shareable lead digest",
    ],
  };
}

/** Drop the per-node @context so nodes can be embedded inside a single @graph. */
function stripContext(o: JsonLdObject): JsonLdObject {
  const { "@context": _omit, ...rest } = o;
  void _omit;
  return rest as JsonLdObject;
}

type Graph = { "@context": "https://schema.org"; "@graph": JsonLdObject[] };

/** The full @graph embedded on the marketing pages. */
export function marketingGraph(): Graph {
  return {
    "@context": "https://schema.org",
    "@graph": [
      stripContext(organizationSchema()),
      stripContext(webSiteSchema()),
      stripContext(softwareApplicationSchema()),
    ],
  };
}

/** @graph for a standalone content page (privacy, terms) with a breadcrumb. */
export function contentPageGraph(opts: {
  path: string;
  name: string;
  description: string;
}): Graph {
  return {
    "@context": "https://schema.org",
    "@graph": [
      stripContext(webPageSchema(opts)),
      stripContext(
        breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: opts.name, path: opts.path },
        ]),
      ),
    ],
  };
}

export interface FaqItem {
  question: string;
  answer: string;
}

/** Landing-page FAQs — also the single source for the FAQPage rich result. */
export const MARKETING_FAQS: FaqItem[] = [
  {
    question: "What is AdBrain?",
    answer:
      "AdBrain helps local businesses create marketing campaigns around their brand, offer, and customers. Create images and copy with AI, review the work, plan Facebook and Instagram campaigns, and follow up on form enquiries in one workspace.",
  },
  {
    question: "Do I need to know how to use Meta Ads Manager?",
    answer:
      "You can create and export marketing creative without connecting Meta. To publish a campaign, connect an eligible Meta ad account and Facebook Page, review your audience and budget, and create the campaign paused. Meta permissions and review still apply.",
  },
  {
    question: "How do I reach the right people?",
    answer:
      "Start with your customer goal and service areas. Review suggested locations, radius, and age range before creating a campaign. Meta controls delivery within its targeting rules; neither audience suggestions nor AI creative guarantee enquiries or sales.",
  },
  {
    question: "Will the marketing sound like my business?",
    answer:
      "Your Brand Brain holds your voice, offers, service areas, and visual assets. These guide generation, along with any custom instructions you add. AI can still get details wrong, so check the image, claims, and copy before approving the work.",
  },
  {
    question: "When does a campaign start spending?",
    answer:
      "New campaigns are created paused. Activating a campaign is a separate decision, and advertising spend is billed by Meta. Review the total campaign budget, including any split tests, before activation. AdBrain's spend checks are a backstop, not a guaranteed hard spending limit.",
  },
  {
    question: "What happens after someone gets in touch?",
    answer:
      "Sync Meta instant-form enquiries into the lead inbox, review contact details, and prepare a digest for your team. Calls and WhatsApp conversations stay in their respective channels. AdBrain does not automatically contact customers or track follow-up status yet.",
  },
];

/** FAQPage structured data for rich results. */
export function faqSchema(faqs: FaqItem[] = MARKETING_FAQS): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${siteConfig.url}/#faq`,
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };
}
