import sharp from "sharp";
import { rasterize } from "@/lib/creative/render";
import { INDIC_SCRIPT, shapeText, type ShapedText } from "@/lib/creative/shaped-text";
import { downloadImage } from "@/lib/imageGen";
import type { CardLines } from "./offer";

const WIDTH = 1080;
const HEIGHT = 1920;
const MARGIN = 80;
const CONTENT = WIDTH - MARGIN * 2;
// WhatsApp Status draws its progress bar on top and the reply bar at the bottom; the card keeps clear of both.
const SAFE_TOP = 240;
const SAFE_BOTTOM = 260;
const INK = "#12263f";
const WHATSAPP = "#25d366";

export type ResultsCardInput = {
  businessName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  thumbnailUrl: string | null;
  lines: CardLines;
  /** "Made with AdBrain"; the owner can switch it off. */
  footer: boolean;
};

/** #2036: the weekly results card as a 1080×1920 JPEG for WhatsApp Status. No AI call; never money. */
export async function renderResultsCard(input: ResultsCardInput): Promise<Uint8Array> {
  const [logo, thumbnail, name, main, contact] = await Promise.all([
    input.logoUrl ? picture(input.logoUrl, 112, 112, "contain").catch(() => null) : null,
    input.thumbnailUrl ? picture(input.thumbnailUrl, CONTENT, 760, "inside").catch(() => null) : null,
    shaped(input.businessName, { size: 48, weight: 700, color: "#ffffff", maxWidth: CONTENT - 140 }),
    shaped(input.lines.main, { size: 84, weight: 800, color: "#ffffff", maxWidth: CONTENT }),
    input.lines.contact ? shaped(input.lines.contact, { size: 44, weight: 700, color: INK, maxWidth: CONTENT - 96 }) : null,
  ]);
  const png = await rasterize(
    <div style={{ width: WIDTH, height: HEIGHT, display: "flex", flexDirection: "column", backgroundColor: background(input.primaryColor),
      padding: `${SAFE_TOP}px ${MARGIN}px ${SAFE_BOTTOM}px`, fontFamily: "Inter", color: "#ffffff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        {logo && <div style={{ display: "flex", width: 132, height: 132, borderRadius: 28, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center" }}>
          <img src={logo.src} width={logo.width} height={logo.height} alt="" />
        </div>}
        <Words text={name} size={48} weight={700} color="#ffffff" />
      </div>
      <div style={{ display: "flex", marginTop: 72 }}>
        <Words text={main} size={84} weight={800} color="#ffffff" lineHeight={1.12} />
      </div>
      {thumbnail && <div style={{ display: "flex", marginTop: 56, flexGrow: 1, alignItems: "flex-start" }}>
        <img src={thumbnail.src} width={thumbnail.width} height={thumbnail.height} alt="" style={{ borderRadius: 28 }} />
      </div>}
      {!thumbnail && <div style={{ display: "flex", flexGrow: 1 }} />}
      {contact && <div style={{ display: "flex", alignSelf: "flex-start", marginTop: 48, padding: "26px 48px", borderRadius: 999, backgroundColor: WHATSAPP }}>
        <Words text={contact} size={44} weight={700} color={INK} />
      </div>}
      {input.footer && <div style={{ display: "flex", marginTop: 40, fontSize: 30, color: "rgba(255,255,255,0.72)" }}>Made with AdBrain</div>}
    </div>,
    { width: WIDTH, height: HEIGHT },
  );
  return new Uint8Array(await sharp(Buffer.from(png)).jpeg({ quality: 88, mozjpeg: true }).toBuffer());
}

type Text = string | ShapedText;

/** Devanagari and Gurmukhi are shaped by Pango (Satori can't place their vowel signs), the rest by Satori. */
function shaped(text: string, style: Parameters<typeof shapeText>[1]): Promise<Text> {
  return INDIC_SCRIPT.test(text) ? shapeText(text, style) : Promise.resolve(text);
}

function Words({ text, size, weight, color, lineHeight = 1.2 }: { text: Text; size: number; weight: number; color: string; lineHeight?: number }) {
   
  if (typeof text !== "string") return <img src={text.src} width={text.width} height={text.height} alt="" />;
  return <div style={{ display: "flex", fontSize: size, fontWeight: weight, color, lineHeight, maxWidth: CONTENT }}>{text}</div>;
}

/** The brand colour when white text reads on it; else a deep ink. */
function background(color: string | null): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color?.trim() ?? "")?.[1];
  if (!hex) return INK;
  const [r, g, b] = [0, 2, 4].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  // White on this colour is at least 4.5:1 below a relative luminance of about 0.18.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b <= 0.18 ? `#${hex}` : INK;
}

/** A picture fitted into the box, as a PNG data URL Satori can draw (it can't read WebP). */
async function picture(url: string, width: number, height: number, fit: "contain" | "inside"): Promise<ShapedText> {
  const image = await downloadImage(url);
  const { data, info } = await sharp(Buffer.from(image.bytes))
    .resize({ width, height, fit, background: { r: 255, g: 255, b: 255, alpha: 0 }, withoutEnlargement: fit === "inside" })
    .png().toBuffer({ resolveWithObject: true });
  return { src: `data:image/png;base64,${data.toString("base64")}`, width: info.width, height: info.height };
}
