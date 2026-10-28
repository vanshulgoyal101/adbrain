import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #1865 (QA red tests for #744 slice A, #1209): the media library's trust boundaries. Another business can't list,
// sign into, read or delete an asset; an oversized or wrong-type upload is refused before anything is stored, and a
// stored object that isn't a real JPG/PNG/WebP is removed; read URLs are signed and expire; deleting an asset removes
// its object. Skips until the routes exist (contract: #1245's `/api/media`, `/api/media/sign`, `/api/media/[id]`
// and `src/lib/media/store.ts`). The bucket's own policy (another owner can't select `media/<business>/…` objects)
// belongs in #1224's metadb check.
const FILES = ["src/app/api/media/route.ts", "src/app/api/media/sign/route.ts", "src/app/api/media/[id]/route.ts", "src/lib/media/store.ts"];
const built = FILES.every((file) => existsSync(join(process.cwd(), file)));
const load = (file: string) => import(/* @vite-ignore */ join(process.cwd(), file));

const MINE = "11111111-1111-4111-8111-111111111111";
const THEIRS = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const OTHER_OWNER = "44444444-4444-4444-8444-444444444444";
const THEIR_ASSET = "55555555-5555-4555-8555-555555555555";

type Row = Record<string, unknown>;
type Call = { client: "rls" | "admin"; table?: string; bucket?: string; op: string; args?: unknown[] };

const m = vi.hoisted(() => ({
  calls: [] as Call[],
  db: {} as Record<string, Row[]>,
  objects: new Map<string, Uint8Array>(),
}));

/** A tiny query builder over `m.db`. The RLS client sees only rows of businesses `OWNER` owns. */
function builder(client: "rls" | "admin", table: string) {
  const filters: ((row: Row) => boolean)[] = [];
  let action: { op: "select" } | { op: "insert"; row: Row } | { op: "update"; change: Row } | { op: "delete" } = { op: "select" };
  let limit = Infinity;
  const owned = (row: Row) => {
    if (client === "admin") return true;
    const businessId = table === "businesses" ? row.id : row.business_id;
    return (m.db.businesses ?? []).some((b) => b.id === businessId && b.owner_id === OWNER);
  };
  const run = () => {
    const rows = (m.db[table] ??= []);
    if (action.op === "insert") { const row = { id: crypto.randomUUID(), ...action.row }; rows.push(row); return { data: row, error: null }; }
    const matched = rows.filter((row) => owned(row) && filters.every((f) => f(row))).slice(0, limit);
    if (action.op === "update") { const change = action.change; matched.forEach((row) => Object.assign(row, change)); }
    if (action.op === "delete") m.db[table] = rows.filter((row) => !matched.includes(row));
    return { data: matched, error: null, count: matched.length };
  };
  const self: Record<string, unknown> = {
    select: () => self,
    insert: (row: Row) => { m.calls.push({ client, table, op: "insert" }); action = { op: "insert", row }; return self; },
    update: (change: Row) => { m.calls.push({ client, table, op: "update" }); action = { op: "update", change }; return self; },
    delete: () => { m.calls.push({ client, table, op: "delete" }); action = { op: "delete" }; return self; },
    eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return self; },
    is: (column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return self; },
    gte: () => self, lt: () => self, order: () => self, overlaps: () => self, abortSignal: () => self,
    limit: (n: number) => { limit = n; return self; },
    maybeSingle: async () => { const r = run(); const d = Array.isArray(r.data) ? r.data[0] ?? null : r.data; return { data: d, error: null }; },
    single: async () => { const r = run(); const d = Array.isArray(r.data) ? r.data[0] ?? null : r.data; return { data: d, error: d ? null : { message: "none" } }; },
    then: (resolve: (value: unknown) => void) => resolve(run()),
  };
  if (table) m.calls.push({ client, table, op: "from" });
  return self;
}

