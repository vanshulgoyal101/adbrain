import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { isWebp, jpegIfWebp, storageWebp } from "@/lib/imageGen/encode";

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
});
