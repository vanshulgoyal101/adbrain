import type { ChatMessage } from "@/lib/llm";

/** Minimal brand context the prompt builders need. `Business` satisfies this. */
export interface BrandContext {
  name: string;
  description?: string | null;
  brand_voice?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  target_audience?: string | null;
  usps?: string[];
  offers?: string[];
  languages?: string[];
  locations?: string[];
}

export interface SolarAngle {
  id: string;
  name: string;
  /** What this angle emphasises in the copy. */
  description: string;
  /** Visual direction for the image prompt. */
  imageHint: string;
}

/** LLM output shape for ad copy. */
export interface GeneratedCopy {
  headline: string;
  primary_text: string;
  cta: string;
}

/** LLM output shape for website → brand extraction. */
export interface BrandExtraction {
  description?: string;
  brand_voice?: string;
  primary_color?: string;
  secondary_color?: string;
  target_audience?: string;
  usps?: string[];
  offers?: string[];
  languages?: string[];
}

/** Meta's supported call-to-action buttons for Leads/Traffic objectives. */
export const META_CTAS = [
  "Get Quote",
  "Learn More",
  "Contact Us",
  "Sign Up",
  "Get Offer",
  "Book Now",
  "Call Now",
] as const;

/** The core library of solar ad angles. */
export const SOLAR_ANGLES: SolarAngle[] = [
  {
    id: "savings",
    name: "Bill savings",
    description:
      "Slash monthly electricity bills; frame solar as money saved every month.",
    imageHint:
      "a happy homeowner looking at a low electricity bill, bright rooftop solar panels behind, sunny day",
  },
  {
    id: "independence",
    name: "Beat rising tariffs",
    description:
      "Escape rising grid tariffs and power cuts with your own energy source.",
    imageHint:
      "a modern Indian home fully powered by rooftop solar at golden hour, self-reliant and bright",
  },
  {
    id: "subsidy",
    name: "Government subsidy",
    description:
      "Highlight government subsidy / net-metering making solar more affordable now.",
    imageHint:
      "clean rooftop solar installation on a middle-class Indian home, official and trustworthy tone",
  },
  {
    id: "eco",
    name: "Clean energy for family",
    description:
      "Clean, green energy and a better future for the family and community.",
    imageHint:
      "a family on a rooftop with solar panels, greenery around, warm optimistic sunlight",
  },
  {
    id: "trust",
    name: "Trusted local installer",
    description:
      "Emphasise experience, quality installation, warranty, and local track record.",
    imageHint:
      "professional installers in uniform fitting solar panels on a rooftop, clean and precise work",
  },
  {
    id: "urgency",
    name: "Limited-time offer",
    description:
      "Seasonal/festive limited-time offer to prompt immediate enquiry.",
    imageHint:
      "vibrant rooftop solar panels under a bright sky, energetic and celebratory advertising mood",
  },
];

export function getAngle(id: string): SolarAngle | undefined {
  return SOLAR_ANGLES.find((a) => a.id === id);
}

export function getAngleByName(name: string): SolarAngle | undefined {
  return SOLAR_ANGLES.find((a) => a.name === name);
}

function brandSummary(brand: BrandContext): string {
  const lines: string[] = [`Business name: ${brand.name}`];
  if (brand.description) lines.push(`About: ${brand.description}`);
  if (brand.brand_voice) lines.push(`Brand voice: ${brand.brand_voice}`);
  if (brand.target_audience)
    lines.push(`Target audience: ${brand.target_audience}`);
  if (brand.usps?.length) lines.push(`USPs: ${brand.usps.join("; ")}`);
  if (brand.offers?.length) lines.push(`Current offers: ${brand.offers.join("; ")}`);
  if (brand.locations?.length)
    lines.push(`Locations served: ${brand.locations.join(", ")}`);
  if (brand.languages?.length)
    lines.push(`Languages: ${brand.languages.join(", ")}`);
  return lines.join("\n");
}

/** Build messages that ask the LLM for one ad's copy as strict JSON. */
export function buildCopyMessages(
  brand: BrandContext,
  brief: string,
  angle: SolarAngle,
  instructions?: string,
): ChatMessage[] {
  const langs = brand.languages?.length
    ? brand.languages.join(" and ")
    : "English";
  return [
    {
      role: "system",
      content:
        "You are an expert performance-marketing copywriter for a solar-energy " +
        "company running Meta (Facebook/Instagram) lead ads in India. You write " +
        "tight, high-converting, on-brand ad copy. You never invent facts, prices, " +
        "or guarantees that were not provided. Customer instructions, when present, " +
        "take priority over defaults. Output ONLY valid JSON.",
    },
    {
      role: "user",
      content: `BRAND BRAIN:
${brandSummary(brand)}
${instructions ? `\nCUSTOMER INSTRUCTIONS (highest priority — follow exactly):\n${instructions.slice(0, 6000)}\n` : ""}
CAMPAIGN BRIEF: ${brief}

ANGLE: ${angle.name} — ${angle.description}

Write ONE ad in ${langs}. Match the brand voice. Requirements:
- "headline": <= 40 characters, punchy, benefit-led.
- "primary_text": 2–4 short lines, scannable, at most one emoji, ends with a soft nudge to enquire. Do not fabricate specific prices, subsidy amounts, or guarantees unless present in the brand brain, instructions, or brief.
- "cta": choose exactly one of: ${META_CTAS.join(", ")}.

Return strict JSON: {"headline": string, "primary_text": string, "cta": string}`,
    },
  ];
}

/** Build a photorealistic, text-free image prompt for an angle. */
export function buildImagePrompt(
  brand: BrandContext,
  brief: string,
  angle: SolarAngle,
  instructions?: string,
): string {
  const colorHint = brand.primary_color
    ? `subtle ${brand.primary_color} color accents, `
    : "";
  return (
    `Professional advertising photograph for a solar energy brand. ` +
    `${angle.imageHint}. ${colorHint}` +
    `photorealistic, high detail, natural warm sunlight, clean composition, ` +
    `shot on a DSLR, commercial quality, aspirational and trustworthy mood. ` +
    `Context: ${brief}. ` +
    `${instructions ? `Follow these brand instructions: ${instructions.slice(0, 500)}. ` : ""}` +
    `Absolutely no text, no words, no logos, no watermarks in the image.`
  );
}

/** Build messages that extract brand fields from scraped website text. */
export function buildBrandExtractionMessages(
  websiteText: string,
  url: string,
): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You extract structured brand information from a company's website text. " +
        "Only use information present in the text — never invent. Output ONLY valid JSON.",
    },
    {
      role: "user",
      content: `Website URL: ${url}

WEBSITE TEXT (truncated):
"""
${websiteText.slice(0, 8000)}
"""

Extract what you can into strict JSON with these optional keys (omit a key if unknown):
{
  "description": string,            // 1–2 sentence summary of what they do
  "brand_voice": string,            // e.g. "friendly, trustworthy, no-jargon"
  "primary_color": string,          // hex like #0A7E3D if evident, else omit
  "secondary_color": string,
  "target_audience": string,
  "usps": string[],                 // unique selling points / differentiators
  "offers": string[],               // any promotions/offers mentioned
  "languages": string[]             // languages the site uses
}`,
    },
  ];
}
