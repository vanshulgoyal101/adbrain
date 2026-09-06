#!/usr/bin/env node
/**
 * Generate the landing-page Lucide Brain mark and rasterise the formats SVG
 * alone doesn't satisfy:
 *   - public/logo.svg      portable monochrome mark for other product surfaces
 *   - public/icon.svg      browser mark with a contrasting blue background
 *   - public/favicon.ico   browsers/OS surfaces still request /favicon.ico
 *   - public/icon-192.png  Chrome PWA install requires PNG (SVG is rejected)
 *   - public/icon-512.png
 *   - public/maskable-512.png  full-bleed so Android doesn't crop the corners
 *   - public/apple-icon-180.png
 *
 * Run: npm run generate:icons
 */
import { writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Brain } from "lucide-react";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");
const mark = (props = {}) => createElement(Brain, { xmlns: "http://www.w3.org/2000/svg", "aria-hidden": true, ...props });
const logo = renderToStaticMarkup(mark());
const appIcon = (maskable = false) => Buffer.from(renderToStaticMarkup(
  createElement("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 64 64", width: 64, height: 64 },
    createElement("rect", { width: 64, height: 64, rx: maskable ? 0 : 12, fill: "#2563eb" }),
    mark({ x: maskable ? 14 : 10, y: maskable ? 14 : 10, width: maskable ? 36 : 44, height: maskable ? 36 : 44, color: "#ffffff" }),
  ),
));
const svg = appIcon();
writeFileSync(join(pub, "logo.svg"), logo + "\n");
writeFileSync(join(pub, "icon.svg"), svg + "\n");

/**
 * Keep the maskable mark within the central safe circle on a full-bleed background.
 */
const maskableSvg = appIcon(true);

const png = (input, size) =>
  sharp(input, { density: 384 }).resize(size, size).png().toBuffer();

/** Minimal ICO container holding PNG frames (supported by all modern browsers). */
function buildIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(frames.length, 4);

  let offset = 6 + frames.length * 16;
  const entries = frames.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // palette count
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });

  return Buffer.concat([header, ...entries, ...frames.map((f) => f.data)]);
}

const icoSizes = [16, 32, 48];
const frames = [];
for (const size of icoSizes) {
  frames.push({ size, data: await png(svg, size) });
}
writeFileSync(join(pub, "favicon.ico"), buildIco(frames));

writeFileSync(join(pub, "icon-192.png"), await png(svg, 192));
writeFileSync(join(pub, "icon-512.png"), await png(svg, 512));
writeFileSync(join(pub, "apple-icon-180.png"), await png(svg, 180));
writeFileSync(join(pub, "maskable-512.png"), await png(maskableSvg, 512));

console.log(
  `Wrote favicon.ico (${icoSizes.join("/")}), icon-192, icon-512, maskable-512, apple-icon-180.`,
);
