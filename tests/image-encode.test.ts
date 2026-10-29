import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { downloadJpeg, isWebp, jpegIfWebp, storageWebp } from "@/lib/imageGen/encode";

// #1897: storage WebP only when it is smaller; downloads and Meta get JPEG.
describe("image encode (#1897)", () => {
  it("keeps the original when WebP isn't smaller, and refuses non-images", async () => {
    const tiny = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).webp({ quality: 10 }).toBuffer();
    expect(await storageWebp(tiny)).toBeNull();
    await expect(storageWebp(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });

  it("turns a WebP into a JPEG", async () => {
    const webp = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#0a7" } }).webp().toBuffer();
    expect(isWebp(webp)).toBe(true);
    const out = await jpegIfWebp(webp);
    expect(out.converted).toBe(true);
    expect((await sharp(out.bytes).metadata()).format).toBe("jpeg");
  });

  it("a download is a JPEG with transparency on white, never black", async () => {
    const clear = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const out = await downloadJpeg(clear);
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect([info.format, info.channels]).toEqual(["raw", 3]);
    expect((await sharp(out).metadata()).format).toBe("jpeg");
    expect(Math.min(...data)).toBeGreaterThan(245);
    await expect(downloadJpeg(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});
