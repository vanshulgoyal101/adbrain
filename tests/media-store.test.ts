import sharp from "sharp";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEDIA_MONTHLY_UPLOADS, mediaFit } from "@/lib/media/rules";
const CONFIRMED = "2026-10-28T10:00:00.000Z";
import { deleteMedia, finalizeUpload, listMedia, monthStartIst, ownMedia, readVerifiedMedia, signUpload, type MediaRow } from "@/lib/media/store";

vi.mock("@/lib/env", () => ({ getEnv: () => ({ MEDIA_UPLOADS_ENABLED: true }) }));

// #1209: an in-memory stand-in for the media tables and the private bucket, enough for the store's queries.
type Row = Record<string, unknown>;
function fakeSupabase() {
  const tables: Record<string, Row[]> = { media_assets: [], media_consents: [], creatives: [], campaigns: [] };
  const objects = new Map<string, Uint8Array>();
  const uploadOptions: { path: string; upsert?: boolean }[] = [];
  const removed: string[] = [];
  const query = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let order: { column: string; ascending: boolean } | null = null;
    let limit = Infinity;
    let head = false;
    let action: { kind: "select" } | { kind: "insert"; row: Row } | { kind: "update"; change: Row } | { kind: "delete" } = { kind: "select" };
    const run = () => {
      const rows = tables[table];
      if (action.kind === "insert") {
        const row: Row = { id: crypto.randomUUID(), tags: [], checks: {}, status: "pending", deleted_at: null, source: "upload", created_at: new Date().toISOString(), confirmed_at: new Date().toISOString(), ...action.row };
        if (table === "media_assets" && rows.some((other) => other.business_id === row.business_id && other.sha256 === row.sha256 && !other.deleted_at)) {
          return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        rows.push(row);
        return { data: [row], error: null };
      }
      let matched = rows.filter((row) => filters.every((filter) => filter(row)));
      if (action.kind === "update") { const change = action.change; matched.forEach((row) => Object.assign(row, change)); return { data: matched, error: null }; }
      if (action.kind === "delete") { tables[table] = rows.filter((row) => !matched.includes(row)); return { data: matched, error: null }; }
      if (order) { const { column, ascending } = order; matched = [...matched].sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1)); }
      return { data: matched.slice(0, limit), error: null, count: head ? matched.length : undefined };
    };
    const builder = {
      select: (_columns?: string, options?: { head?: boolean }) => { head = Boolean(options?.head); return builder; },
      insert: (row: Row) => { action = { kind: "insert", row }; return builder; },
      update: (change: Row) => { action = { kind: "update", change }; return builder; },
      delete: () => { action = { kind: "delete" }; return builder; },
      eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; },
      is: (column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return builder; },
      gte: (column: string, value: string) => { filters.push((row) => String(row[column]) >= value); return builder; },
      lt: (column: string, value: string) => { filters.push((row) => String(row[column]) < value); return builder; },
      overlaps: (column: string, values: string[]) => { filters.push((row) => ((row[column] as string[]) ?? []).some((value) => values.includes(value))); return builder; },
      order: (column: string, options: { ascending: boolean }) => { order = { column, ascending: options.ascending }; return builder; },
      limit: (count: number) => { limit = count; return builder; },
      maybeSingle: async () => { const result = run(); return { data: result.data?.[0] ?? null, error: result.error }; },
      single: async () => { const result = run(); return { data: result.data?.[0] ?? null, error: result.error ?? (result.data?.length ? null : { message: "none" }) }; },
      then: (resolve: (value: unknown) => unknown) => resolve(run()),
    };
    return builder;
  };
  const client = {
    from: query,
    storage: {
      from: () => ({
        createSignedUploadUrl: async (path: string, options?: { upsert?: boolean }) => {
          uploadOptions.push({ path, upsert: options?.upsert });
          return { data: { path, token: `token-${path}`, signedUrl: `https://storage.test/upload/${path}` }, error: null };
        },
        upload: async (path: string, body: Uint8Array) => { objects.set(path, new Uint8Array(body)); return { data: { path }, error: null }; },
        download: async (path: string) => objects.has(path)
          ? { data: new Blob([objects.get(path)! as BlobPart]), error: null }
          : { data: null, error: { message: "Object not found" } },
        remove: async (paths: string[]) => { for (const path of paths) { objects.delete(path); removed.push(path); } return { data: [], error: null }; },
        createSignedUrls: async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://storage.test/sign/${path}` })), error: null }),
      }),
    },
  };
  return { client: client as unknown as SupabaseClient, tables, objects, removed, uploadOptions };
}

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

  // Reviewer (#1245): an upload token never overwrites; a retry gets a new path on the same row, and the old object goes.
  it("a retry of an unfinished upload gets a new path on the same row; tokens can't overwrite; a finished one is a duplicate", async () => {
    const bytes = await photo(1080, 1350);
    const first = await signed(bytes);
    db.objects.set(first.duplicate ? "" : first.path, bytes);
    const again = await signed(bytes);
    if (first.duplicate || again.duplicate) throw new Error("unexpected duplicate");
    expect(again.id).toBe(first.id);
    expect(again.path).not.toBe(first.path);
    expect(db.objects.has(first.path)).toBe(false);
    expect(db.uploadOptions.every((call) => call.upsert === false)).toBe(true);
    db.objects.set(again.path, bytes);
    await finalizeUpload(db.client, db.tables.media_assets[0] as MediaRow);
    await expect(signed(bytes)).resolves.toMatchObject({ duplicate: true, asset: { id: first.id } });
    expect(db.tables.media_assets).toHaveLength(1);
  });

  it(`stops at ${MEDIA_MONTHLY_UPLOADS} uploads this month`, async () => {
    for (let index = 0; index < MEDIA_MONTHLY_UPLOADS; index++) db.tables.media_assets.push({ business_id: BUSINESS, source: "upload", sha256: String(index).padStart(64, "0"), created_at: new Date().toISOString(), deleted_at: new Date().toISOString() });
    await expect(signed(await photo(1080, 1350))).rejects.toMatchObject({ status: 429, code: "MEDIA_QUOTA" });
  });
});

