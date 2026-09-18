import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ download: vi.fn(), file: vi.fn(), lookup: vi.fn() }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/imageGen", () => ({ downloadImage: mocks.download }));
vi.mock("jszip", () => ({ default: class {
  file = mocks.file;
  generateAsync = async () => new ArrayBuffer(1);
} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from: () => ({ select: () => ({ in: mocks.lookup }) }),
}) }));

const ids = Array.from({ length: 5 }, (_, index) => `11111111-1111-4111-8111-11111111111${index}`);
const request = () => new Request("http://localhost/api/creatives/export", { method: "POST", body: JSON.stringify({ creativeIds: ids }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue({ data: ids.map((id) => ({ id, angle: "Offer", image_url: `https://example.com/${id}.png` })), error: null });
});

describe("creative export resource budget", () => {
  it("stops fetching once the aggregate image budget is exhausted", async () => {
    mocks.download.mockResolvedValue({ bytes: { byteLength: 20 * 1024 * 1024 }, contentType: "image/png" });
    const { POST } = await import("@/app/api/creatives/export/route");
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Images-Skipped")).toBe("3");
    expect(mocks.download).toHaveBeenCalledTimes(3);
    expect(mocks.file.mock.calls.filter(([name]) => name.endsWith(".png"))).toHaveLength(2);
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

  it("preserves WebP image extensions", async () => {
    mocks.download.mockResolvedValue({ bytes: new Uint8Array([1]), contentType: "image/webp" });
    const { POST } = await import("@/app/api/creatives/export/route");
    expect((await POST(request())).status).toBe(200);
    expect(mocks.file.mock.calls.filter(([name]) => name.endsWith(".webp"))).toHaveLength(5);
  });
});