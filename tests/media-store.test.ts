import sharp from "sharp";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEDIA_MONTHLY_UPLOADS, mediaFit } from "@/lib/media/rules";
const CONFIRMED = "2026-10-28T10:00:00.000Z";
import { deleteMedia, finalizeUpload, listMedia, mediaViews, pickedMediaViews, pickedOwnMedia, monthlyUploads, monthStartIst, ownMedia, readVerifiedMedia, signUpload, updateMedia, type MediaRow } from "@/lib/media/store";

vi.mock("@/lib/env", () => ({ getEnv: () => ({ MEDIA_UPLOADS_ENABLED: true }) }));
import { fakeSupabase } from "./helpers/media-fake";

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const photo = (width: number, height: number, format: "jpeg" | "png" = "jpeg") =>
  sharp({ create: { width, height, channels: 3, background: "#4a7" } })[format]().toBuffer().then((buffer) => new Uint8Array(buffer));

let db: ReturnType<typeof fakeSupabase>;
beforeEach(() => { db = fakeSupabase(); });

async function signed(bytes: Uint8Array, extra: Partial<Parameters<typeof signUpload>[1]> = {}) {
  return signUpload(db.client, { businessId: BUSINESS, userId: USER, mime: "image/jpeg", bytes: bytes.length, sha256: sha(bytes), width: 1080, height: 1350, rightsConfirmedAt: CONFIRMED, ...extra });
}

describe("media rules (#1209, #751)", () => {
  it("says what a photo fits from its size", () => {
    expect(mediaFit(1080, 1920)).toMatchObject({ level: "ready", ratio: "9:16" });
    expect(mediaFit(1080, 1350)).toMatchObject({ level: "ready", ratio: "4:5" });
    expect(mediaFit(1080, 1080)).toMatchObject({ level: "feed", ratio: "1:1" });
    expect(mediaFit(1920, 1080)).toMatchObject({ level: "feed", ratio: "16:9" });
    expect(mediaFit(599, 900)).toMatchObject({ level: "too_small" });
  });

  it("counts the month from the 1st in India", () => {
    expect(monthStartIst(new Date("2026-10-31T19:00:00Z"))).toBe("2026-10-31T18:30:00.000Z");
    expect(monthStartIst(new Date("2026-10-28T09:00:00Z"))).toBe("2026-09-30T18:30:00.000Z");
  });
});

