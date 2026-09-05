import type { ChatMessage } from "@/lib/llm";

/** Minimal brand context the prompt builders need. `Business` satisfies this. */
export interface BrandContext {
  name: string;
  vertical?: string | null;
  description?: string | null;
  brand_voice?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  font?: string | null;
  target_audience?: string | null;
  usps?: string[];
  offers?: string[];
  languages?: string[];
  locations?: string[];
  website?: string | null;
  logo_url?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}

export interface AdAngle {
  id: string;
  name: string;
  /** What this angle emphasises in the copy. */
  description: string;
  /** Visual mood/direction for the image (the subject comes from the industry + brief). */
  imageHint: string;
  /** Composition direction that makes this angle visually distinct. */
  compositionHint: string;
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
  vertical?: string;
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

/**
 * Universal ad angles that work for any business. The specifics (product,
 * imagery, offer) come from the brand's industry, USPs, and the brief — so the
 * same six angles suit a solar installer, a dental clinic, or a gym.
 */
export const AD_ANGLES: AdAngle[] = [
  {
    id: "value",
    name: "Save money / value",
    description:
      "Emphasise the money saved or the clear value the customer gains.",
    imageHint:
      "bright, aspirational mood with warm natural light and a clean, premium look",
    compositionHint:
      "show the product or finished work in a believable real-world setting, with generous negative space on the left for a headline",
  },
  {
    id: "problem",
    name: "Solve a pain point",
    description:
      "Lead with the customer's problem, then the relief the business provides.",
    imageHint:
      "reassuring, solution-focused mood, crisp and modern composition",
    compositionHint:
      "use a clear before-to-after visual story or a problem-to-solution composition, with the resolved outcome dominant in the foreground",
  },
  {
    id: "offer",
    name: "Special offer / incentive",
    description:
      "Highlight a current offer, discount, deal, or incentive to act.",
    imageHint:
      "energetic, celebratory advertising mood, vibrant and inviting",
    compositionHint:
      "create a bold close product or service moment with a strong focal subject and clean open space near the top for an offer badge",
  },
  {
    id: "trust",
    name: "Trusted & local",
    description:
      "Emphasise experience, quality, reviews, guarantees, and local track record.",
    imageHint:
      "trustworthy, precise and professional mood; skilled workers delivering the product/service in a real setting",
    compositionHint:
      "show the real work, craft, team, or finished result in context; use an authentic documentary-style frame rather than a posed stock portrait",
  },
  {
    id: "aspiration",
    name: "Lifestyle / aspiration",
    description: "Sell the better outcome or lifestyle the customer wants.",
    imageHint:
      "warm, optimistic, aspirational mood with soft golden light",
    compositionHint:
      "show the customer-visible outcome in a lived-in environment, with layered depth and the subject placed off-center for editorial balance",
  },
  {
    id: "urgency",
    name: "Limited-time urgency",
    description: "Give a limited-time reason to enquire now.",
    imageHint:
      "dynamic, high-energy, bold and attention-grabbing mood",
    compositionHint:
      "use a decisive action moment, diagonal energy, and a visually clear focal subject without clutter or artificial sale graphics",
  },
];

export function getAngle(id: string): AdAngle | undefined {
  return AD_ANGLES.find((a) => a.id === id);
}

export function getAngleByName(name: string): AdAngle | undefined {
  return AD_ANGLES.find((a) => a.name === name);
}

/** The customer's industry, or a neutral fallback. */
export function brandIndustry(brand: BrandContext): string {
  return brand.vertical?.trim() || "local business";
}

function brandSummary(brand: BrandContext): string {
  const lines: string[] = [`Business name: ${brand.name}`];
  lines.push(`Industry: ${brandIndustry(brand)}`);
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
  // Real contact details, so the copy can point people somewhere concrete.
  const contact = [
    brand.address ? `address ${brand.address}` : null,
    brand.phone ? `phone ${brand.phone}` : null,
    brand.email ? `email ${brand.email}` : null,
  ].filter(Boolean);
  if (contact.length) lines.push(`Contact: ${contact.join(", ")}`);
  return lines.join("\n");
}

/** Build messages that ask the LLM for one ad's copy as strict JSON. */
export function buildCopyMessages(
  brand: BrandContext,
  brief: string,
  angle: AdAngle,
  instructions?: string,
  language?: string,
): ChatMessage[] {
  const industry = brandIndustry(brand);
  const langs =
    language?.trim() ||
    (brand.languages?.length ? brand.languages.join(" and ") : "English");
  return [
    {
      role: "system",
      content:
        `You are an expert performance-marketing copywriter for a ${industry} ` +
        "running Meta (Facebook/Instagram) lead ads in India. You write tight, " +
        "high-converting, on-brand ad copy. You never invent facts, prices, or " +
        "guarantees that were not provided. Customer instructions, when present, " +
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
- "primary_text": 2–4 short lines, scannable, at most one emoji, ends with a soft nudge to enquire. Do not fabricate specific prices, discounts, or guarantees unless present in the brand brain, instructions, or brief.
- "cta": choose exactly one of: ${META_CTAS.join(", ")}.

Return strict JSON: {"headline": string, "primary_text": string, "cta": string}`,
    },
  ];
}

/** Build a model-agnostic creative brief for a text-free image model. */
export function buildImagePrompt(
  brand: BrandContext,
  brief: string,
  angle: AdAngle,
  instructions?: string,
  format?: string,
): string {
  const industry = brandIndustry(brand);
  const colorHint = brand.primary_color
    ? `subtle ${brand.primary_color} color accents, `
    : "";
  return (
    // Keep it short and subject-dominant: weak free models (flux/Pollinations)
    // drift to empty skies or stock portraits when the subject isn't the loud,
    // first thing in the prompt.
    `Create a premium, photorealistic advertising image for this campaign: ${brief}. ` +
    `The ${industry} product, service, place, or finished work must be the unmistakable main subject, ` +
    `sharp and specific rather than a generic stock scene. ` +
    `Visual angle: ${angle.name} — ${angle.description}. ` +
    `Composition: ${angle.compositionHint}. ` +
    `Visual mood: ${angle.imageHint}. ${colorHint}` +
    `Use natural light, realistic materials, believable scale, strong subject separation, ` +
    `commercial photography, and a deliberate ${formatImageFraming(format)} framing. ` +
    `Avoid close-up portraits or headshots as the main subject; do not make a generic smiling-person image. ` +
    `Show the actual offering and its customer-visible context. If reference images are provided, preserve the real product, materials, proportions, and recognizable visual identity from them. ` +
    `${instructions ? `Follow these brand instructions without adding unverified claims: ${instructions.slice(0, 500)}. ` : ""}` +
    `No text, no words, no logos, no watermarks, no UI, no collage, no split-screen, no artificial typography.`
  );
}

function formatImageFraming(format?: string): string {
  if (format === "story") return "vertical 9:16 story/reel";
  if (format === "square") return "square 1:1 feed";
  if (format === "landscape") return "wide 1.91:1 link ad";
  return "vertical 4:5 feed";
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
  "vertical": string,              // the industry / business type, e.g. "solar energy", "dental clinic", "gym"
  "brand_voice": string,            // e.g. "friendly, trustworthy, no-jargon"
  "primary_color": string,          // hex like #2563EB if evident, else omit
  "secondary_color": string,
  "target_audience": string,
  "usps": string[],                 // unique selling points / differentiators
  "offers": string[],               // any promotions/offers mentioned
  "languages": string[]             // languages the site uses
}`,
    },
  ];
}