describe("finalizeUpload (#1209)", () => {
  async function pending(bytes: Uint8Array, stored: Uint8Array = bytes) {
    const result = await signed(bytes);
    if (result.duplicate) throw new Error("unexpected duplicate");
    db.objects.set(result.path, stored);
    return db.tables.media_assets.find((row) => row.id === result.id) as MediaRow;
  }

  it("re-reads the stored photo, records its real size and fit, and lists it with a signed URL", async () => {
    const bytes = await photo(1080, 1350);
    const asset = await finalizeUpload(db.client, await pending(bytes));
    expect(asset).toMatchObject({ width: 1080, height: 1350, fit: { level: "ready", ratio: "4:5" } });
    expect(asset.url).toMatch(/^https:\/\/storage\.test\/sign\//);
    expect(db.tables.media_assets[0]).toMatchObject({ status: "ready", mime: "image/jpeg" });
    expect((await listMedia(db.client, BUSINESS)).items.map((item) => item.id)).toEqual([asset.id]);
  });

  it("removes the object and the row when the bytes aren't the photo described, or aren't a photo", async () => {
    const bytes = await photo(1080, 1350);
    await expect(finalizeUpload(db.client, await pending(bytes, await photo(1080, 1351)))).rejects.toMatchObject({ status: 422, code: "MEDIA_CHANGED" });
    const text = new TextEncoder().encode("not a photo at all");
    await expect(finalizeUpload(db.client, await pending(text))).rejects.toMatchObject({ status: 415, code: "MEDIA_TYPE" });
    expect(db.tables.media_assets).toEqual([]);
    expect(db.objects.size).toBe(0);
    expect(db.removed).toHaveLength(2);
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
    const stored = db.objects.get(row.path)!;
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
