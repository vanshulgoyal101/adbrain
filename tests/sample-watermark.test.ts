import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #1317, #1471: a sales prospect's exported ads say "Sample ad: not live yet" on the picture until the owner takes the account over.
const mocks = vi.hoisted(() => ({ download: vi.fn(), file: vi.fn(), lookup: vi.fn(), user: { id: "u1", email: "sales+prospect-sunpeak@team.example", email_confirmed_at: "2026-10-28T00:00:00Z" } as Record<string, unknown> }));
vi.mock("@/lib/internal-accounts.json", () => ({ default: { domains: ["team.example"], userIds: [], smokeUserIds: [], exemptFromFreeProviders: [] } }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/imageGen", () => ({ downloadImage: mocks.download }));
vi.mock("jszip", () => ({ default: class { file = mocks.file; generateAsync = async () => new ArrayBuffer(1); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: mocks.user } }) },
  from: () => ({ select: () => ({ in: mocks.lookup }) }),
}) }));

const { isProspectAccount } = await import("@/lib/internal-accounts");
const { sampleNoteCard, sampleWatermark, SAMPLE_LABEL } = await import("@/lib/creative/sample-watermark");
const picture = (format: "png" | "jpeg" | "webp", width = 400, height = 500) =>
  sharp({ create: { width, height, channels: 3, background: "#ffffff" } })[format]().toBuffer().then((buffer) => new Uint8Array(buffer));
const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue({ data: [{ id: ID, angle: "Offer", headline: "Free site survey", image_url: "https://example.com/a.png" }], error: null });
});

describe("isProspectAccount (#1317)", () => {
  it.each([
    [{ id: "a", email: "sales+prospect-sunpeak@team.example", email_confirmed_at: "2026-10-28" }, true],
    [{ id: "a", email: "sales+prospect@team.example", email_confirmed_at: "2026-10-28" }, true],
    [{ id: "a", email: "sales@team.example", email_confirmed_at: "2026-10-28" }, false],
    [{ id: "a", email: "sales+prospectus@team.example", email_confirmed_at: "2026-10-28" }, false],
    // The owner's own address after hand-over, and an unconfirmed team address, aren't prospects.
    [{ id: "a", email: "owner+prospect-x@gmail.com", email_confirmed_at: "2026-10-28" }, false],
    [{ id: "a", email: "sales+prospect-x@team.example", email_confirmed_at: null }, false],
  ])("%j → %s", (user, expected) => {
    expect(isProspectAccount(user)).toBe(expected);
  });
});

describe("sampleWatermark (#1317, #1471)", () => {
  const dark = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: "#203040" } }).png().toBuffer().then((buffer) => new Uint8Array(buffer));
  async function pixels(bytes: Uint8Array) {
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    return (x: number, y: number) => [0, 1, 2].map((c) => data[(y * info.width + x) * info.channels + c]);
  }

  it("says 'Sample ad: not live yet', matching Go live", () => {
    expect(SAMPLE_LABEL).toBe("Sample ad: not live yet");
  });

  it.each(["png", "jpeg", "webp"] as const)("keeps a %s's size and format", async (format) => {
    const marked = await sampleWatermark(await picture(format));
    expect(marked.contentType).toBe(`image/${format}`);
    const meta = await sharp(marked.bytes).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([400, 500, format]);
  });

  // #1471 (Designer): a light pill inset 4% of the width from the left and bottom, sized from the width, so 1:1 and
  // 9:16 match; the old full-width dark band read as a censor bar and covered the product.
  it.each([[1080, 1080], [1080, 1920]])("%ix%i: a light pill with an amber dot in the bottom-left corner, nothing else changed", async (width, height) => {
    const at = await pixels((await sampleWatermark(await dark(width, height))).bytes);
    const s = Math.round(0.04 * width), inset = Math.round(0.04 * width);
    const original = [0x20, 0x30, 0x40];
    const near = (pixel: number[], expected: number[]) => pixel.every((value, i) => Math.abs(value - expected[i]) < 12);
    // Inside the pill, just right of its left padding and at mid-height: light.
    const midY = height - inset - Math.round(s * 0.84);
    expect(Math.min(...at(inset + Math.round(s * 0.3), midY))).toBeGreaterThan(220);
    // The amber dot, after the left padding.
    const [r, g, b] = at(inset + Math.round(s * 0.9 + s * 0.29), midY);
    expect(r).toBeGreaterThan(200); expect(g).toBeGreaterThan(130); expect(g).toBeLessThan(190); expect(b).toBeLessThan(80);
    // Outside the pill: untouched (the foot's right side, above the pill, the top).
    expect(near(at(width - 10, height - 10), original)).toBe(true);
    expect(near(at(inset, height - inset - s * 3), original)).toBe(true);
    expect(near(at(10, 10), original)).toBe(true);
    expect(near(at(inset - 3, height - 3), original)).toBe(true);
  });

  // #1375: on Vercel an SVG <text> drew empty boxes (no system fonts). The words come from Pango with the bundled Inter,
  // the same path the ads' Hindi text uses in production; a local test can't see tofu, so it also guards the source.
  it("#1375: draws the words with the bundled font, never an SVG <text> that needs system fonts", async () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/creative/sample-watermark.ts"), "utf8");
    expect(source).not.toMatch(/<text\b/);
    expect(source).toMatch(/shapeText\(SAMPLE_LABEL/);
    const at = await pixels((await sampleWatermark(await dark(1080, 1080))).bytes);
    const s = 43, inset = 43, top = 1080 - inset - Math.round(s * 1.84);
    let ink = 0, right = 0;
    for (let y = top; y < 1080 - inset; y += 1) for (let x = inset + s * 2; x < 1080; x += 1) {
      const [r, g, b] = at(x, y);
      if (r < 90 && g < 90 && b < 90 && Math.abs(r - 0x20) + Math.abs(g - 0x30) + Math.abs(b - 0x40) > 30) { ink += 1; right = Math.max(right, x); }
    }
    expect(ink).toBeGreaterThan(1000);
    // The words end well before the right edge: a label, not a strip.
    expect(right).toBeGreaterThan(400);
    expect(right).toBeLessThan(700);
  });

  it("the note card: 1080 square, the page colour, the business named in dark ink", async () => {
    const card = await sampleNoteCard("SunPeak Solar");
    const meta = await sharp(card).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1080, 1080, "png"]);
    const at = await pixels(card);
    expect(at(5, 5)).toEqual([0xf6, 0xf7, 0xf4]);
    let ink = 0;
    for (let y = 200; y < 900; y += 2) for (let x = 80; x < 1000; x += 2) if (Math.max(...at(x, y)) < 80) ink += 1;
    expect(ink).toBeGreaterThan(2000);
  });

  it("refuses what isn't a picture", async () => {
    await expect(sampleWatermark(new TextEncoder().encode("not a picture"))).rejects.toThrow();
  });
});

