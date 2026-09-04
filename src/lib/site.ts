/**
 * Central site metadata used across SEO surfaces (page metadata, sitemap,
 * robots, JSON-LD, OpenGraph). Reads NEXT_PUBLIC_SITE_URL, which Next inlines at
 * build time, so this stays usable in both server and client components without
 * pulling in the full env validation (which requires Supabase to be configured).
 */

/**
 * Resolve the canonical origin from raw env input.
 *
 * `layout.tsx` feeds this to `new URL()` for `metadataBase`, so a malformed
 * value (e.g. a host with no scheme) would throw while rendering the root
 * layout — which no `error.tsx` can catch, taking the whole site down. A
 * non-http(s) scheme would instead silently poison every canonical, sitemap
 * entry and JSON-LD `@id`. Fall back to the known-good origin in both cases.
 */
export function normalizeSiteUrl(raw: string | undefined): string {
  const fallback = "https://adbrain.vanshul.com";
  const value = (raw ?? "").trim();
  if (!value) return fallback;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return fallback;
    }
    // Strip a trailing slash so we can join paths predictably.
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

export const siteConfig = {
  name: "AdBrain",
  url: normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL),
  tagline: "AI ad creative for any local business",
  description:
    "AdBrain turns your brand into launch-ready ad creatives — image, headline, and copy — in seconds. Fill your brand brain, type a goal, and get on-brand Meta ads with AI-picked targeting.",
  // Short description for cards where space is tight.
  shortDescription:
    "AI ad creative + campaign launcher for local businesses. On-brand ads in seconds.",
  keywords: [
    "AI ad creative",
    "AI ad generator",
    "ad creative generator",
    "lead generation software",
    "Meta ads for small business",
    "Facebook ad maker",
    "Instagram ad maker",
    "AI marketing software",
    "local business advertising",
    "Advantage+ campaigns",
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
