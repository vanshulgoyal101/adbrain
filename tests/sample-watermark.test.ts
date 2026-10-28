import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #1317: a sales prospect's exported ads say "Sample: not live" on the picture until the owner takes the account over.
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
const { sampleWatermark } = await import("@/lib/creative/sample-watermark");
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

describe("sampleWatermark (#1317)", () => {
  it.each(["png", "jpeg", "webp"] as const)("darkens a band across the foot of a %s, same size and format, top untouched", async (format) => {
    const marked = await sampleWatermark(await picture(format));
    expect(marked.contentType).toBe(`image/${format}`);
    const meta = await sharp(marked.bytes).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([400, 500, format]);
    const { data } = await sharp(marked.bytes).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => data[(y * 400 + x) * (meta.channels ?? 3)];
    expect(at(10, 10)).toBeGreaterThan(240);
    expect(at(10, 495)).toBeLessThan(120);
  });
  // #1375: on Vercel an SVG <text> drew empty boxes (no system fonts). The words come from Pango with the bundled Inter,
  // the same path the ads' Hindi text uses in production; a local test can't see tofu, so it also guards the source.
  it("#1375: draws the words with the bundled font, never an SVG <text> that needs system fonts", async () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/creative/sample-watermark.ts"), "utf8");
    expect(source).not.toMatch(/<text\b/);
    expect(source).toMatch(/shapeText\(SAMPLE_LABEL/);
    const marked = await sampleWatermark(await picture("png", 1080, 1350));
    const { data, info } = await sharp(marked.bytes).raw().toBuffer({ resolveWithObject: true });
    const band = Math.round(1350 * 0.08);
    let ink = 0, left = 1080, right = 0;
    for (let y = 1350 - band; y < 1350; y += 1) for (let x = 0; x < 1080; x += 1) {
      if (data[(y * 1080 + x) * info.channels] > 200) { ink += 1; left = Math.min(left, x); right = Math.max(right, x); }
    }
    expect(ink).toBeGreaterThan(1000);
    // Centred words about a third of the width, not a full-width strip.
    expect(Math.abs((left + right) / 2 - 540)).toBeLessThan(30);
    expect(right - left).toBeGreaterThan(200);
    expect(right - left).toBeLessThan(800);
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
    expect(mocks.file).toHaveBeenCalledWith("copy.txt", expect.stringMatching(/^SAMPLE: NOT LIVE\. Made for a sales visit/));
  });

  it("leaves out a picture it can't mark, never ships it unmarked", async () => {
    mocks.download.mockResolvedValue({ bytes: new TextEncoder().encode("broken"), contentType: "image/png" });
    const { POST } = await import("@/app/api/creatives/export/route");
    const response = await POST(new Request("http://localhost/api/creatives/export", { method: "POST", body: JSON.stringify({ creativeIds: [ID] }) }));
    expect(response.headers.get("X-Images-Skipped")).toBe("1");
    expect(mocks.file.mock.calls.filter(([name]) => String(name).endsWith(".png"))).toHaveLength(0);
  });

  it("leaves an owner's export as it was", async () => {
    mocks.user = { id: "owner", email: "owner@gmail.com", email_confirmed_at: "2026-10-28" };
    const original = await picture("png");
    mocks.download.mockResolvedValue({ bytes: original, contentType: "image/png" });
    const { POST } = await import("@/app/api/creatives/export/route");
    await POST(new Request("http://localhost/api/creatives/export", { method: "POST", body: JSON.stringify({ creativeIds: [ID] }) }));
    const [, bytes] = mocks.file.mock.calls.find(([name]) => String(name).endsWith(".png"))!;
    expect(bytes).toBe(original);
    expect(mocks.file).toHaveBeenCalledWith("copy.txt", expect.not.stringContaining("SAMPLE"));
  });
});
