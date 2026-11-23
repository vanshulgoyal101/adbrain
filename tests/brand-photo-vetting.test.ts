import { beforeEach, describe, expect, it, vi } from "vitest";

const describePhoto = vi.fn();
vi.mock("@/lib/media/describe", () => ({ describePhoto: (...args: unknown[]) => describePhoto(...args) }));

const context = { businessId: "b", userId: "u", route: "/api/creatives/generate", requestId: "r", generationId: "g" };
const image = () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });

describe("brand photo vetting", () => {
  beforeEach(() => {
    vi.resetModules();
    describePhoto.mockReset();
    vi.stubGlobal("fetch", vi.fn(async () => image()));
  });

  it("leaves out a photo with printed words and keeps the clean ones in order", async () => {
    describePhoto.mockImplementation(async (_image, _options) => (describePhoto.mock.calls.length === 1
      ? { description: "flyer", visibleText: "PRECIOUS MARBLES" } : { description: "roof", visibleText: null }));
    const { vetBrandPhotos } = await import("@/lib/creative/brand-photo-vetting");
    const result = await vetBrandPhotos(["https://x.test/a.jpg", "https://x.test/b.jpg"], context);
    expect(result.photos).toEqual(["https://x.test/b.jpg"]);
    expect(Object.keys(result.notes)).toEqual(["https://x.test/b.jpg"]);
  });

  it("keeps a photo it could not read, and describes each photo once", async () => {
    describePhoto.mockResolvedValue(null);
    const { vetBrandPhotos } = await import("@/lib/creative/brand-photo-vetting");
    expect((await vetBrandPhotos(["https://x.test/c.jpg"], context)).photos).toEqual(["https://x.test/c.jpg"]);
    describePhoto.mockResolvedValue({ description: "roof", visibleText: null });
    await vetBrandPhotos(["https://x.test/c.jpg"], context);
    await vetBrandPhotos(["https://x.test/c.jpg"], context);
    expect(describePhoto).toHaveBeenCalledTimes(2);
  });
});