function storage(client: "rls" | "admin") {
  return {
    from: (bucket: string) => {
      const record = (op: string, ...args: unknown[]) => m.calls.push({ client, bucket, op, args });
      return {
        createSignedUploadUrl: async (path: string) => { record("createSignedUploadUrl", path); return { data: { token: "t", path }, error: null }; },
        createSignedUrls: async (paths: string[], expiresIn: number) => { record("createSignedUrls", paths, expiresIn); return { data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}?e=${expiresIn}` })), error: null }; },
        createSignedUrl: async (path: string, expiresIn: number) => { record("createSignedUrl", path, expiresIn); return { data: { signedUrl: `https://signed/${path}?e=${expiresIn}` }, error: null }; },
        getPublicUrl: (path: string) => { record("getPublicUrl", path); return { data: { publicUrl: `https://public/${path}` } }; },
        download: async (path: string) => { record("download", path); const bytes = m.objects.get(path); return bytes ? { data: new Blob([Buffer.from(bytes)]), error: null } : { data: null, error: { message: "missing" } }; },
        remove: async (paths: string[]) => { record("remove", paths); paths.forEach((p) => m.objects.delete(p)); return { data: [], error: null }; },
      };
    },
  };
}

vi.mock("@/lib/env", async (original) => ({ ...await original<Record<string, unknown>>(), getEnv: () => ({ MEDIA_UPLOADS_ENABLED: true }) }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: OWNER, email: "owner@example.com" } }, error: null }) },
    from: (table: string) => builder("rls", table),
    storage: storage("rls"),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => builder("admin", table), storage: storage("admin"), rpc: async () => ({ data: null, error: null }) }),
}));

const theirPath = `${THEIRS}/${THEIR_ASSET}.jpg`;
beforeEach(() => {
  m.calls.length = 0;
  m.objects.clear();
  m.db = {
    businesses: [{ id: MINE, owner_id: OWNER, name: "Mine" }, { id: THEIRS, owner_id: OTHER_OWNER, name: "Theirs" }],
    media_assets: [{ id: THEIR_ASSET, business_id: THEIRS, bucket: "media", path: theirPath, status: "ready", deleted_at: null, sha256: "a".repeat(64), width: 1080, height: 1350, tags: [], created_at: "2026-10-28T00:00:00Z" }],
    media_consents: [{ business_id: MINE, user_id: OWNER, terms_version: "media-v1", people_confirmed: true }],
    creatives: [], campaigns: [],
  };
  m.objects.set(theirPath, new Uint8Array([1, 2, 3]));
});