describe("signUpload (#1209)", () => {
  // #784: the route checks the owner's confirmation (#1248's hasCurrentMediaConsent); the row records when.
  it("signs a path under the business and records when the rights were confirmed; never writes consent itself", async () => {
    const bytes = await photo(1080, 1350);
    const result = await signed(bytes);
    expect(result).toMatchObject({ duplicate: false, fit: { level: "ready" } });
    if (result.duplicate) throw new Error("unexpected duplicate");
    expect(result.path).toMatch(new RegExp(`^${BUSINESS}/[0-9a-f-]{36}\\.jpg$`));
    expect(db.tables.media_assets).toEqual([expect.objectContaining({ status: "pending", sha256: sha(bytes), rights_confirmed_at: CONFIRMED })]);
    expect(db.tables.media_consents ?? []).toEqual([]);
  });

  it("refuses other types, oversize and too-small photos before anything is stored", async () => {
    const bytes = await photo(1080, 1350);
    await expect(signed(bytes, { mime: "image/heic" })).rejects.toMatchObject({ status: 415 });
    await expect(signed(bytes, { bytes: 9 * 1024 * 1024 })).rejects.toMatchObject({ status: 413 });
    await expect(signed(bytes, { width: 500, height: 500 })).rejects.toMatchObject({ status: 422, code: "MEDIA_TOO_SMALL" });
    expect(db.tables.media_assets).toEqual([]);
  });

  // Reviewer (#1245): an upload token never overwrites. Dev 7 (#1245 attack): a retry keeps the row's one upload path,
  // so old tokens can't store uncounted files elsewhere; the unverified object from the earlier try goes.
  it("a retry of an unfinished upload reuses the row and its one path; tokens can't overwrite; a finished one is a duplicate", async () => {
    const bytes = await photo(1080, 1350);
    const first = await signed(bytes);
    db.objects.set(first.duplicate ? "" : first.path, bytes);
    const again = await signed(bytes);
    if (first.duplicate || again.duplicate) throw new Error("unexpected duplicate");
    expect(again.id).toBe(first.id);
    expect(again.path).toBe(first.path);
    expect(db.objects.has(first.path)).toBe(false);
    expect(db.uploadOptions.every((call) => call.upsert === false)).toBe(true);
    db.objects.set(again.path, bytes);
    await finalizeUpload(db.client, db.tables.media_assets[0] as MediaRow);
    await expect(signed(bytes)).resolves.toMatchObject({ duplicate: true, asset: { id: first.id } });
    expect(db.tables.media_assets).toHaveLength(1);
  });

  it(`stops at ${MEDIA_MONTHLY_UPLOADS} uploads this month`, async () => {
    for (let index = 0; index < MEDIA_MONTHLY_UPLOADS; index++) db.tables.media_assets.push({ business_id: BUSINESS, source: "upload", kind: "image", sha256: String(index).padStart(64, "0"), created_at: new Date().toISOString(), deleted_at: new Date().toISOString() });
    await expect(signed(await photo(1080, 1350))).rejects.toMatchObject({ status: 429, code: "MEDIA_QUOTA" });
  });

  // Reviewer (#2644): parallel requests can all pass the count; the database's trigger refuses the insert past the limit.
  it("answers 429 when the database's monthly limit refuses a request the count let through", async () => {
    db.insertErrors.push({ code: "P0001", message: "MEDIA_QUOTA" });
    await expect(signed(await photo(1080, 1350))).rejects.toMatchObject({ status: 429, code: "MEDIA_QUOTA" });
    expect(db.tables.media_assets).toEqual([]);
  });

  // #2644 attack: the limit is checked on insert, so last month's unfinished rows can't be finished uncounted this month.
  it("retires an unfinished upload from an earlier month and signs a new row the limit counts", async () => {
    const bytes = await photo(1080, 1350);
    const first = await signed(bytes);
    if (first.duplicate) throw new Error("unexpected duplicate");
    const stale = db.tables.media_assets[0];
    stale.created_at = new Date(Date.parse(monthStartIst()) - 60_000).toISOString();
    const again = await signed(bytes);
    if (again.duplicate) throw new Error("unexpected duplicate");
    expect(again.id).not.toBe(first.id);
    expect(again.path).not.toBe(first.path);
    expect(stale.deleted_at).toBeTruthy();
    expect(db.tables.media_assets).toHaveLength(2);
  });
});

describe("pending rows (Reviewer, #2644)", () => {
  it("get no signed URL, and can't be renamed, until finalize has checked the bytes", async () => {
    const result = await signed(await photo(1080, 1350));
    if (result.duplicate) throw new Error("unexpected duplicate");
    const row = db.tables.media_assets[0] as MediaRow;
    expect((await mediaViews(db.client, [row]))[0].url).toBeNull();
    await expect(updateMedia(db.client, row, { name: "x" })).rejects.toMatchObject({ status: 409, code: "MEDIA_NOT_UPLOADED" });
    expect(row.name ?? null).toBeNull();
  });
});

