import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

/** Devanagari (Hindi, Marathi) and Gurmukhi (Punjabi): Satori can't place their vowel signs. */
export const INDIC_SCRIPT = /[\u0900-\u097F\u0A00-\u0A7F]/;

export type ShapedText = { src: string; width: number; height: number };

const FONT_DIR = path.join(process.cwd(), "src/lib/creative/fonts");
// Inter supplies Latin letters and digits; the Noto Indic fonts have none.
const FAMILIES = "Noto Sans Devanagari, Noto Sans Gurmukhi, Inter";
let configured = false;

/**
 * Point fontconfig at our font folder only, before Pango first starts. Otherwise a machine's own
 * fonts (Ubuntu ships other Devanagari faces) win, and ads would look different per server.
 */
function configureBundledFontsOnly() {
  if (configured) return;
  const dir = path.join(tmpdir(), "adbrain-fontconfig");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "fonts.conf");
  writeFileSync(file, `<?xml version="1.0"?>\n<fontconfig><dir>${FONT_DIR}</dir><cachedir>${path.join(dir, "cache")}</cachedir></fontconfig>\n`);
  process.env.FONTCONFIG_FILE = file;
  configured = true;
}

const escapeMarkup = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Shape and wrap `text` with Pango/HarfBuzz (via sharp) into a transparent PNG the ad layout
 * draws in place of the words. Sizes are pixels; weights of 600 and above use the bold fonts.
 */
export async function shapeText(text: string, style: { size: number; weight: number; color: string; maxWidth: number }): Promise<ShapedText> {
  configureBundledFontsOnly();
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
