import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pictureSource } from "@/lib/creative/picture-source";
import { savedCreativeDescription } from "@/lib/creative/concept";
import { MediaError } from "@/lib/media/store";
import type { Business, Database } from "@/lib/types";
import { fakeSupabase } from "./helpers/media-fake";

// #780 slice 2b: "I'll write them" saves the owner's words on his library photos. No AI call, no spend.
const m = vi.hoisted(() => ({
  persist: vi.fn(), render: vi.fn(), save: vi.fn(), overlay: true,
  picked: vi.fn(), videoEnabled: false, session: vi.fn(), audit: vi.fn(), instructions: vi.fn(), business: null as unknown,
  businessError: null as unknown, admin: null as unknown,
}));
vi.mock("@/lib/creative/persist", () => ({ persistCreativeImage: m.persist, persistCreativeImageBytes: m.persist, renderAndPersistDesign: m.render }));
vi.mock("@/lib/creative/save", () => ({ saveCreative: m.save }));
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, getEnv: () => ({ AD_DESIGN_OVERLAY: m.overlay, MEDIA_UPLOADS_ENABLED: true, MEDIA_VIDEO_ENABLED: m.videoEnabled }) };
});
vi.mock("@/lib/observability/logger", () => ({ observeRoute: (_r: string, _m: string, handler: unknown) => handler, currentRequestId: () => "req-1" }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.admin }));
vi.mock("@/lib/supabase/queries", () => ({ getActiveInstructionsText: m.instructions }));
vi.mock("@/lib/audit", () => ({ logEvent: m.audit }));
vi.mock("@/lib/media/ad-photos", () => ({ pickedMedia: m.picked }));
vi.mock("@/lib/media/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media/store")>()),
  pickedOwnMedia: m.picked,
}));
vi.mock("@/lib/media/route-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media/route-helpers")>()),
  mediaSession: m.session,
}));

const BIZ = "11111111-1111-4111-8111-111111111111";
const P1 = "22222222-2222-4222-8222-222222222222", P2 = "33333333-3333-4333-8333-333333333333";
const V1 = "44444444-4444-4444-8444-444444444444";
const business = { id: BIZ, name: "Glow Salon", vertical: "Salon", description: null, target_audience: null, usps: [], offers: ["Haircut ₹149"], locations: [], primary_color: "#0f766e", phone: "+91 98765 43210" } as unknown as Business;
const item = (mediaId: string, extra = {}) => ({ mediaId, headline: "Haircut ₹149", primary_text: "Walk in today.", description: "", cta: "Book Now", ...extra });
const client = {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.business, error: m.businessError }) }) }) }),
} as unknown as SupabaseClient;
let media: ReturnType<typeof fakeSupabase>;
const photo = (id: string) => new TextEncoder().encode(`verified photo ${id}`);
const video = (id: string) => new TextEncoder().encode(`verified video ${id}`);
const mediaRow = (id: string, kind: "image" | "video") => {
  const bytes = kind === "video" ? video(id) : photo(id);
  return {
    id, business_id: BIZ, kind, status: "ready", path: `${id}.${kind === "video" ? "mp4" : "jpg"}`,
    mime: kind === "video" ? "video/mp4" : "image/jpeg",
    sha256: createHash("sha256").update(`original upload ${id}`).digest("hex"),
    checks: { storedSha256: createHash("sha256").update(bytes).digest("hex") },
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  m.overlay = true;
  m.videoEnabled = false;
  m.business = business;
  m.businessError = null;
  m.instructions.mockResolvedValue("");
  m.persist.mockImplementation(async (_s, _b, group: string, name: string) => `https://store/creatives/${BIZ}/${group}/${name}.webp`);
  m.render.mockImplementation(async (_s, _b, group: string, name: string) => `https://store/creatives/${BIZ}/${group}/${name}-ad.png`);
  m.save.mockImplementation(async (_s, row) => ({ id: `c-${m.save.mock.calls.length}`, ...row }));
  m.session.mockResolvedValue({ user: { id: "u1" }, client });
  media = fakeSupabase();
  m.admin = media.client;
  for (const id of [P1, P2]) media.objects.set(`${id}.jpg`, photo(id));
  media.objects.set(`${V1}.mp4`, video(V1));
  m.picked.mockImplementation(async (_c, _b, ids: string[], allowVideos?: boolean) => {
    const rows = ids.map((id) => mediaRow(id, id === V1 ? "video" : "image"));
    if (rows.some((row) => row.kind === "video") && allowVideos !== true) {
      throw new MediaError(404, "MEDIA_VIDEO_DISABLED", "Video ads aren't available right now.");
    }
    return rows;
  });
});

