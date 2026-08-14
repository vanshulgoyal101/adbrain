import type { AdAngle, BrandContext, GeneratedCopy } from "@/lib/templates/ads";

/**
 * Ad "design spec" — the structured layout that turns a bare AI photo into a
 * finished, on-brand poster creative (logo + headline + benefit checklist +
 * contact/CTA bar), the way a human designer composes a Meta/WhatsApp ad.
 *
 * Everything in this module is pure and deterministic so it is fully unit
 * testable; the actual rasterisation lives in `render.tsx`.
 */

export type AdFormat = "portrait" | "square" | "story" | "landscape";

export interface AdDesignSpec {
  format: AdFormat;
  width: number;
  height: number;
  /** The AI-generated photo composited underneath the design (null = gradient). */
  backgroundUrl: string | null;
  brandName: string;
  logoUrl: string | null;
  headline: string;
  subhead: string | null;
  /** Short benefit chips shown with a check icon (0–4). */
  benefits: string[];
  contactLine: string | null;
  ctaLabel: string;
  /** Validated brand colour used for accents, chips and the CTA button. */
  primaryColor: string;
  /** Readable text colour to sit on top of `primaryColor`. */
  ctaTextColor: string;
}

export const DEFAULT_BRAND_COLOR = "#2563eb";

/**
 * Ad dimensions per placement. Portrait 4:5 is the default because it wins the
 * most vertical space in the Meta feed (best CTR for lead ads).
 */
export const AD_FORMATS: Record<AdFormat, { width: number; height: number }> = {
  portrait: { width: 1080, height: 1350 }, // 4:5 — Meta/Instagram feed
  square: { width: 1080, height: 1080 }, // 1:1 — universal
  story: { width: 1080, height: 1920 }, // 9:16 — stories / reels
  landscape: { width: 1200, height: 628 }, // 1.91:1 — link ads
};

export function formatDimensions(format: AdFormat): { width: number; height: number } {
  return AD_FORMATS[format] ?? AD_FORMATS.portrait;
}

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Normalise a colour to `#rrggbb`, falling back when it is missing/invalid. */
export function normalizeHex(
  input: string | null | undefined,
  fallback = DEFAULT_BRAND_COLOR,
): string {
  if (!input) return fallback;
  const match = HEX_RE.exec(input.trim());
  if (!match) return fallback;
  let hex = match[1];
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return `#${hex.toLowerCase()}`;
}

/** Pick black or white text for maximum contrast on a solid colour. */
export function readableTextOn(hex: string): string {
  const color = normalizeHex(hex);
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#0f172a" : "#ffffff";
}

// Strip emoji / pictographs so overlaid text stays clean and legible.
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\uFE0F]/gu;

function stripEmoji(s: string): string {
  return s.replace(EMOJI_RE, "").replace(/\s+/g, " ").trim();
}

/** Clamp to `maxLen` characters without cutting a word in half. */
function clampWords(s: string, maxLen: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  const cut = clean.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 8 ? cut.slice(0, lastSpace) : cut).trim();
}

function tidyBenefit(raw: string, maxLen: number): string {
  const s = stripEmoji(raw).replace(/[.;,]+$/, "").trim();
  if (!s) return "";
  const capped = clampWords(s, maxLen).replace(/[.;,]+$/, "").trim();
  return capped.charAt(0).toUpperCase() + capped.slice(1);
}

/**
 * Select up to `max` short benefit chips from the brand's USPs then offers,
 * de-duplicated and length-clamped so they render on one line each.
 */
export function pickBenefits(
  brand: BrandContext,
  max = 4,
  maxLen = 24,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...(brand.usps ?? []), ...(brand.offers ?? [])]) {
    if (typeof raw !== "string") continue;
    const benefit = tidyBenefit(raw, maxLen);
    if (!benefit) continue;
    const key = benefit.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(benefit);
    if (out.length >= max) break;
  }
  return out;
}

function hostFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    return new URL(withProtocol).hostname.replace(/^www\./i, "") || null;
  } catch {
    return null;
  }
}

/** Build the footer contact line from the brand's website and locality. */
export function deriveContactLine(brand: BrandContext): string | null {
  const site = hostFromUrl(brand.website);
  const locality =
    (brand.locations ?? []).map((l) => l?.trim()).filter(Boolean)[0] ?? null;
  if (site && locality) return `${site} · ${locality}`;
  return site ?? locality ?? null;
}

/** Derive a short supporting line from the ad's primary text. */
export function deriveSubhead(
  primaryText: string | null | undefined,
  maxLen = 64,
): string | null {
  if (!primaryText) return null;
  const firstLine = primaryText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!firstLine) return null;
  const sentence = firstLine.split(/(?<=[.!?])\s/)[0]?.trim() || firstLine;
  const clamped = clampWords(stripEmoji(sentence), maxLen);
  return clamped || null;
}

/** Clamp the headline to a poster-friendly length. */
export function shortenHeadline(headline: string, maxLen = 36): string {
  return clampWords(stripEmoji(headline ?? ""), maxLen);
}

/**
 * Compose a full ad design from the brand brain and the generated copy. The
 * background photo is threaded in separately (once it has been persisted).
 */
export function buildAdDesign(params: {
  brand: BrandContext;
  copy: GeneratedCopy;
  angle?: AdAngle;
  backgroundUrl?: string | null;
  format?: AdFormat;
}): AdDesignSpec {
  const { brand, copy } = params;
  const format = params.format ?? "portrait";
  const dims = formatDimensions(format);
  const primaryColor = normalizeHex(brand.primary_color);
  const headline = shortenHeadline(copy.headline) || brand.name;

  return {
    format,
    width: dims.width,
    height: dims.height,
    backgroundUrl: params.backgroundUrl ?? null,
    brandName: brand.name,
    logoUrl: brand.logo_url ?? null,
    headline,
    subhead: deriveSubhead(copy.primary_text),
    benefits: pickBenefits(brand),
    contactLine: deriveContactLine(brand),
    ctaLabel: (copy.cta ?? "").trim() || "Learn More",
    primaryColor,
    ctaTextColor: readableTextOn(primaryColor),
  };
}
