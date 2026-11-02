import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ download: vi.fn(), file: vi.fn(), lookup: vi.fn(), business: vi.fn(), user: { id: "owner", email: "owner@shop.example" } as { id: string; email: string; email_confirmed_at?: string } }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/imageGen", () => ({ downloadImage: mocks.download }));
// Placeholder bytes stand in for pictures here; sample-watermark.test exports real ones as JPEG.
vi.mock("@/lib/imageGen/encode", () => ({ downloadJpeg: async (bytes: Uint8Array) => bytes }));
vi.mock("jszip", () => ({ default: class {
  file = mocks.file;
  generateAsync = async () => new ArrayBuffer(1);
} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: mocks.user } }) },
  from: (table: string) => table === "businesses"
    ? { select: () => ({ eq: () => ({ maybeSingle: mocks.business }) }) }
    : { select: () => ({ in: mocks.lookup }) },
}) }));

const ids = Array.from({ length: 5 }, (_, index) => `11111111-1111-4111-8111-11111111111${index}`);
const request = () => new Request("http://localhost/api/creatives/export", { method: "POST", body: JSON.stringify({ creativeIds: ids }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "owner", email: "owner@shop.example" };
  mocks.business.mockResolvedValue({ data: { name: "SunPeak Solar", vertical: "rooftop solar installer" }, error: null });
  mocks.lookup.mockResolvedValue({ data: ids.map((id) => ({ id, angle: "Offer", image_url: `https://example.com/${id}.png` })), error: null });
});

describe("creative export resource budget", () => {
  it("includes saved descriptions in exported copy", async () => {
    mocks.lookup.mockResolvedValue({ data: ids.map((id) => ({ id, generation: { concept: { description: "Discuss your rooftop plans." } } })), error: null });
    const { POST } = await import("@/app/api/creatives/export/route");
    expect((await POST(request())).status).toBe(200);
    expect(mocks.file).toHaveBeenCalledWith("copy.txt", expect.stringContaining("Description: Discuss your rooftop plans."));
  });

  it("stops fetching once the aggregate image budget is exhausted", async () => {
    mocks.download.mockResolvedValue({ bytes: { byteLength: 20 * 1024 * 1024 }, contentType: "image/png" });
    const { POST } = await import("@/app/api/creatives/export/route");
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Images-Skipped")).toBe("3");
    expect(mocks.download).toHaveBeenCalledTimes(3);
    expect(mocks.file.mock.calls.filter(([name]) => name.endsWith(".jpg"))).toHaveLength(2);
    expect(mocks.file).toHaveBeenCalledWith("copy.txt", expect.stringContaining("exceeded export limits"));
    expect(mocks.download.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
  });

  it.each([{ data: null, error: { message: "offline" }, status: 503 }, { data: [], error: null, status: 404 }, { data: [{ id: ids[0] }], error: null, status: 404 }])("does not export a silent partial selection: $status", async ({ data, error, status }) => {
    mocks.lookup.mockResolvedValue({ data, error });
    const { POST } = await import("@/app/api/creatives/export/route");
    expect((await POST(request())).status).toBe(status);
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.file).not.toHaveBeenCalled();
  });

  // #1582: a sales visit's pack ends with the WhatsApp follow-up line and the segment's landing link.
  it("ends a prospect pack's copy with the segment's leave-behind and /for link; an owner's export has none", async () => {
    mocks.lookup.mockResolvedValue({ data: ids.map((id) => ({ id, business_id: "b1", angle: "Offer" })), error: null });
    const { POST } = await import("@/app/api/creatives/export/route");
    expect((await POST(request())).status).toBe(200);
    expect(mocks.file).toHaveBeenCalledWith("copy.txt", expect.not.stringContaining("/for/"));
    mocks.file.mockClear();
    mocks.user = { id: "owner", email: "sales+prospect-solar@adbrain.vanshul.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
    expect((await POST(request())).status).toBe(200);
    const copy = mocks.file.mock.calls.find(([name]) => name === "copy.txt")![1] as string;
    expect(copy.trimEnd().endsWith("https://adbrain.vanshul.com/for/solar")).toBe(true);
    expect(copy).toContain("sample ads I made for SunPeak Solar.");
    mocks.file.mockClear();
    mocks.business.mockResolvedValue({ data: { vertical: "dental clinic" }, error: null });
    await POST(request());
    expect(mocks.file).toHaveBeenCalledWith("copy.txt", expect.not.stringContaining("/for/"));
  });
});