describe("finalizeUpload (#1209)", () => {
  async function pending(bytes: Uint8Array, stored: Uint8Array = bytes) {
    const result = await signed(bytes);
    if (result.duplicate) throw new Error("unexpected duplicate");
    db.objects.set(result.path, stored);
    return { ...db.tables.media_assets.find((row) => row.id === result.id) } as MediaRow;
  }

  it("re-reads the stored photo, records its real size and fit, and lists it with a signed URL", async () => {
    const bytes = await photo(1080, 1350);
    const asset = await finalizeUpload(db.client, await pending(bytes));
    expect(asset).toMatchObject({ width: 1080, height: 1350, fit: { level: "ready", ratio: "4:5" } });
    expect(asset.url).toMatch(/^https:\/\/storage\.test\/sign\//);
    expect(db.tables.media_assets[0]).toMatchObject({ status: "ready", mime: "image/jpeg" });
    expect((await listMedia(db.client, BUSINESS)).items.map((item) => item.id)).toEqual([asset.id]);
  });

  it("#780 slice 2a: reads the library's pick for Create in the owner's order, dropping bad, unready, deleted and other businesses' ids", async () => {
    const [first, second] = [await finalizeUpload(db.client, await pending(await photo(1080, 1350))), await finalizeUpload(db.client, await pending(await photo(1080, 1080)))];
    const unready = await pending(await photo(1200, 1200));
    db.tables.media_assets.push({ ...db.tables.media_assets.find((row) => row.id === first.id)!, id: "33333333-3333-4333-8333-333333333333", business_id: "44444444-4444-4444-8444-444444444444" });
    const picked = await pickedMediaViews(db.client, BUSINESS, [second.id, "not-a-uuid", unready.id, "33333333-3333-4333-8333-333333333333", first.id, second.id]);
    expect(picked.map((item) => item.id)).toEqual([second.id, first.id]);
    expect(picked.every((item) => item.url)).toBe(true);
    expect(await pickedMediaViews(db.client, BUSINESS, ["nope"])).toEqual([]);

    const videoId = "55555555-5555-4555-8555-555555555555";
    db.tables.media_assets.push({
      ...db.tables.media_assets.find((row) => row.id === first.id)!, id: videoId, kind: "video", path: `${BUSINESS}/clip.mp4`,
      mime: "video/mp4", width: 1080, height: 1920, duration_ms: 30_000,
    });
    expect(await pickedMediaViews(db.client, BUSINESS, [videoId])).toEqual([]);
    expect(await pickedMediaViews(db.client, BUSINESS, [videoId], true)).toMatchObject([
      { id: videoId, kind: "video", url: `https://storage.test/sign/${BUSINESS}/clip.mp4` },
    ]);
  });

  it("#780: the owner-written path admits a ready video only when video creation is enabled", async () => {
    const videoId = "55555555-5555-4555-8555-555555555555";
    const row = {
      id: videoId, business_id: BUSINESS, kind: "video", path: `${BUSINESS}/clip.mp4`, name: "Clip", tags: [], sha256: "a".repeat(64),
      bytes: 1_000, mime: "video/mp4", width: 1080, height: 1920, duration_ms: 30_000, checks: {}, status: "ready",
      deleted_at: null, created_at: "2026-10-29T10:00:00Z",
    };
    db.tables.media_assets.push(row);

    await expect(pickedOwnMedia(db.client, BUSINESS, [videoId], false))
      .rejects.toMatchObject({ status: 404, code: "MEDIA_VIDEO_DISABLED" });
    await expect(pickedOwnMedia(db.client, BUSINESS, [videoId], true)).resolves.toEqual([row]);

    row.status = "pending";
    await expect(pickedOwnMedia(db.client, BUSINESS, [videoId], true))
      .rejects.toMatchObject({ status: 409, code: "MEDIA_NOT_UPLOADED" });
  });

  it("#780: cannot select another business's media for owner-written ads", async () => {
    const videoId = "55555555-5555-4555-8555-555555555556";
    db.tables.media_assets.push({
      id: videoId, business_id: "44444444-4444-4444-8444-444444444444", kind: "video", path: "other/clip.mp4",
      name: "Clip", tags: [], sha256: "a".repeat(64), bytes: 1_000, mime: "video/mp4", width: 1080, height: 1920,
      duration_ms: 30_000, checks: {}, status: "ready", deleted_at: null, created_at: "2026-10-29T10:00:00Z",
    });

    await expect(pickedOwnMedia(db.client, BUSINESS, [videoId], true))
      .rejects.toMatchObject({ status: 404, code: "MEDIA_NOT_FOUND" });
  });

  // Dev 7 (#1245 attack): a refused upload still counts toward the month, so a reused token can't dodge the limit.
  it("removes the object and retires the row (still counted) when the bytes aren't the photo described, or aren't a photo", async () => {
    const bytes = await photo(1080, 1350);
    await expect(finalizeUpload(db.client, await pending(bytes, await photo(1080, 1351)))).rejects.toMatchObject({ status: 422, code: "MEDIA_CHANGED" });
    const text = new TextEncoder().encode("not a photo at all");
    await expect(finalizeUpload(db.client, await pending(text))).rejects.toMatchObject({ status: 415, code: "MEDIA_TYPE" });
    expect(db.tables.media_assets).toHaveLength(2);
    expect(db.tables.media_assets.every((row) => row.deleted_at && row.status === "pending")).toBe(true);
    expect(await monthlyUploads(db.client, BUSINESS)).toBe(2);
    expect(db.objects.size).toBe(0);
    expect(db.removed).toHaveLength(2);
    await expect(signed(bytes)).resolves.toMatchObject({ duplicate: false });
  });

  it("records the real type when a PNG was sent as a JPG, and refuses a stored photo that's too small", async () => {
    const png = await photo(1080, 1080, "png");
    await finalizeUpload(db.client, await pending(png));
    expect(db.tables.media_assets[0]).toMatchObject({ status: "ready", mime: "image/png" });
    const small = await photo(400, 400);
    await expect(finalizeUpload(db.client, await pending(small))).rejects.toMatchObject({ code: "MEDIA_TOO_SMALL" });
  });

  // Reviewer (#1245): an owner's home or a client's address must not ride along in a photo's EXIF into ads or Meta.
  it("strips EXIF/GPS on the server, whatever the browser did, and records the stored object's own hash", async () => {
    const withGps = new Uint8Array(await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#4a7" } })
      .withExif({ IFD0: { Make: "PhoneCo", Model: "X1" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "30/1 44/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "76/1 47/1 0/1" } })
      .jpeg().toBuffer());
    expect((await sharp(withGps).metadata()).exif).toBeDefined();
    const row = await pending(withGps);
    await finalizeUpload(db.client, row);
    const stored = db.objects.get(String(db.tables.media_assets[0].path))!;
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(db.tables.media_assets[0]).toMatchObject({ status: "ready", bytes: stored.length, checks: expect.objectContaining({ storedSha256: sha(stored) }) });
  });

  it("a photo is read for use only if it's still the bytes finalize stored", async () => {
    const bytes = await photo(1080, 1350);
    const row = await pending(bytes);
    await finalizeUpload(db.client, row);
    const ready = db.tables.media_assets[0] as MediaRow;
    await expect(readVerifiedMedia(db.client, ready)).resolves.toBeInstanceOf(Uint8Array);
    db.objects.set(ready.path, await photo(1080, 1351));
    await expect(readVerifiedMedia(db.client, ready)).rejects.toMatchObject({ code: "MEDIA_CHANGED" });
  });

  // Dev 7 (#1245 attack): a ready photo's bytes sit at a path no upload token was signed for.
  it("moves the checked bytes to a path no token was signed for, and drops the upload path", async () => {
    const bytes = await photo(1080, 1350);
    const row = await pending(bytes);
    await finalizeUpload(db.client, row);
    const ready = db.tables.media_assets[0] as MediaRow;
    expect(ready.path).not.toBe(row.path);
    expect(ready.path).toMatch(new RegExp(`^${BUSINESS}/[0-9a-f-]{36}\\.jpg$`));
    expect(db.uploadOptions.map((call) => call.path)).not.toContain(ready.path);
    expect(db.objects.has(row.path)).toBe(false);
    expect(sha(db.objects.get(ready.path)!)).toBe(sha(bytes));
  });

  it("a re-sign while finalize runs: the row isn't marked ready from the old read, and the checked copy goes", async () => {
    const bytes = await photo(1080, 1350);
    const row = await pending(bytes);
    const stale = { ...row, path: `${BUSINESS}/00000000-0000-4000-8000-000000000000.jpg` };
    db.objects.set(stale.path, bytes);
    await expect(finalizeUpload(db.client, stale)).rejects.toMatchObject({ status: 409, code: "MEDIA_CHANGED" });
    expect(db.tables.media_assets[0]).toMatchObject({ status: "pending", path: row.path });
    expect([...db.objects.keys()].sort()).toEqual([row.path, stale.path].sort());
  });

  it("two finalizes of one upload: the second answers with the first's photo and leaves no extra copy", async () => {
    const bytes = await photo(1080, 1350);
    const row = await pending(bytes);
    const first = await finalizeUpload(db.client, { ...row });
    db.objects.set(row.path, bytes);
    const second = await finalizeUpload(db.client, { ...row });
    expect(second.id).toBe(first.id);
    expect([...db.objects.keys()].sort()).toEqual([row.path, String(db.tables.media_assets[0].path)].sort());
    db.objects.set(row.path, await photo(1080, 1351));
    await expect(finalizeUpload(db.client, { ...row })).rejects.toMatchObject({ code: "MEDIA_CHANGED" });
    expect(db.tables.media_assets[0]).toMatchObject({ id: first.id, status: "ready" });
  });

  it("asks to retry when the upload never arrived, and keeps the row for that retry", async () => {
    const result = await signed(await photo(1080, 1350));
    if (result.duplicate) throw new Error("unexpected duplicate");
    await expect(finalizeUpload(db.client, db.tables.media_assets[0] as MediaRow)).rejects.toMatchObject({ status: 409, code: "MEDIA_NOT_UPLOADED" });
    expect(db.tables.media_assets).toHaveLength(1);
  });
});

describe("deleteMedia (#1209, #778)", () => {
  async function ready() {
    const bytes = await photo(1080, 1350);
    const result = await signed(bytes);
    if (result.duplicate) throw new Error("unexpected duplicate");
    db.objects.set(result.path, bytes);
    await finalizeUpload(db.client, db.tables.media_assets[0] as MediaRow);
    return db.tables.media_assets[0] as MediaRow;
  }

  it("refuses while a running campaign uses an ad made from the photo", async () => {
    const row = await ready();
    db.tables.creatives.push({ id: "c1", media_asset_id: row.id });
    db.tables.campaigns.push({ business_id: BUSINESS, status: "active", name: "Diwali offer", creative_ids: ["c1"] });
    await expect(deleteMedia(db.client, row)).rejects.toMatchObject({ status: 409, code: "MEDIA_IN_USE", message: expect.stringContaining("Diwali offer") });
    expect(db.objects.size).toBe(1);
  });

  it("removes the object, then soft-deletes the row; the photo can be added again", async () => {
    const row = await ready();
    db.tables.campaigns.push({ business_id: BUSINESS, status: "paused", name: "Old", creative_ids: ["c1"] });
    await deleteMedia(db.client, row);
    expect(db.objects.size).toBe(0);
    expect(db.tables.media_assets[0].deleted_at).toEqual(expect.any(String));
    expect((await listMedia(db.client, BUSINESS)).items).toEqual([]);
  });
});

describe("media routes (#1209)", () => {
  it("are off unless MEDIA_UPLOADS_ENABLED, and need a signed-in owner", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({ getEnv: () => ({ MEDIA_UPLOADS_ENABLED: false }) }));
    const { POST } = await import("@/app/api/media/sign/route");
    expect((await POST(new Request("http://localhost/api/media/sign", { method: "POST", body: "{}" }))).status).toBe(404);
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({ getEnv: () => ({ MEDIA_UPLOADS_ENABLED: true }) }));
    vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }));
    const signRoute = await import("@/app/api/media/sign/route");
    expect((await signRoute.POST(new Request("http://localhost/api/media/sign", { method: "POST", body: "{}" }))).status).toBe(401);
    const list = await import("@/app/api/media/route");
    expect((await list.GET(new Request(`http://localhost/api/media?businessId=${BUSINESS}`))).status).toBe(401);
    vi.doUnmock("@/lib/supabase/server");
  });

  it("answers 404, not 503, for an id that isn't a uuid, without reading", async () => {
    const from = vi.fn();
    await expect(ownMedia({ from } as unknown as SupabaseClient, "not-a-uuid")).rejects.toMatchObject({ status: 404, code: "MEDIA_NOT_FOUND" });
    expect(from).not.toHaveBeenCalled();
  });

  it("maps a MediaError to its status and plain message", async () => {
    vi.resetModules();
    const { mediaErrorResponse } = await import("@/lib/media/route-helpers");
    const { MediaError } = await import("@/lib/media/store");
    const response = mediaErrorResponse(new MediaError(429, "MEDIA_QUOTA", "You've used 50 of 50 photo uploads this month."));
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: "You've used 50 of 50 photo uploads this month.", code: "MEDIA_QUOTA" });
  });
});
