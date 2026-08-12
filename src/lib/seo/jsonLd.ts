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

export interface FaqItem {
  question: string;
  answer: string;
}

/** Landing-page FAQs — also the single source for the FAQPage rich result. */
export const MARKETING_FAQS: FaqItem[] = [
  {
    question: "What is AdBrain?",
    answer:
      "AdBrain is an AI tool that creates ready-to-launch ad creatives (image, headline, and copy) for solar businesses and launches them as Meta lead campaigns. You fill in your brand once, type a goal, and get on-brand ads in seconds.",
  },
  {
    question: "Do I need to know how to use Meta Ads Manager?",
    answer:
      "No. AdBrain is built for solar business owners, not marketers. It writes the ads, picks the audience and location, and creates a paused campaign for you. Nothing spends until you review and activate it.",
  },
  {
    question: "How does AdBrain decide who sees my ads?",
    answer:
      "You can target specific cities or areas (with an adjustable radius), include or exclude locations, and set an age range — or let AdBrain choose based on your service areas and goal. Meta Advantage+ then optimises delivery within that audience.",
  },
  {
    question: "Will the ads match my brand?",
    answer:
      "Yes. Your Brand Brain stores your voice, unique selling points, colours, and offers, and every ad is generated from it. You can also add custom instructions (for example, always mention a 25-year warranty) that steer every generation.",
  },
  {
    question: "Does it cost money to run ads?",
    answer:
      "AdBrain creates campaigns in a paused state, so nothing is spent until you activate them in Meta. Your ad spend goes directly to Meta at the daily budget you choose.",
  },
  {
    question: "Can I see the leads my ads generate?",
    answer:
      "Yes. AdBrain pulls instant-form leads from Meta into a single inbox and can produce a plain-language, WhatsApp-ready digest of recent leads so you can follow up quickly.",
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
