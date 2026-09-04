import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

const pub = join(process.cwd(), "public");

describe("app icons", () => {
  const icons = manifest().icons ?? [];

  it("ships the PNG sizes Chrome's install prompt requires", () => {
    // An SVG-only manifest is rejected, which is why installs fell back to a
    // generic placeholder icon.
    for (const size of ["192x192", "512x512"]) {
      const match = icons.find(
        (i) => i.sizes === size && i.type === "image/png",
      );
      expect(match, `missing PNG icon ${size}`).toBeDefined();
    }
  });

  it("provides a maskable icon so Android doesn't crop the mark", () => {
    const maskable = icons.find((i) => i.purpose === "maskable");
    expect(maskable).toBeDefined();
    expect(maskable?.type).toBe("image/png");
  });

  it("has every manifest icon present on disk", () => {
    for (const icon of icons) {
      expect(existsSync(join(pub, icon.src!)), `missing ${icon.src}`).toBe(true);
    }
  });

  it("serves a real multi-size favicon.ico", () => {
    const ico = readFileSync(join(pub, "favicon.ico"));
    // ICONDIR: reserved=0, type=1 (icon), then the frame count.
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(2);
  });

  it("keeps the apple touch icon on disk", () => {
    expect(existsSync(join(pub, "apple-icon-180.png"))).toBe(true);
  });
});
