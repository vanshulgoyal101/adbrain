import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// #661: a real anonymous Pollinations image (Oct 26, 1080×1350 requested with nologo=true). Pollinations
// answered 686×858 with the "pollinations.ai" logo in the bottom-right, rows ~828–850.
// The free tier ignores nologo, so AdBrain trims the bottom strip before the image is stored or composed.
const recorded = readFileSync(join(__dirname, "fixtures/images/pollinations-watermarked.jpg"));
const LOGO_TOP_ROW = 828;
const fetched = vi.hoisted(() => ({ bytes: new Uint8Array() }));
vi.mock("@/lib/security/ssrf", () => ({ fetchPublicUrl: async () => new Response(fetched.bytes, { headers: { "content-type": "image/jpeg" } }) }));
const { downloadImage } = await import("@/lib/imageGen");

afterEach(() => vi.restoreAllMocks());

describe("core: free Pollinations images lose their watermark before use (#661)", () => {
  it("trims the recorded image's logo strip and keeps its 4:5 shape", async () => {
    fetched.bytes = recorded;
    const image = await downloadImage("https://image.pollinations.ai/prompt/rooftop%20solar?width=1080&height=1350&seed=42&model=flux&nologo=true");
    expect(image.height).toBeLessThan(LOGO_TOP_ROW);
    expect(image.width / image.height).toBeCloseTo(686 / 858, 2);
    expect(image.height).toBeGreaterThan(858 * 0.9);
  });

  it("leaves every other source untouched", async () => {
    fetched.bytes = recorded;
    expect(await downloadImage("https://example.com/owner-photo.jpg")).toMatchObject({ width: 686, height: 858 });
  });
});
