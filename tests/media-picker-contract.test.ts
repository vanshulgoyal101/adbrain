import { describe, expect, it, vi } from "vitest";
import { pickedMediaViews, pickedOwnMedia, type MediaRow } from "@/lib/media/store";
import { fakeSupabase } from "./helpers/media-fake";

vi.mock("@/lib/env", () => ({ getEnv: () => ({ MEDIA_UPLOADS_ENABLED: true, MEDIA_VIDEO_ENABLED: true }) }));

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const OTHER_BUSINESS = "22222222-2222-4222-8222-222222222222";
const IMAGE_ID = "33333333-3333-4333-8333-333333333333";
const VIDEO_ID = "44444444-4444-4444-8444-444444444444";

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
  it("keeps the Create preview image-only by default and includes videos only when enabled", async () => {
    const db = fakeSupabase();
    const image = mediaRow();
    const video = mediaRow({ id: VIDEO_ID, kind: "video" });
    db.tables.media_assets.push(image, video);

    await expect(pickedMediaViews(db.client, BUSINESS, [VIDEO_ID, IMAGE_ID])).resolves.toMatchObject([
      { id: IMAGE_ID, kind: "image" },
    ]);
    await expect(pickedMediaViews(db.client, BUSINESS, [VIDEO_ID, IMAGE_ID], true)).resolves.toMatchObject([
      { id: VIDEO_ID, kind: "video", url: expect.stringContaining("clip.mp4") },
      { id: IMAGE_ID, kind: "image" },
    ]);
  });

  it("returns only ready media belonging to the requested business and gates video explicitly", async () => {
    const db = fakeSupabase();
    const video = mediaRow({ id: VIDEO_ID, kind: "video" });
    db.tables.media_assets.push(video, mediaRow({ id: IMAGE_ID, business_id: OTHER_BUSINESS }));

    await expect(pickedOwnMedia(db.client, BUSINESS, [VIDEO_ID], false))
      .rejects.toMatchObject({ status: 404, code: "MEDIA_VIDEO_DISABLED" });
    await expect(pickedOwnMedia(db.client, BUSINESS, [VIDEO_ID], true)).resolves.toEqual([video]);
    await expect(pickedOwnMedia(db.client, BUSINESS, [IMAGE_ID], true))
      .rejects.toMatchObject({ status: 404, code: "MEDIA_NOT_FOUND" });

    video.status = "pending";
    await expect(pickedOwnMedia(db.client, BUSINESS, [VIDEO_ID], true))
      .rejects.toMatchObject({ status: 409, code: "MEDIA_NOT_UPLOADED" });
  });
});