const touchedAssets = () => m.calls.filter((c) => c.table === "media_assets" && c.op !== "from" || (c.bucket && c.op !== "getPublicUrl"));
const signBody = (over: Record<string, unknown> = {}) => ({ businessId: MINE, mime: "image/jpeg", bytes: 500_000, sha256: "b".repeat(64), width: 1080, height: 1350, rightsConfirmed: true, ...over });
async function sign(body: Record<string, unknown>) {
  const { POST } = await load("src/app/api/media/sign/route.ts");
  return POST(new Request("https://adbrain.vanshul.com/api/media/sign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })) as Promise<Response>;
}

describe.skipIf(!built)("media library boundaries (#1865, #1209 slice A)", () => {
  it("another business's library can't be listed: 404, and no asset row or object is read", async () => {
    const { GET } = await load("src/app/api/media/route.ts");
    const response: Response = await GET(new Request(`https://adbrain.vanshul.com/api/media?businessId=${THEIRS}`));
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain(THEIR_ASSET);
    expect(touchedAssets()).toEqual([]);
  });

  it("no upload URL is minted into another business's folder", async () => {
    const response = await sign(signBody({ businessId: THEIRS }));
    expect(response.status).toBe(404);
    expect(m.calls.filter((c) => c.op === "insert" || c.op === "createSignedUploadUrl")).toEqual([]);
  });

  it("another business's asset can't be deleted: 404, and its object and row stay", async () => {
    const { DELETE } = await load("src/app/api/media/[id]/route.ts");
    const response: Response = await DELETE(new Request(`https://adbrain.vanshul.com/api/media/${THEIR_ASSET}`, { method: "DELETE" }), { params: Promise.resolve({ id: THEIR_ASSET }) });
    expect(response.status).toBe(404);
    expect(m.calls.filter((c) => c.op === "remove" || (c.table === "media_assets" && ["update", "delete"].includes(c.op)))).toEqual([]);
    expect(m.objects.has(theirPath)).toBe(true);
    expect(m.db.media_assets.find((row) => row.id === THEIR_ASSET)?.deleted_at).toBeNull();
  });

  it.each([
    ["over 8 MB", { bytes: 8 * 1024 * 1024 + 1 }, 413],
    ["a GIF", { mime: "image/gif" }, 415],
    ["an SVG", { mime: "image/svg+xml" }, 415],
    ["a HEIC", { mime: "image/heic" }, 415],
  ])("%s is refused before anything is stored or signed", async (_label, over, status) => {
    const response = await sign(signBody(over));
    expect(response.status).toBe(status);
    expect(m.calls.filter((c) => c.op === "insert" || c.op === "createSignedUploadUrl")).toEqual([]);
  });

  it("a stored object that isn't really a JPG/PNG/WebP is refused and removed, whatever the browser declared", async () => {
    const { finalizeUpload } = await load("src/lib/media/store.ts");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const gif = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#888" } }).gif().toBuffer();
    const path = `${MINE}/pending.jpg`;
    m.objects.set(path, new Uint8Array(gif));
    const row = { id: crypto.randomUUID(), business_id: MINE, bucket: "media", path, status: "pending", deleted_at: null, mime: "image/jpeg", sha256: createHash("sha256").update(gif).digest("hex"), tags: [], checks: {}, created_at: "2026-10-28T00:00:00Z" };
    m.db.media_assets.push(row);
    await expect(finalizeUpload(createAdminClient(), row)).rejects.toMatchObject({ status: 415 });
    expect(m.objects.has(path)).toBe(false);
    expect(m.db.media_assets.some((r) => r.id === row.id && r.status === "ready")).toBe(false);
  });

  it("read URLs are signed and expire within an hour; nothing uses a public URL", async () => {
    const { mediaViews } = await load("src/lib/media/store.ts");
    const { createClient } = await import("@/lib/supabase/server");
    const mine = { id: crypto.randomUUID(), business_id: MINE, path: `${MINE}/a.jpg`, status: "ready", width: 1080, height: 1350, tags: [], created_at: "2026-10-28T00:00:00Z" };
    const views = await mediaViews(await createClient(), [mine]);
    const signing = m.calls.filter((c) => c.op === "createSignedUrls" || c.op === "createSignedUrl");
    expect(signing.length).toBeGreaterThan(0);
    for (const call of signing) {
      const seconds = call.args?.at(-1) as number;
      expect(seconds).toBeGreaterThan(0);
      expect(seconds).toBeLessThanOrEqual(3600);
      expect(call.bucket).toBe("media");
    }
    expect(m.calls.some((c) => c.op === "getPublicUrl")).toBe(false);
    expect(views[0].url).toMatch(/^https:\/\/signed\//);
  });

  it("deleting my asset removes its object from the private bucket, not just the row", async () => {
    const { deleteMedia } = await load("src/lib/media/store.ts");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const path = `${MINE}/mine.jpg`;
    m.objects.set(path, new Uint8Array([9]));
    const row = { id: crypto.randomUUID(), business_id: MINE, bucket: "media", path, status: "ready", deleted_at: null, tags: [], created_at: "2026-10-28T00:00:00Z" };
    m.db.media_assets.push(row);
    await deleteMedia(createAdminClient(), row);
    expect(m.calls.some((c) => c.op === "remove" && c.bucket === "media" && JSON.stringify(c.args).includes(path))).toBe(true);
    expect(m.objects.has(path)).toBe(false);
  });
});
