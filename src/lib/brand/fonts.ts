/**
 * Font choices the poster renderer can actually honour.
 *
 * Satori (the engine behind `ImageResponse`) only resolves families it has font
 * data for, plus the CSS generic families. Offering arbitrary font names would
 * silently do nothing, so the picker is limited to what genuinely renders.
 */
export interface BrandFont {
  id: string;
  label: string;
  /** The CSS `font-family` handed to the renderer. */
  cssFamily: string;
}

export const BRAND_FONTS: BrandFont[] = [
  { id: "sans", label: "Sans-serif — modern, clean", cssFamily: "sans-serif" },
  { id: "serif", label: "Serif — classic, editorial", cssFamily: "serif" },
  { id: "mono", label: "Monospace — technical", cssFamily: "monospace" },
];

export const DEFAULT_BRAND_FONT = BRAND_FONTS[0];

/**
 * Resolve a stored `business.font` to a renderable family. Brands saved before
 * the picker existed hold free text (e.g. "Inter"), which falls back to the
 * default rather than producing an unrenderable family.
 */
export function fontFamilyFor(id: string | null | undefined): string {
  const match = BRAND_FONTS.find((f) => f.id === (id ?? "").trim().toLowerCase());
  return (match ?? DEFAULT_BRAND_FONT).cssFamily;
}

/** The picker's value for a stored font, defaulting when it isn't one of ours. */
export function brandFontId(stored: string | null | undefined): string {
  const value = (stored ?? "").trim().toLowerCase();
  return BRAND_FONTS.some((f) => f.id === value) ? value : DEFAULT_BRAND_FONT.id;
}
