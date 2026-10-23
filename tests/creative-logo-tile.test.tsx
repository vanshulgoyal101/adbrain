import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { ReactElement } from "react";
import { buildAdDesign } from "@/lib/creative/design";

const logo = vi.hoisted(() => ({ bytes: new Uint8Array() }));
vi.mock("@/lib/imageGen", () => ({
  downloadImage: vi.fn(async () => ({ bytes: logo.bytes, contentType: "image/png" })),
}));

import { AdComposite, logoTileWidth, renderCompositeAd } from "@/lib/creative/render";

const design = buildAdDesign({
  brand: { name: "Solaride", logo_url: "https://cdn.example/logo.png" },
  copy: { headline: "Power your home with the sun", primary_text: "Clean energy.", cta: "Get Quote" },
});

function findLogo(node: unknown): { width: number; height: number; style: { width: number; height: number } } | null {
  const el = node as ReactElement<Record<string, unknown>> | null;
  if (!el || typeof el !== "object" || !("props" in el)) return null;
  if (el.type === "img" && el.props.src === design.logoUrl) return el.props as never;
  const children = el.props.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findLogo(child);
    if (found) return found;
  }
  return null;
}

describe("brand logo tile", () => {
  it("keeps 64px height and widens by aspect ratio, clamped to 64..220", () => {
    expect(logoTileWidth(1, 1)).toBe(64);
    expect(logoTileWidth(0.5, 1)).toBe(64);
    expect(logoTileWidth(3, 1)).toBe(192);
    expect(logoTileWidth(8, 1)).toBe(220);
    expect(logoTileWidth(3, 2)).toBe(384);
    expect(logoTileWidth(Number.NaN, 1)).toBe(64);
  });

  it("sizes the tile img from the logo ratio at the canvas scale", () => {
    const s = design.width / 1080;
    const wide = findLogo(AdComposite({ spec: design, logoRatio: 3 }));
    expect(wide?.style.width).toBe(Math.round(192 * s));
    expect(wide?.style.height).toBe(Math.round(64 * s));
    const square = findLogo(AdComposite({ spec: design }));
    expect(square?.style.width).toBe(Math.round(64 * s));
    expect(square?.style.height).toBe(Math.round(64 * s));
  });

  it("paints a 3:1 logo across a wide tile and leaves a square logo at 64px", async () => {
    const pad = Math.round(Math.min(64 * (design.width / 1080), design.height * 0.06));
    const probe = async (w: number, h: number) => {
      logo.bytes = new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: "#ff0000" } }).png().toBuffer());
      const png = await renderCompositeAd(design);
      const { data, info } = await sharp(Buffer.from(png)).raw().toBuffer({ resolveWithObject: true });
      const at = (x: number, y: number) => {
        const i = (y * info.width + x) * info.channels;
        return [data[i], data[i + 1], data[i + 2]];
      };
      return { inside: at(pad + 150, pad + 32), shortTile: at(pad + 32, pad + 32) };
    };
    const wide = await probe(300, 100);
    expect(wide.shortTile).toEqual([255, 0, 0]);
    expect(wide.inside).toEqual([255, 0, 0]);
    const square = await probe(100, 100);
    expect(square.shortTile).toEqual([255, 0, 0]);
    expect(square.inside).not.toEqual([255, 0, 0]);
  });
});
