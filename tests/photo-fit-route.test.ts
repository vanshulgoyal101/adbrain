import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #1904: the "Check how your photo fits" preview draws a Brand photo with the real fitPhoto, for the signed-in
// owner's own ad and own Brand photos only.
const h = vi.hoisted(() => ({
  user: { id: "owner" } as { id: string } | null,
  creative: { business_id: "b1", generation: { format: "portrait" } } as Record<string, unknown> | null,
  assets: [] as string[],
  filters: [] as [string, string, unknown][],
  downloads: [] as string[],
  bytes: new Uint8Array(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: (table: string) => {
      const wanted: Record<string, unknown> = {};
      const query = {
        select: () => query,
        limit: () => query,
        eq: (column: string, value: unknown) => {
          h.filters.push([table, column, value]);
          wanted[column] = value;
          return query;
        },
        maybeSingle: async () => ({
          data: table === "creatives" ? h.creative
            : wanted.business_id === "b1" && wanted.type === "product_photo" && h.assets.includes(String(wanted.url)) ? { url: wanted.url }
            : null,
          error: null,
        }),
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/imageGen", () => ({
  downloadImage: vi.fn(async (url: string) => {
    h.downloads.push(url);
    return { bytes: h.bytes, contentType: "image/jpeg", width: 900, height: 2000 };
  }),
}));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));

const PHOTO = "https://x.supabase.co/storage/v1/object/public/brand-assets/b1/team.jpg";

async function get(query: Record<string, string>) {
  const { GET } = await import("@/app/api/creatives/[id]/photo-fit/route");
  return GET(new Request(`http://localhost/api/creatives/c1/photo-fit?${new URLSearchParams(query)}`), { params: Promise.resolve({ id: "c1" }) });
}

beforeEach(async () => {
  h.user = { id: "owner" };
  h.creative = { business_id: "b1", generation: { format: "portrait" } };
  h.assets = [PHOTO];
  h.filters = [];
  h.downloads = [];
  h.bytes = new Uint8Array(await sharp({ create: { width: 900, height: 2000, channels: 3, background: "#6b7a80" } }).jpeg().toBuffer());
});

describe("GET /api/creatives/[id]/photo-fit (#1904)", () => {
  it("draws the Brand photo in the ad's 4:5 frame and as the 1:1 version, privately cached", async () => {
    const res = await get({ photo: PHOTO, fit: "blur" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(await sharp(Buffer.from(await res.arrayBuffer())).metadata()).toMatchObject({ width: 520, height: 650 });
    const square = await get({ photo: PHOTO, shape: "square" });
    expect(await sharp(Buffer.from(await square.arrayBuffer())).metadata()).toMatchObject({ width: 96, height: 96 });
    expect(h.filters).toContainEqual(["brand_assets", "business_id", "b1"]);
    expect(h.downloads).toEqual([PHOTO, PHOTO]);
  });

  it("follows a square ad's frame", async () => {
    h.creative = { business_id: "b1", generation: { format: "square" } };
    const res = await get({ photo: PHOTO });
    expect(await sharp(Buffer.from(await res.arrayBuffer())).metadata()).toMatchObject({ width: 520, height: 520 });
  });

  it("never fetches a URL that isn't one of this business's Brand photos", async () => {
    const res = await get({ photo: "http://169.254.169.254/latest/meta-data/" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That photo isn't in your Brand assets." });
    expect(h.downloads).toEqual([]);
  });

  it("needs a signed-in owner who can read the ad", async () => {
    h.user = null;
    expect((await get({ photo: PHOTO })).status).toBe(401);
    h.user = { id: "owner" };
    h.creative = null;
    expect((await get({ photo: PHOTO })).status).toBe(404);
    expect(h.downloads).toEqual([]);
  });

  it("rejects a bad fit or shape", async () => {
    expect((await get({ photo: PHOTO, fit: "stretch" })).status).toBe(400);
    expect((await get({ photo: PHOTO, shape: "story" })).status).toBe(400);
    expect((await get({ photo: "not a url" })).status).toBe(400);
    expect(h.downloads).toEqual([]);
  });
});
