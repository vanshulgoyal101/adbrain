import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { fitPhoto } from "@/lib/creative/fit-photo";

// #1904 (#744 phase 1): an owner's phone photo is fitted to the ad's 4:5 or 1:1 without cutting the face off.
// The photos are drawn here (no binaries): a muted background with skin-tone "faces" where a centre crop would cut them.
const SKIN = "#e0ac8a";
async function photo(width: number, height: number, faces: { cx: number; cy: number; r: number }[]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#6b7a80"/>
    ${faces.map(({ cx, cy, r }) => `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${Math.round(r * 1.25)}" fill="${SKIN}"/>
      <circle cx="${cx - r / 3}" cy="${cy - r / 5}" r="${r / 9}" fill="#1f2937"/><circle cx="${cx + r / 3}" cy="${cy - r / 5}" r="${r / 9}" fill="#1f2937"/>`).join("")}
  </svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).jpeg().toBuffer());
}
/** Share of a region's pixels that are skin-tone (the drawn faces). */
async function skinShare(png: Buffer, region?: { left: number; top: number; width: number; height: number }) {
  const { data, info } = await (region ? sharp(png).extract(region) : sharp(png)).raw().toBuffer({ resolveWithObject: true });
  let skin = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (Math.abs(data[i] - 0xe0) < 30 && Math.abs(data[i + 1] - 0xac) < 30 && Math.abs(data[i + 2] - 0x8a) < 30) skin++;
  }
  return skin / (info.width * info.height);
}

describe("fitPhoto (#1904)", () => {
  it("portrait photo, face near the top: a 1:1 crop keeps the whole face (a centre crop would cut it)", async () => {
    const tall = await photo(1000, 2000, [{ cx: 500, cy: 260, r: 150 }]);
    const out = await fitPhoto(tall, 1080, 1080);
    expect(await sharp(out).metadata()).toMatchObject({ width: 1080, height: 1080 });
    // All of the face is in the picture: its area is ~π·150·187.5 of 1000² ≈ 8.8% after scaling to 1080.
    expect(await skinShare(out)).toBeGreaterThan(0.07);
    const centre = await sharp(Buffer.from(tall)).resize(1080, 1080, { fit: "cover", position: "centre" }).png().toBuffer();
    expect(await skinShare(centre)).toBeLessThan(0.01);
  });

  it("landscape photo, face at the left: a 4:5 crop keeps it", async () => {
    const wide = await photo(2400, 1200, [{ cx: 380, cy: 600, r: 180 }]);
    const out = await fitPhoto(wide, 1080, 1350);
    expect(await sharp(out).metadata()).toMatchObject({ width: 1080, height: 1350 });
    expect(await skinShare(out)).toBeGreaterThan(0.05);
  });

  it("a group photo too wide to crop: 'blur' keeps everyone, on a blurred copy of the photo", async () => {
    const group = await photo(2400, 1000, [{ cx: 300, cy: 500, r: 140 }, { cx: 1200, cy: 500, r: 140 }, { cx: 2100, cy: 500, r: 140 }]);
    const cropped = await fitPhoto(group, 1080, 1350);
    const blurred = await fitPhoto(group, 1080, 1350, "blur");
    expect(await sharp(blurred).metadata()).toMatchObject({ width: 1080, height: 1350 });
    // All three faces sit in the middle band of the blur fit (left, centre, right); a 4:5 crop can't hold all three.
    const thirds = async (png: Buffer) => Promise.all([0, 1, 2].map((i) => skinShare(png, { left: i * 360, top: 450, width: 360, height: 450 })));
    expect((await thirds(blurred)).every((share) => share > 0.02)).toBe(true);
    expect((await thirds(cropped)).some((share) => share < 0.005)).toBe(true);
  });

  it("a photo already at the ad's size comes back the same size, uncropped", async () => {
    const exact = await photo(1080, 1350, [{ cx: 540, cy: 300, r: 120 }]);
    const out = await fitPhoto(exact, 1080, 1350);
    expect(await sharp(out).metadata()).toMatchObject({ width: 1080, height: 1350 });
    expect(Math.abs(await skinShare(out) - await skinShare(await sharp(Buffer.from(exact)).png().toBuffer()))).toBeLessThan(0.01);
  });

  it("a phone photo's EXIF rotation is applied before fitting", async () => {
    const sideways = await sharp(Buffer.from(await photo(2000, 1000, [{ cx: 260, cy: 500, r: 150 }]))).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const out = await fitPhoto(new Uint8Array(sideways), 1080, 1080);
    // Rotated 90° clockwise, the face moves from the left edge to the top: it must still be in the picture.
    expect(await skinShare(out)).toBeGreaterThan(0.05);
  });
});
