import type { ChatMessage } from "@/lib/llm";

/** Minimal brand context the prompt builders need. `Business` satisfies this. */
export interface BrandContext {
  name: string;
  vertical?: string | null;
  description?: string | null;
  brand_voice?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  target_audience?: string | null;
  usps?: string[];
  offers?: string[];
  languages?: string[];
  locations?: string[];
  website?: string | null;
  logo_url?: string | null;
}

export interface AdAngle {
  id: string;
  name: string;
  /** What this angle emphasises in the copy. */
  description: string;
  /** Visual mood/direction for the image (the subject comes from the industry + brief). */
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
  },
  {
    id: "problem",
    name: "Solve a pain point",
    description:
      "Lead with the customer's problem, then the relief the business provides.",
    imageHint:
      "reassuring, solution-focused mood, crisp and modern composition",
  },
  {
    id: "offer",
    name: "Special offer / incentive",
    description:
      "Highlight a current offer, discount, deal, or incentive to act.",
    imageHint:
      "energetic, celebratory advertising mood, vibrant and inviting",
  },
  {
    id: "trust",
    name: "Trusted & local",
    description:
      "Emphasise experience, quality, reviews, guarantees, and local track record.",
    imageHint:
      "trustworthy, precise and professional mood; skilled workers delivering the product/service in a real setting",
  },
  {
    id: "aspiration",
    name: "Lifestyle / aspiration",
    description: "Sell the better outcome or lifestyle the customer wants.",
    imageHint:
      "warm, optimistic, aspirational mood with soft golden light",
  },
  {
    id: "urgency",
    name: "Limited-time urgency",
    description: "Give a limited-time reason to enquire now.",
    imageHint:
      "dynamic, high-energy, bold and attention-grabbing mood",
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

/** Build a photorealistic, text-free image prompt for an angle. */
export function buildImagePrompt(
  brand: BrandContext,
  brief: string,
  angle: AdAngle,
  instructions?: string,
): string {
  const industry = brandIndustry(brand);
  const colorHint = brand.primary_color
    ? `subtle ${brand.primary_color} color accents, `
    : "";
  return (
    // Keep it short and subject-dominant: weak free models (flux/Pollinations)
    // drift to empty skies or stock portraits when the subject isn't the loud,
    // first thing in the prompt.
    `Photorealistic advertising photograph of ${brief}. ` +
    `The ${industry} product or work is the main subject, in sharp focus and ` +
    `filling most of the frame. ` +
    `${angle.imageHint}. ${colorHint}` +
    `natural daylight, high detail, realistic, shot on a DSLR, commercial quality. ` +
    `Avoid close-up portraits or headshots as the main subject. ` +
    `${instructions ? `Follow these brand instructions: ${instructions.slice(0, 500)}. ` : ""}` +
    `No text, no words, no logos, no watermarks.`
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