describe("export for a prospect (#1317)", () => {
  it("marks every picture and says so in copy.txt", async () => {
    const original = await picture("png");
    mocks.download.mockResolvedValue({ bytes: original, contentType: "image/png" });
    const { POST } = await import("@/app/api/creatives/export/route");
    const response = await POST(new Request("http://localhost/api/creatives/export", { method: "POST", body: JSON.stringify({ creativeIds: [ID] }) }));
    expect(response.status).toBe(200);
    const [, bytes] = mocks.file.mock.calls.find(([name]) => String(name).endsWith(".png"))!;
    expect(Buffer.compare(Buffer.from(bytes as Uint8Array), Buffer.from(original))).not.toBe(0);
    expect(mocks.file).toHaveBeenCalledWith("copy.txt", expect.stringMatching(/^Sample ad: not live yet\. Made by AdBrain to show what your ads could look like\. They don't run, and you pay nothing, until you sign up and tap Go live\./));
    // #1471: the note card comes first in the zip.
    expect(mocks.file.mock.calls[0][0]).toBe("00-sample-note.png");
  });

  it("leaves out a picture it can't mark, never ships it unmarked", async () => {
    mocks.download.mockResolvedValue({ bytes: new TextEncoder().encode("broken"), contentType: "image/png" });
    const { POST } = await import("@/app/api/creatives/export/route");
    const response = await POST(new Request("http://localhost/api/creatives/export", { method: "POST", body: JSON.stringify({ creativeIds: [ID] }) }));
    expect(response.headers.get("X-Images-Skipped")).toBe("1");
    expect(mocks.file.mock.calls.filter(([name]) => /^ad-.*\.png$/.test(String(name)))).toHaveLength(0);
  });

  it("leaves an owner's export as it was", async () => {
    mocks.user = { id: "owner", email: "owner@gmail.com", email_confirmed_at: "2026-10-28" };
    const original = await picture("png");
    mocks.download.mockResolvedValue({ bytes: original, contentType: "image/png" });
    const { POST } = await import("@/app/api/creatives/export/route");
    await POST(new Request("http://localhost/api/creatives/export", { method: "POST", body: JSON.stringify({ creativeIds: [ID] }) }));
    const [, bytes] = mocks.file.mock.calls.find(([name]) => String(name).endsWith(".png"))!;
    expect(bytes).toBe(original);
    expect(mocks.file).toHaveBeenCalledWith("copy.txt", expect.not.stringContaining("Sample ad"));
    expect(mocks.file.mock.calls.map(([name]) => name)).not.toContain("00-sample-note.png");
  });
});
