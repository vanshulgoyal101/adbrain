import { beforeEach, describe, expect, it, vi } from "vitest";
import { pickedMediaViews, pickedOwnMedia, type MediaRow } from "@/lib/media/store";
import { fakeSupabase } from "./helpers/media-fake";

const config = vi.hoisted(() => ({ uploads: true, video: true, businesses: "" }));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    MEDIA_UPLOADS_ENABLED: config.uploads,
    MEDIA_VIDEO_ENABLED: config.video,
    MEDIA_PILOT_BUSINESS_IDS: config.businesses,
  }),
}));

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const OTHER_BUSINESS = "22222222-2222-4222-8222-222222222222";
const IMAGE_ID = "33333333-3333-4333-8333-333333333333";
const VIDEO_ID = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  config.uploads = true;
  config.video = true;
  config.businesses = "";
});

function mediaRow(overrides: Partial<MediaRow> = {}): MediaRow {
  const kind = overrides.kind ?? "image";
  const id = overrides.id ?? IMAGE_ID;
  return {
    id,
    business_id: BUSINESS,
    kind,
    path: `${BUSINESS}/${kind === "video" ? "clip.mp4" : "photo.jpg"}`,
    name: null,
    tags: [],
    sha256: "a".repeat(64),
    bytes: 1000,
    mime: kind === "video" ? "video/mp4" : "image/jpeg",
    width: 1080,
    height: kind === "video" ? 1920 : 1350,
    duration_ms: kind === "video" ? 30_000 : null,
    checks: {},
    status: "ready",
    deleted_at: null,
    created_at: "2026-11-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("picked media contract (#748, #780)", () => {
  it("shows picked videos only for the server-allowlisted business", async () => {
    const db = fakeSupabase();
    const image = mediaRow();
    const video = mediaRow({ id: VIDEO_ID, kind: "video" });
    db.tables.media_assets.push(image, video);

    await expect(pickedMediaViews(db.client, BUSINESS, [VIDEO_ID, IMAGE_ID])).resolves.toMatchObject([
      { id: IMAGE_ID, kind: "image" },
    ]);

    config.businesses = BUSINESS;
    await expect(pickedMediaViews(db.client, BUSINESS, [VIDEO_ID, IMAGE_ID])).resolves.toMatchObject([
      { id: VIDEO_ID, kind: "video", url: expect.stringContaining("clip.mp4") },
      { id: IMAGE_ID, kind: "image" },
    ]);

    config.video = false;
    await expect(pickedMediaViews(db.client, BUSINESS, [VIDEO_ID, IMAGE_ID])).resolves.toMatchObject([
      { id: IMAGE_ID, kind: "image" },
    ]);
  });

  it("does not let a caller-supplied flag bypass the business video pilot", async () => {
    const db = fakeSupabase();
    const video = mediaRow({ id: VIDEO_ID, kind: "video" });
    db.tables.media_assets.push(video);
    config.businesses = OTHER_BUSINESS;

    const [views, ownResult] = await Promise.all([
      Reflect.apply(pickedMediaViews, undefined, [db.client, BUSINESS, [VIDEO_ID], true]),
      Reflect.apply(pickedOwnMedia, undefined, [db.client, BUSINESS, [VIDEO_ID], true]).then(
        (rows: MediaRow[]) => ({ rows }),
        (error: unknown) => ({ error }),
      ),
    ]);
    expect(views).toEqual([]);
    expect(ownResult).toMatchObject({ error: { status: 404, code: "MEDIA_VIDEO_DISABLED" } });

    config.businesses = BUSINESS;
    await expect(pickedOwnMedia(db.client, BUSINESS, [VIDEO_ID])).resolves.toEqual([video]);
    await expect(pickedOwnMedia(db.client, BUSINESS, [IMAGE_ID]))
      .rejects.toMatchObject({ status: 404, code: "MEDIA_NOT_FOUND" });

    video.status = "pending";
    await expect(pickedOwnMedia(db.client, BUSINESS, [VIDEO_ID]))
      .rejects.toMatchObject({ status: 409, code: "MEDIA_NOT_UPLOADED" });
  });

  it("fails closed when the server pilot allowlist is malformed", async () => {
    const db = fakeSupabase();
    db.tables.media_assets.push(mediaRow({ id: VIDEO_ID, kind: "video" }));
    config.businesses = `${BUSINESS},not-a-uuid`;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(Reflect.apply(pickedMediaViews, undefined, [db.client, BUSINESS, [VIDEO_ID], true])).resolves.toEqual([]);
      expect(error).toHaveBeenCalledWith("Media pilot configuration contains an invalid business ID; the pilot is disabled.");
    } finally {
      error.mockRestore();
    }
  });
});
