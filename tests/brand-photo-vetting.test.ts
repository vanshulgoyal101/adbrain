import { beforeEach, describe, expect, it, vi } from "vitest";

const describePhoto = vi.fn();
vi.mock("@/lib/media/describe", () => ({ describePhoto: (...args: unknown[]) => describePhoto(...args) }));

const context = { businessId: "b", userId: "u", route: "/api/creatives/generate", requestId: "r", generationId: "g" };
const image = () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });

describe("brand photo vetting", () => {
  beforeEach(() => {
    vi.resetModules();
    describePhoto.mockReset();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://own.supabase.co");
    vi.stubGlobal("fetch", vi.fn(async () => image()));
  });

  it("never fetches a URL outside our storage host, and keeps it as before", async () => {
    const { vetBrandPhotos } = await import("@/lib/creative/brand-photo-vetting");
    const urls = ["http://own.supabase.co/storage/v1/a.jpg", "https://evil.test/storage/v1/a.jpg", "https://own.supabase.co/rest/v1/a.jpg", "https://169.254.169.254/storage/v1/a"];
    expect((await vetBrandPhotos(urls, context)).photos).toEqual(urls);
    expect(fetch).not.toHaveBeenCalled();
    expect(describePhoto).not.toHaveBeenCalled();
  });

  it("leaves out a photo with printed words and keeps the clean ones in order", async () => {
    describePhoto.mockImplementation(async (_image, _options) => (describePhoto.mock.calls.length === 1
      ? { description: "flyer", visibleText: "PRECIOUS MARBLES" } : { description: "roof", visibleText: null }));
    const { vetBrandPhotos } = await import("@/lib/creative/brand-photo-vetting");
    const result = await vetBrandPhotos(["https://own.supabase.co/storage/v1/object/sign/m/a.jpg", "https://own.supabase.co/storage/v1/object/sign/m/b.jpg"], context);
    expect(result.photos).toEqual(["https://own.supabase.co/storage/v1/object/sign/m/b.jpg"]);
    expect(Object.keys(result.notes)).toEqual(["https://own.supabase.co/storage/v1/object/sign/m/b.jpg"]);
  });

  it("keeps a photo it could not read, and describes each photo once", async () => {
    describePhoto.mockResolvedValue(null);
    const { vetBrandPhotos } = await import("@/lib/creative/brand-photo-vetting");
    expect((await vetBrandPhotos(["https://own.supabase.co/storage/v1/object/sign/m/c.jpg"], context)).photos).toEqual(["https://own.supabase.co/storage/v1/object/sign/m/c.jpg"]);
    describePhoto.mockResolvedValue({ description: "roof", visibleText: null });
    await vetBrandPhotos(["https://own.supabase.co/storage/v1/object/sign/m/c.jpg"], context);
    await vetBrandPhotos(["https://own.supabase.co/storage/v1/object/sign/m/c.jpg"], context);
    expect(describePhoto).toHaveBeenCalledTimes(2);
  });
});
