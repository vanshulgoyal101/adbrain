import { beforeEach, describe, expect, it, vi } from "vitest";

/** POST /api/creatives/[id]/picture (#280 slice 2): redraw the words on the picture, no AI. */

const h = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  rows: {} as Record<string, unknown>,
  updates: [] as { table: string; payload: Record<string, unknown> }[],
  files: {} as Record<string, { name: string; created_at: string }[]>,
  render: vi.fn(),
  overlay: true,
  logEvent: vi.fn(),
  lang: undefined as string | undefined,
}));

vi.mock("@/lib/observability/logger", () => ({ observeRoute: (_p: string, _m: string, fn: unknown) => fn }));
vi.mock("@/lib/audit", () => ({ logEvent: h.logEvent }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ AD_DESIGN_OVERLAY: h.overlay }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "adbrain_lang" && h.lang ? { value: h.lang } : undefined) }),
}));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/creative/persist", () => ({ renderAndPersistDesign: h.render }));
const raster = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("@/lib/creative/render", () => ({ renderCompositeAd: raster.render }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    storage: {
      from: () => ({
        list: async (dir: string) => ({ data: h.files[dir] ?? [], error: null }),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/creatives/${path}` } }),
      }),
    },
    from: (table: string) => {
      let payload: Record<string, unknown> | null = null;
      const query = {
        select: () => query,
        update: (next: Record<string, unknown>) => {
          payload = next;
          h.updates.push({ table, payload: next });
          return query;
        },
        eq: () => query,
        contains: () => query,
        not: () => query,
        limit: async () => ({ data: h.rows[table] ?? [], error: null }),
        maybeSingle: async () => {
          const row = h.rows[table] as Record<string, unknown> | null | undefined;
          return { data: row ? { ...row, ...(payload ?? {}) } : null, error: null };
        },
      };
      return query;
    },
  }),
}));

const words = { headline: "Diwali: free site visit", subhead: "Till 15 Nov", phone: "+91 98290 12345", ctaLabel: "Call Now" };
const savedDesign = {
  format: "portrait", width: 1080, height: 1350, brandName: "Solaride", logoUrl: null, headline: "Cut your bill",
  subhead: null, benefits: [], phone: null, contactLine: null, ctaLabel: "Get Quote", primaryColor: "#f59e0b",
  ctaTextColor: "#111827", fontFamily: "Inter", layout: "top",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "u1" };
  h.overlay = true;
  h.updates.length = 0;
  h.files = {};
  h.render.mockResolvedValue("https://cdn.test/creatives/b1/g1/originals-v1/offer-ad-new.png");
  h.rows = {
    creatives: {
      id: "c1", business_id: "b1", variant_group: "g1", angle: "Special offer / incentive", status: "approved",
      image_url: "https://cdn.test/creatives/b1/g1/originals-v1/offer-ad-old.png",
      headline: "Cut your bill", primary_text: "Rooftop solar.", cta: "Get Quote",
      generation: { composition: "overlay", concept: { headline: "Cut your bill" }, design: savedDesign, photoUrl: "https://cdn.test/creatives/b1/g1/offer-photo.png" },
    },
    businesses: { id: "b1", name: "Solaride", phone: "+91 98290 12345" },
    campaigns: [],
  };
});

async function post(body: unknown = words) {
  const { POST } = await import("@/app/api/creatives/[id]/picture/route");
  const res = await (POST as unknown as (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>)(
    new Request("http://test/api/creatives/c1/picture", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "c1" }) },
  );
  return { status: res.status, body: await res.json() };
}

describe("POST /api/creatives/[id]/picture", () => {
  it("previews the words for the live editor without saving anything (#387)", async () => {
    const sharp = (await import("sharp")).default;
    raster.render.mockResolvedValue(new Uint8Array(await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#123456" } }).png().toBuffer()));
    const res = await post({ ...words, preview: true });
    expect(res.status).toBe(200);
    expect(res.body.previewUrl).toMatch(/^data:image\/webp;base64,/);
    const meta = await sharp(Buffer.from(res.body.previewUrl.split(",")[1], "base64")).metadata();
    expect(meta.width).toBe(720);
    expect(raster.render).toHaveBeenCalledWith(expect.objectContaining({ ...words, backgroundUrl: "https://cdn.test/creatives/b1/g1/offer-photo.png" }));
    expect(h.render).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
    expect(h.logEvent).not.toHaveBeenCalled();
  });

  it("still refuses invalid words in a preview", async () => {
    expect((await post({ ...words, headline: "x".repeat(41), preview: true })).status).toBe(400);
    expect(raster.render).not.toHaveBeenCalled();
  });

  it("needs a signed-in owner and an ad they can see", async () => {
    h.user = null;
    expect((await post()).status).toBe(401);
    h.user = { id: "u1" };
    h.rows.creatives = null;
    expect(await post()).toEqual({ status: 404, body: { error: "We couldn't find this ad. It may have been deleted; refresh the page." } });
    expect(h.render).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...words, headline: "x".repeat(41) }, "Headline must be 40 characters or fewer."],
    [{ ...words, subhead: "x".repeat(65) }, "Offer line must be 64 characters or fewer."],
    [{ ...words, phone: "call me" }, "Phone: use digits, spaces and + only."],
    [{ ...words, headline: " " }, "Headline can't be empty."],
  ])("rejects %o before drawing anything", async (body, error) => {
    expect(await post(body)).toEqual({ status: 400, body: { error } });
    expect(h.render).not.toHaveBeenCalled();
  });

  it("answers a Hindi owner in Hindi (#2324), with the same status", async () => {
    h.lang = "hi";
    try {
      expect(await post({ ...words, headline: "x".repeat(41) })).toEqual({ status: 400, body: { error: "हेडलाइन में ज़्यादा से ज़्यादा 40 अक्षर हो सकते हैं।" } });
      h.rows.creatives = null;
      expect(await post()).toEqual({ status: 404, body: { error: "यह विज्ञापन नहीं मिला। शायद यह हटा दिया गया है; पेज रिफ़्रेश करें।" } });
    } finally {
      h.lang = undefined;
    }
  });

  it("redraws over the saved background with the new words, keeps approval, and saves the new spec", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(h.render).toHaveBeenCalledWith(
      expect.anything(), "b1", "g1", "offer",
      expect.objectContaining({ ...words, layout: "top", primaryColor: "#f59e0b" }),
      "https://cdn.test/creatives/b1/g1/offer-photo.png",
    );
    const [{ table, payload }] = h.updates;
    expect(table).toBe("creatives");
    expect(payload).not.toHaveProperty("status");
    expect(payload.image_url).toBe("https://cdn.test/creatives/b1/g1/originals-v1/offer-ad-new.png");
    expect(payload.generation).toMatchObject({
      composition: "overlay",
      concept: { headline: "Cut your bill" },
      photoUrl: "https://cdn.test/creatives/b1/g1/offer-photo.png",
      design: { ...words, layout: "top" },
    });
    expect((payload.generation as { design: object }).design).not.toHaveProperty("backgroundUrl");
    expect(res.body.creative).toMatchObject({ status: "approved", image_url: payload.image_url });
    expect(res.body.liveNotice).toBeUndefined();
    expect(h.logEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "creative.edit_picture", entityId: "c1" }));
  });

  it("keeps a text edit saved while the picture was being redrawn", async () => {
    h.render.mockImplementation(async () => {
      const row = h.rows.creatives as { generation: Record<string, unknown> };
      row.generation = { ...row.generation, concept: { headline: "Cut your bill", description: "Edited mid-redraw" }, editedAt: "now" };
      return "https://cdn.test/creatives/b1/g1/originals-v1/offer-ad-new.png";
    });
    expect((await post()).status).toBe(200);
    expect(h.updates[0].payload.generation).toMatchObject({
      concept: { description: "Edited mid-redraw" },
      editedAt: "now",
      design: { headline: words.headline },
    });
  });

  it("finds an older ad's background in its folder and remembers it", async () => {
    const id = "11111111-2222-4333-8444-555555555555";
    h.rows.creatives = { ...(h.rows.creatives as object), generation: { concept: { headline: "Cut your bill" } } };
    h.files = { "b1/g1/originals-v1": [{ name: `offer-${id}.png`, created_at: "2026-10-01T00:00:00Z" }, { name: "offer-ad-old.png", created_at: "2026-10-01T00:00:03Z" }] };
    expect((await post()).status).toBe(200);
    const photo = `https://cdn.test/creatives/b1/g1/originals-v1/offer-${id}.png`;
    expect(h.render).toHaveBeenCalledWith(expect.anything(), "b1", "g1", "offer", expect.objectContaining({ headline: words.headline }), photo);
    expect(h.updates[0].payload.generation).toMatchObject({ photoUrl: photo, design: { headline: words.headline } });
  });

  it("never fetches a saved background outside the business's own storage", async () => {
    for (const photoUrl of ["http://169.254.169.254/latest/meta-data", "https://cdn.test/creatives/b2/g1/offer.png", "https://cdn.test/creatives/b1/../b2/offer.png"]) {
      h.rows.creatives = { ...(h.rows.creatives as object), generation: { design: savedDesign, photoUrl } };
      expect((await post()).body).toMatchObject({ code: "no_background" });
    }
    expect(h.render).not.toHaveBeenCalled();
  });

  it("says so plainly when there is no background to redraw on, and changes nothing", async () => {
    h.rows.creatives = { ...(h.rows.creatives as object), generation: {} };
    const res = await post();
    expect(res).toMatchObject({ status: 409, body: { code: "no_background" } });
    expect(h.render).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
  });

  it("keeps the ad unchanged when the redraw fails", async () => {
    h.render.mockRejectedValue(new Error("satori blew up"));
    const res = await post();
    expect(res).toEqual({ status: 500, body: expect.objectContaining({ error: "Couldn't redraw the picture. Your ad is unchanged; try again." }) });
    expect(h.updates).toEqual([]);
  });

  it("refuses image-only ads and a deployment with overlays off", async () => {
    h.rows.creatives = { ...(h.rows.creatives as object), generation: { composition: "image-only" } };
    expect((await post()).status).toBe(409);
    h.overlay = false;
    expect((await post()).status).toBe(409);
    expect(h.render).not.toHaveBeenCalled();
  });

  it("notes when the ad is already live on Meta", async () => {
    h.rows.campaigns = [{ id: "camp1" }];
    expect((await post()).body.liveNotice).toBe("This ad is live on Meta; your edit applies to new campaigns.");
  });
});
