/**
 * #1136: a Brand Prepare can use: a name, a category, a service area, a phone/WhatsApp number and an offer.
 * The scoreboard times sign-up → this point from the `brandUsable` flag on `business.create`/`business.update`.
 */
export function brandUsable(brand: {
  name?: string | null; vertical?: string | null; phone?: string | null;
  locations?: readonly string[] | null; offers?: readonly string[] | null;
}): boolean {
  const filled = (value?: string | null) => Boolean(value?.trim());
  return filled(brand.name) && filled(brand.vertical) && filled(brand.phone)
    && Boolean(brand.locations?.some(filled)) && Boolean(brand.offers?.some(filled));
}
