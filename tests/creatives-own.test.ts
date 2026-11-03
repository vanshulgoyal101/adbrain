import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pictureSource } from "@/lib/creative/picture-source";
import { savedCreativeDescription } from "@/lib/creative/concept";
import type { Business, Database } from "@/lib/types";

// #780 slice 2b: "I'll write them" saves the owner's words on his library photos. No AI call, no spend.
const m = vi.hoisted(() => ({
  persist: vi.fn(), render: vi.fn(), save: vi.fn(), overlay: true,
  picked: vi.fn(), views: vi.fn(), session: vi.fn(), audit: vi.fn(), business: null as unknown,
}));
vi.mock("@/lib/creative/persist", () => ({ persistCreativeImage: m.persist, renderAndPersistDesign: m.render }));
vi.mock("@/lib/creative/save", () => ({ saveCreative: m.save }));
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, getEnv: () => ({ AD_DESIGN_OVERLAY: m.overlay }) };
});
vi.mock("@/lib/observability/logger", () => ({ observeRoute: (_r: string, _m: string, handler: unknown) => handler, currentRequestId: () => "req-1" }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/queries", () => ({ getActiveInstructionsText: async () => "" }));
vi.mock("@/lib/audit", () => ({ logEvent: m.audit }));
vi.mock("@/lib/media/ad-photos", () => ({ pickedMedia: m.picked }));
vi.mock("@/lib/media/store", () => ({ mediaViews: m.views }));
vi.mock("@/lib/media/route-helpers", () => ({
  mediaSession: m.session,
  mediaErrorResponse: (error: { status?: number }) => new Response(null, { status: error.status ?? 503 }),
}));

const BIZ = "11111111-1111-4111-8111-111111111111";
const P1 = "22222222-2222-4222-8222-222222222222", P2 = "33333333-3333-4333-8333-333333333333";
const business = { id: BIZ, name: "Glow Salon", vertical: "Salon", description: null, target_audience: null, usps: [], offers: ["Haircut ₹149"], locations: [], primary_color: "#0f766e", phone: "+91 98765 43210" } as unknown as Business;
const item = (mediaId: string, extra = {}) => ({ mediaId, headline: "Haircut ₹149", primary_text: "Walk in today.", description: "", cta: "Book Now", ...extra });
const client = {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.business }) }) }) }),
} as unknown as SupabaseClient;

beforeEach(() => {
  vi.clearAllMocks();
  m.overlay = true;
  m.business = business;
  m.persist.mockImplementation(async (_s, _b, group: string, name: string) => `https://store/creatives/${BIZ}/${group}/${name}.webp`);
  m.render.mockImplementation(async (_s, _b, group: string, name: string) => `https://store/creatives/${BIZ}/${group}/${name}-ad.png`);
  m.save.mockImplementation(async (_s, row) => ({ id: `c-${m.save.mock.calls.length}`, ...row }));
  m.session.mockResolvedValue({ user: { id: "u1" }, client });
  m.picked.mockImplementation(async (_c, _b, ids: string[]) => ids.map((id) => ({ id })));
  m.views.mockImplementation(async (_a, rows: { id: string }[]) => rows.map((row) => ({ id: row.id, url: `https://signed/${row.id}` })));
});

