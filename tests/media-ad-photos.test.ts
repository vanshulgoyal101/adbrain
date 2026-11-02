import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaRow } from "@/lib/media/store";

const mocks = vi.hoisted(() => ({ views: vi.fn(), read: vi.fn(), describe: vi.fn(), update: vi.fn(), saveError: null as unknown }));
vi.mock("@/lib/media/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media/store")>()),
  mediaViews: mocks.views,
  readVerifiedMedia: mocks.read,
}));
vi.mock("@/lib/media/describe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media/describe")>()),
  describePhoto: mocks.describe,
}));

const admin = {
  from: () => ({ update: (row: unknown) => ({ eq: () => ({ is: async () => { mocks.update(row); return { error: mocks.saveError }; } }) }) }),
} as unknown as SupabaseClient;
const row = (id: string, extra: Partial<MediaRow> = {}) => ({ id, business_id: "b", mime: "image/jpeg", status: "ready", ...extra }) as MediaRow;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.saveError = null;
  mocks.views.mockImplementation(async (_admin, rows: MediaRow[]) => rows.map((r) => ({ url: `https://signed/${r.id}` })));
  mocks.read.mockResolvedValue(new Uint8Array([1, 2]));
});

describe("library photos for Create (#780)", () => {
  it("reads only never-described photos, and refuses an unreadable one before any AI call", async () => {
    const { readAdPhotos } = await import("@/lib/media/ad-photos");
    const read = await readAdPhotos(admin, [row("old", { description: "A cake.", visible_text: null }), row("new")]);
    expect(read.map((p) => [p.row.id, p.url, p.notes, p.bytes])).toEqual([
      ["old", "https://signed/old", { description: "A cake.", visibleText: null }, null],
      ["new", "https://signed/new", null, new Uint8Array([1, 2])],
    ]);
    expect(mocks.read).toHaveBeenCalledOnce();

    mocks.read.mockRejectedValueOnce(Object.assign(new Error("gone"), { status: 503 }));
    await expect(readAdPhotos(admin, [row("deleted")])).rejects.toThrow();
    mocks.views.mockResolvedValueOnce([{ url: null }]);
    await expect(readAdPhotos(admin, [row("unsigned")])).rejects.toMatchObject({ code: "MEDIA_UNAVAILABLE" });
    expect(mocks.describe).not.toHaveBeenCalled();
  });

  it("describes each new photo once, saves the answer, and never throws when the vision call fails", async () => {
    const { adPhotos, readAdPhotos } = await import("@/lib/media/ad-photos");
    const read = await readAdPhotos(admin, [row("old", { description: "A cake." }), row("ok"), row("fails")]);
    mocks.describe.mockImplementation(async (_image, { onAttempt }) => {
      onAttempt({ provider: "openrouter", status: "success" });
      return mocks.describe.mock.calls.length === 1 ? { description: "A sign.", visibleText: "Haircut ₹149" } : null;
    });
    const attempts: string[] = [];
    const photos = await adPhotos(admin, read, { onAttempt: (_attempt, id) => attempts.push(id) });
    expect(photos).toEqual([
      { mediaId: "old", url: "https://signed/old", notes: { description: "A cake.", visibleText: null } },
      { mediaId: "ok", url: "https://signed/ok", notes: { description: "A sign.", visibleText: "Haircut ₹149" } },
      { mediaId: "fails", url: "https://signed/fails", notes: null },
    ]);
    expect(attempts.sort()).toEqual(["fails", "ok"]);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ description: "A sign.", visible_text: "Haircut ₹149" });
  });

  it("keeps the notes for this Create but logs an answer the database refused to save", async () => {
    const { adPhotos, readAdPhotos } = await import("@/lib/media/ad-photos");
    mocks.saveError = { message: "permission denied for table media_assets", code: "42501" };
    mocks.describe.mockResolvedValue({ description: "A sign.", visibleText: null });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const photos = await adPhotos(admin, await readAdPhotos(admin, [row("new")]));
    expect(photos).toEqual([{ mediaId: "new", url: "https://signed/new", notes: { description: "A sign.", visibleText: null } }]);
    expect(JSON.parse(logged.mock.calls[0][0] as string)).toMatchObject({ source: "adbrain.media", code: "PHOTO_NOTES_NOT_SAVED", mediaId: "new", message: "permission denied for table media_assets" });
    logged.mockRestore();
  });
});
