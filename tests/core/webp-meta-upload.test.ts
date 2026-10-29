import { readFileSync } from "node:fs";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import tape from "./fixtures/meta/create.json";
import { MetaClient } from "@/lib/meta/client";
import { isWebp, jpegIfWebp, MAX_STORED_IMAGE_BYTES, storageWebp } from "@/lib/imageGen/encode";

// #1897: ads are stored as WebP to stop the bucket's growth; Meta's ad images get a JPEG. The upload replays Meta's
// recorded adimages answer from the launch tape.
type Exchange = { method: string; path: string; status: number; body: unknown };
const recorded = (Object.values(tape) as unknown as Exchange[]).find((exchange) => exchange.path?.endsWith("/adimages"))!;
afterEach(() => vi.restoreAllMocks());

function sentBytes(fetchMock: ReturnType<typeof vi.spyOn>): Buffer {
  const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
  return Buffer.from(new URLSearchParams(String(init.body)).get("bytes")!, "base64");
}

describe("core: WebP ads reach Meta as JPEG (#1897)", () => {
  const photo = readFileSync("public/solar-example.jpg");

  it("stores a smaller WebP under the size cap", async () => {
    const webp = (await storageWebp(photo))!;
    expect(isWebp(webp)).toBe(true);
    expect(webp.length).toBeLessThan(photo.length);
    expect(webp.length).toBeLessThanOrEqual(MAX_STORED_IMAGE_BYTES);
  });

  it("uploads a stored WebP as a JPEG and gets Meta's recorded hash back", async () => {
    const webp = (await storageWebp(photo))!;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(recorded.body, { status: recorded.status }));
    const client = new MetaClient({ adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" });
    const hash = await client.uploadAdImageBytes(webp);
    expect(hash).toBe((recorded.body as { images: { bytes: { hash: string } } }).images.bytes.hash);
    const sent = sentBytes(fetchMock);
    expect([...sent.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect((await sharp(sent).metadata()).format).toBe("jpeg");
  });

  it("sends a PNG or JPEG unchanged", async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#cfe0d6" } }).png().toBuffer();
    expect((await jpegIfWebp(png)).converted).toBe(false);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(recorded.body, { status: recorded.status }));
    await new MetaClient({ adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" }).uploadAdImageBytes(png);
    expect(sentBytes(fetchMock).equals(png)).toBe(true);
  });
});
