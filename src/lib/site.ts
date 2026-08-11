/**
 * Central site metadata used across SEO surfaces (page metadata, sitemap,
 * robots, JSON-LD, OpenGraph). Reads NEXT_PUBLIC_SITE_URL, which Next inlines at
 * build time, so this stays usable in both server and client components without
 * pulling in the full env validation (which requires Supabase to be configured).
 */

function normalizeUrl(raw: string | undefined): string {
  const fallback = "https://adbrain.vanshul.com";
  const value = (raw ?? "").trim() || fallback;
  // Strip a trailing slash so we can join paths predictably.
  return value.replace(/\/+$/, "");
}

export const siteConfig = {
  name: "AdBrain",
  url: normalizeUrl(process.env.NEXT_PUBLIC_SITE_URL),
  tagline: "AI ad creative for solar businesses",
  description:
    "AdBrain turns your brand into launch-ready solar ad creatives — image, headline, and copy — in seconds. Fill your brand brain, type a goal, and get on-brand Meta ads with AI-picked targeting.",
  // Short description for cards where space is tight.
  shortDescription:
    "AI ad creative + campaign launcher for solar installers. On-brand ads in seconds.",
  keywords: [
    "AI ads for solar",
    "solar ad creative",
    "solar lead generation",
    "solar marketing software",
    "Meta ads for solar installers",
    "AI ad generator",
    "solar advertising",
    "Advantage+ solar campaigns",
    "solar business marketing",
    "ad creative generator",
  ],
  author: "Vanshul Goyal",
  twitter: "@vanshulgoyal",
  locale: "en_US",
  category: "BusinessApplication",
} as const;

/** Absolute URL for a site-relative path (e.g. "/login" -> full URL). */
export function absoluteUrl(path = "/"): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${siteConfig.url}${suffix === "/" ? "" : suffix}` || siteConfig.url;
}