describe("saveOwnWordsAds (#780 slice 2b)", () => {
  const save = async (items: ReturnType<typeof item>[], brand = business) => {
    const { saveOwnWordsAds, ownWordsRequestSchema } = await import("@/lib/creative/own-words");
    const parsed = ownWordsRequestSchema.parse({ businessId: BIZ, items });
    return saveOwnWordsAds({} as SupabaseClient<Database>, {
      business: brand, items: parsed.items, photos: new Map(items.map((i) => [i.mediaId, {
        bytes: i.mediaId === V1 ? video(i.mediaId) : photo(i.mediaId),
        contentType: i.mediaId === V1 ? "video/mp4" : "image/jpeg",
        kind: i.mediaId === V1 ? "video" : "image",
      }])),
    });
  };

  it("as is: stores the photo itself as the ad, tagged as the owner's photo, with no words drawn", async () => {
    const { ads, variantGroup, error } = await save([item(P1, { description: "Open till 9" })]);
    expect(error).toBeUndefined();
    expect(m.persist).toHaveBeenCalledWith({}, BIZ, variantGroup, "own-1", photo(P1), "image/jpeg");
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

  it("saves owner-written video without an image copy or image overlay and tags it as the owner's video", async () => {
    const { ads, error } = await save([item(V1)]);
    expect(error).toBeUndefined();
    expect(ads).toHaveLength(1);
    expect(m.persist).not.toHaveBeenCalled();
    expect(m.render).not.toHaveBeenCalled();
    const row = m.save.mock.calls[0][1];
    expect(row).toMatchObject({ media_asset_id: V1, image_url: null, status: "draft" });
    expect(pictureSource(row.generation)).toBe("video");
    expect(row.generation).toMatchObject({ ownerVideo: `media:${V1}`, composition: "video", textModels: [] });
  });

  it("rejects drawing words on a video before saving any creative", async () => {
    const { ads, error } = await save([item(P1), item(V1, { offer: true })]);
    expect(ads).toEqual([]);
    expect(error).toMatchObject({ code: "OWN_WORDS_VIDEO_OVERLAY" });
    expect(m.persist).not.toHaveBeenCalled();
    expect(m.render).not.toHaveBeenCalled();
    expect(m.save).not.toHaveBeenCalled();
  });

  it("refuses the whole batch when an on-photo headline was requested but drawing is unavailable", async () => {
    m.overlay = false;
    const { ads, error } = await save([item(P1), item(P2, { offer: true })]);
    expect(ads).toEqual([]);
    expect(error).toMatchObject({ code: "OWN_WORDS_OVERLAY_UNAVAILABLE" });
    expect(m.render).not.toHaveBeenCalled();
    expect(m.persist).not.toHaveBeenCalled();
    expect(m.save).not.toHaveBeenCalled();
  });

  it("rejects an unsupported claim before saving anything and names the ad and field", async () => {
    const { ads, error } = await save([item(P1), item(P2, { description: "Only ₹499" })]);
    expect(ads).toEqual([]);
    expect(error).toMatchObject({
      code: "OWN_WORDS_COPY_REJECTED", index: 1, field: "description",
      message: expect.stringMatching(/ad 2.*description.*₹499.*brand/i),
    });
    expect(m.persist).not.toHaveBeenCalled();
    expect(m.save).not.toHaveBeenCalled();
  });

  it("rejects a banned industry promise and other policy findings before any ad in the batch is saved", async () => {
    const education = { ...business, vertical: "IELTS coaching" } as Business;
    const blocked = await save([item(P1), item(P2, { headline: "Guaranteed visa" })], education);
    expect(blocked.ads).toEqual([]);
    expect(blocked.error).toMatchObject({
      code: "OWN_WORDS_COPY_REJECTED", index: 1, field: "headline",
      message: expect.stringMatching(/ad 2.*headline.*guaranteed.*reword/i),
    });
    expect(m.persist).not.toHaveBeenCalled();

    const clinic = { ...business, vertical: "dental clinic" } as Business;
    const personal = await save([item(P1, { primary_text: "Do you have toothache?" })], clinic);
    expect(personal.ads).toEqual([]);
    expect(personal.error).toMatchObject({
      code: "OWN_WORDS_COPY_REJECTED", index: 0, field: "primary_text",
      message: expect.stringMatching(/main text.*toothache.*service/i),
    });
    expect(m.save).not.toHaveBeenCalled();
  });

  it("does not mistake the word secure for the banned medical claim cure", async () => {
    const clinic = { ...business, vertical: "dental clinic" } as Business;
    const { ads, error } = await save([item(P1, { headline: "Secure your smile" })], clinic);
    expect(error).toBeUndefined();
    expect(ads).toHaveLength(1);
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

  it("reports an unavailable business lookup instead of pretending it is missing", async () => {
    m.business = null;
    m.businessError = { message: "database unavailable" };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await post({ businessId: BIZ, items: [item(P1)] });
      expect(response.status).toBe(503);
      expect(JSON.stringify(await response.json())).not.toContain("database unavailable");
      expect(log).toHaveBeenCalled();
      expect(m.picked).not.toHaveBeenCalled();
      expect(m.save).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("refuses a photo that isn't the owner's, ready image, saving nothing", async () => {
    m.picked.mockRejectedValue(new MediaError(404, "MEDIA_NOT_FOUND", "Photo not found."));
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
    expect(m.picked).toHaveBeenCalledWith(client, BIZ, [P1, P2], false);
    expect(m.persist).toHaveBeenNthCalledWith(1, client, BIZ, body.variantGroup, "own-1", photo(P1), "image/jpeg");
    expect(m.persist).toHaveBeenNthCalledWith(2, client, BIZ, body.variantGroup, "own-2", photo(P2), "image/jpeg");
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ businessId: BIZ, action: "creatives.own", details: expect.objectContaining({ count: 2, failed: 0 }) }));
  });

  it("admits a ready video only when video creation is enabled, preserving the original private asset", async () => {
    m.videoEnabled = true;
    const response = await post({ businessId: BIZ, items: [item(V1)] });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(m.picked).toHaveBeenCalledWith(client, BIZ, [V1], true);
    expect(m.persist).not.toHaveBeenCalled();
    expect(m.render).not.toHaveBeenCalled();
    expect(body.creatives).toMatchObject([{ media_asset_id: V1, image_url: null, generation: { ownerVideo: `media:${V1}` } }]);
  });

  it("refuses video creation while the video flag is off", async () => {
    const response = await post({ businessId: BIZ, items: [item(V1)] });
    expect(response.status).toBe(404);
    expect(m.picked).toHaveBeenCalledWith(client, BIZ, [V1], false);
    expect(m.save).not.toHaveBeenCalled();
  });

  it("replays a batch after a lost response without saving duplicate ads", async () => {
    const body = { businessId: BIZ, idempotencyKey: "44444444-4444-4444-8444-444444444444", items: [item(P1), item(P2)] };
    const first = await post(body);
    const retry = await post(body);
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    const firstResult = await first.json();
    const retryResult = await retry.json();
    expect(retryResult.variantGroup).toBe(firstResult.variantGroup);
    expect(retryResult.creatives.map((ad: { id: string }) => ad.id)).toEqual(firstResult.creatives.map((ad: { id: string }) => ad.id));
    expect(m.save).toHaveBeenCalledTimes(2);
  });

  it("admits concurrent requests for the same batch only once", async () => {
    const body = { businessId: BIZ, idempotencyKey: "44444444-4444-4444-8444-444444444444", items: [item(P1), item(P2)] };
    const [first, retry] = await Promise.all([post(body), post(body)]);
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    const firstResult = await first.json();
    const retryResult = await retry.json();
    expect(retryResult.variantGroup).toBe(firstResult.variantGroup);
    expect(retryResult.creatives.map((ad: { id: string }) => ad.id)).toEqual(firstResult.creatives.map((ad: { id: string }) => ad.id));
    expect(m.save).toHaveBeenCalledTimes(2);
  });

  it("refuses reusing a batch key for different words", async () => {
    const idempotencyKey = "44444444-4444-4444-8444-444444444444";
    expect((await post({ businessId: BIZ, idempotencyKey, items: [item(P1)] })).status).toBe(200);
    const retry = await post({ businessId: BIZ, idempotencyKey, items: [item(P1, { headline: "A new headline" })] });
    expect(retry.status).toBe(409);
    expect(m.save).toHaveBeenCalledTimes(1);
  });

  it("refuses a photo whose stored bytes changed before saving any ad", async () => {
    media.objects.set(`${P2}.jpg`, new TextEncoder().encode("changed after finalization"));
    const response = await post({ businessId: BIZ, items: [item(P1), item(P2)] });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "MEDIA_CHANGED" });
    expect(m.persist).not.toHaveBeenCalled();
    expect(m.save).not.toHaveBeenCalled();
  });

  it("refuses a ready photo with an invalid stored image type", async () => {
    m.picked.mockResolvedValueOnce([{ id: P1, kind: "image", status: "ready", path: `${P1}.jpg`, mime: null }]);
    const response = await post({ businessId: BIZ, items: [item(P1)] });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "MEDIA_TYPE" });
    expect(m.persist).not.toHaveBeenCalled();
    expect(m.save).not.toHaveBeenCalled();
  });

  it("logs an unexpected photo-read error without exposing its details", async () => {
    m.picked.mockRejectedValueOnce(new Error("storage internals"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await post({ businessId: BIZ, items: [item(P1)] });
      expect(response.status).toBe(503);
      expect(JSON.stringify(await response.json())).not.toContain("storage internals");
      expect(log).toHaveBeenCalledWith("[creatives.own.media]", expect.any(Error));
      expect(m.save).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("returns 400 for words over the limits", async () => {
    expect((await post({ businessId: BIZ, items: [item(P1, { headline: "x".repeat(41) })] })).status).toBe(400);
  });

  it("returns the rejected ad and field so the owner can fix policy copy", async () => {
    m.business = { ...business, vertical: "IELTS coaching" };
    const response = await post({ businessId: BIZ, items: [item(P1), item(P2, { headline: "Guaranteed visa" })] });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "OWN_WORDS_COPY_REJECTED", index: 1, field: "headline",
      error: expect.stringMatching(/ad 2.*headline.*guaranteed.*reword/i),
    });
    expect(m.persist).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("accepts an offer supported by the active Brand instructions", async () => {
    m.instructions.mockResolvedValue("Free haircut");
    const response = await post({ businessId: BIZ, items: [item(P1, { headline: "Free haircut" })] });
    expect(response.status).toBe(200);
    expect(m.save).toHaveBeenCalledOnce();
  });

  it("explains an unavailable on-photo headline without saving an earlier ad", async () => {
    m.overlay = false;
    const response = await post({ businessId: BIZ, items: [item(P1), item(P2, { offer: true })] });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "OWN_WORDS_OVERLAY_UNAVAILABLE", error: expect.stringMatching(/headline.*photo.*turn.*off/i) });
    expect(m.persist).not.toHaveBeenCalled();
    expect(m.save).not.toHaveBeenCalled();
  });

  it("does not save or silently omit Brand instructions when their read fails", async () => {
    m.instructions.mockRejectedValueOnce(new Error("instructions unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await post({ businessId: BIZ, items: [item(P1)] });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/instructions.*try again/i) });
    expect(m.persist).not.toHaveBeenCalled();
    expect(m.save).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("returns 503 when nothing could be saved", async () => {
    m.persist.mockRejectedValue(new Error("storage down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post({ businessId: BIZ, items: [item(P1)] })).status).toBe(503);
    expect(m.audit).not.toHaveBeenCalled();
  });
});
