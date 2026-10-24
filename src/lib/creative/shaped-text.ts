import path from "node:path";
import sharp from "sharp";

/** Devanagari (Hindi, Marathi) and Gurmukhi (Punjabi): Satori can't place their vowel signs. */
export const INDIC_SCRIPT = /[\u0900-\u097F\u0A00-\u0A7F]/;

export type ShapedText = { src: string; width: number; height: number };

const FONT_DIR = path.join(process.cwd(), "src/lib/creative/fonts");
const FAMILIES = "Noto Sans Devanagari, Noto Sans Gurmukhi, Inter";
// Fontconfig keeps every registered file for the process, so Pango can fall back across the
// family list (Latin letters and digits come from Inter; the Noto Indic fonts have no Latin).
const FONT_FILES = [
  ["NotoSansDevanagari-Regular.ttf", "Noto Sans Devanagari"],
  ["NotoSansDevanagari-Bold.ttf", "Noto Sans Devanagari Bold"],
  ["NotoSansGurmukhi-Regular.ttf", "Noto Sans Gurmukhi"],
  ["NotoSansGurmukhi-Bold.ttf", "Noto Sans Gurmukhi Bold"],
  ["Inter-Regular.ttf", "Inter"],
  ["Inter-Bold.ttf", "Inter Bold"],
] as const;
let registered: Promise<void> | undefined;

function registerFonts(): Promise<void> {
  registered ??= (async () => {
    for (const [file, font] of FONT_FILES) {
      await sharp({ text: { text: "x", font: `${font} 8`, fontfile: path.join(FONT_DIR, file), rgba: true } }).png().toBuffer();
    }
  })().catch((error: unknown) => {
    registered = undefined;
    throw error;
  });
  return registered;
}

const escapeMarkup = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Shape and wrap `text` with Pango/HarfBuzz (via sharp) into a transparent PNG the ad layout
 * draws in place of the words. Sizes are pixels; weights of 600 and above use the bold fonts.
 */
export async function shapeText(text: string, style: { size: number; weight: number; color: string; maxWidth: number }): Promise<ShapedText> {
  await registerFonts();
  const bold = style.weight >= 600 ? " Bold" : "";
  const png = await sharp({
    text: {
      text: `<span foreground="${style.color}">${escapeMarkup(text)}</span>`,
      font: `${FAMILIES}${bold} ${Math.round(style.size)}`,
      width: Math.max(1, Math.floor(style.maxWidth)),
      dpi: 72,
      wrap: "word",
      rgba: true,
    },
  }).png().toBuffer();
  const { width = 1, height = 1 } = await sharp(png).metadata();
  return { src: `data:image/png;base64,${png.toString("base64")}`, width, height };
}
