import { normalizeWebsite } from "@/lib/brand/validation";

/** #2646: where the Brand sends customers by default. The composer can still change it per campaign. */
export type BrandDestination = "whatsapp" | "website";

/** A missing value (rows saved before #2656) or anything unexpected means WhatsApp, the original default. */
export function brandDestination(brand: { default_destination?: string | null }): BrandDestination {
  return brand.default_destination === "website" ? "website" : "whatsapp";
}

/**
 * #1136: a Brand Prepare can use: a name, a category, a service area, an offer and a way to reach the business:
 * a phone/WhatsApp number, or for a website business (#2646) a working link.
 * The scoreboard times sign-up → this point from the `brandUsable` flag on `business.create`/`business.update`.
 */
export function brandUsable(brand: {
  name?: string | null; vertical?: string | null; phone?: string | null;
  locations?: readonly string[] | null; offers?: readonly string[] | null;
  website?: string | null; default_destination?: string | null;
}): boolean {
  const filled = (value?: string | null) => Boolean(value?.trim());
  const reachable = brandDestination(brand) === "website" ? normalizeWebsite(brand.website) !== null : filled(brand.phone);
  return filled(brand.name) && filled(brand.vertical) && reachable
    && Boolean(brand.locations?.some(filled)) && Boolean(brand.offers?.some(filled));
}