describe("saveOwnWordsAds (#780 slice 2b)", () => {
  const save = async (items: ReturnType<typeof item>[]) => {
    const { saveOwnWordsAds, ownWordsRequestSchema } = await import("@/lib/creative/own-words");
    const parsed = ownWordsRequestSchema.parse({ businessId: BIZ, items });
    return saveOwnWordsAds({} as SupabaseClient<Database>, {
      business, items: parsed.items, photoUrls: new Map(items.map((i) => [i.mediaId, `https://signed/${i.mediaId}`])),
    });
  };

  it("as is: stores the photo itself as the ad, tagged as the owner's photo, with no words drawn", async () => {
    const { ads, variantGroup, error } = await save([item(P1, { description: "Open till 9" })]);
    expect(error).toBeUndefined();
    expect(m.persist).toHaveBeenCalledWith({}, BIZ, variantGroup, "own-1", `https://signed/${P1}`);
    expect(m.render).not.toHaveBeenCalled();
    const row = m.save.mock.calls[0][1];
    expect(row).toMatchObject({ business_id: BIZ, headline: "Haircut ₹149", primary_text: "Walk in today.", cta: "Book Now",
      status: "draft", media_asset_id: P1, variant_group: variantGroup, image_url: expect.stringContaining("own-1.webp") });
    expect(pictureSource(row.generation)).toBe("yours");
    expect(savedCreativeDescription(row.generation)).toBe("Open till 9");
    expect(row.generation).toMatchObject({ ownWords: true, composition: "photo", ownerPhoto: `media:${P1}`, textModels: [] });
    expect(row.generation.design).toBeUndefined();
    expect(JSON.stringify(row.generation)).not.toContain("signed");
    expect(ads[0].warnings).toEqual([]);
  });

  it("with the headline on the photo: draws the owner's words (not Brand selling points) and keeps the design for Studio", async () => {
    await save([item(P1, { offer: true })]);
    expect(m.render).toHaveBeenCalledOnce();
    const design = m.render.mock.calls[0][4];
    expect(design).toMatchObject({ headline: "Haircut ₹149", benefits: [] });
    const row = m.save.mock.calls[0][1];
    expect(row.image_url).toContain("own-1-ad.png");
    expect(row.generation).toMatchObject({ composition: "overlay", photoUrl: expect.stringContaining("own-1.webp"), design: { headline: "Haircut ₹149" } });
  });

  it("with drawing switched off in this deployment, saves the photo as is", async () => {
    m.overlay = false;
    await save([item(P1, { offer: true })]);
    expect(m.render).not.toHaveBeenCalled();
    expect(m.save.mock.calls[0][1].generation).toMatchObject({ composition: "photo" });
  });

  it("warns (never blocks) on a claim the Brand doesn't back, like a Studio edit", async () => {
    const { ads } = await save([item(P1, { headline: "Guaranteed glow in one visit" })]);
    expect(ads).toHaveLength(1);
    expect(ads[0].warnings.join(" ")).toMatch(/guarante/i);
  });

  it("keeps the ads already saved when a later one fails", async () => {
    m.persist.mockResolvedValueOnce("https://store/a.webp").mockRejectedValueOnce(new Error("storage down"));
    const { ads, error } = await save([item(P1), item(P2)]);
    expect(ads).toHaveLength(1);
    expect(error).toBeInstanceOf(Error);
  });

  it("refuses the same photo twice and more than three photos", async () => {
    const { ownWordsRequestSchema } = await import("@/lib/creative/own-words");
    expect(ownWordsRequestSchema.safeParse({ businessId: BIZ, items: [item(P1), item(P1)] }).success).toBe(false);
    expect(ownWordsRequestSchema.safeParse({ businessId: BIZ, items: [item(P1), item(P2), item(BIZ), item("44444444-4444-4444-8444-444444444444")] }).success).toBe(false);
    expect(ownWordsRequestSchema.safeParse({ businessId: BIZ, items: [item(P1, { headline: "" })] }).success).toBe(false);
  });
});

describe("POST /api/creatives/own (#780 slice 2b)", () => {
  const post = async (body: unknown) => {
    const { POST } = await import("@/app/api/creatives/own/route");
    return POST(new Request("https://adbrain.vanshul.com/api/creatives/own", { method: "POST", body: JSON.stringify(body) })) as Promise<Response>;
  };

  it("is not found while photo uploads are off", async () => {
    const { NextResponse } = await import("next/server");
    m.session.mockResolvedValue(NextResponse.json({ error: "Not found" }, { status: 404 }));
    expect((await post({ businessId: BIZ, items: [item(P1)] })).status).toBe(404);
    expect(m.save).not.toHaveBeenCalled();
  });

  it("refuses another owner's business before reading any photo", async () => {
    m.business = null;
    expect((await post({ businessId: BIZ, items: [item(P1)] })).status).toBe(404);
    expect(m.picked).not.toHaveBeenCalled();
    expect(m.save).not.toHaveBeenCalled();
  });

  it("refuses a photo that isn't the owner's, ready image, saving nothing", async () => {
    m.picked.mockRejectedValue(Object.assign(new Error("Photo not found."), { status: 404 }));
    expect((await post({ businessId: BIZ, items: [item(P1)] })).status).toBe(404);
    expect(m.persist).not.toHaveBeenCalled();
    expect(m.save).not.toHaveBeenCalled();
  });

  it("saves one draft per photo, in order, and records it", async () => {
    const response = await post({ businessId: BIZ, items: [item(P1), item(P2, { offer: true })] });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.creatives.map((c: { media_asset_id: string }) => c.media_asset_id)).toEqual([P1, P2]);
    expect(body.warnings).toEqual([[], []]);
    expect(m.picked).toHaveBeenCalledWith(client, BIZ, [P1, P2]);
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ businessId: BIZ, action: "creatives.own", details: expect.objectContaining({ count: 2, failed: 0 }) }));
  });

  it("returns 400 for words over the limits", async () => {
    expect((await post({ businessId: BIZ, items: [item(P1, { headline: "x".repeat(41) })] })).status).toBe(400);
  });

  it("returns 503 when nothing could be saved", async () => {
    m.persist.mockRejectedValue(new Error("storage down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post({ businessId: BIZ, items: [item(P1)] })).status).toBe(503);
    expect(m.audit).not.toHaveBeenCalled();
  });
});
