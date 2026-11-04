import { beforeEach, describe, expect, it, vi } from "vitest";

// #781: turning MEDIA_UPLOADS_ENABLED off after a video was linked must not let Review or launch fall back to its poster.
const flags = vi.hoisted(() => ({ uploads: false, video: false }));
vi.mock("@/lib/media/store", () => ({
  mediaUploadsEnabled: () => flags.uploads,
  mediaVideoEnabled: () => flags.uploads && flags.video,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/services/meta-media-store", () => ({
  supabaseMetaMediaReader: () => ({
    asset: async (businessId: string, id: string) => ({ id, businessId, kind: "video", status: "ready", deletedAt: null, path: "p" }),
    upload: async () => ({ status: "ready", videoId: "v1" }),
  }),
}));

import { loadCreativeVideos } from "@/lib/campaign/creative-video";

const database = (rows: { id: string; media_asset_id: string | null }[]) => ({
  from: () => ({ select: () => ({ in: () => ({ eq: async () => ({ data: rows, error: null }) }) }) }),
}) as never;

describe("loadCreativeVideos with uploads off (#781)", () => {
  beforeEach(() => {
    flags.uploads = false;
    flags.video = false;
  });

  it("still reads the link, and a ready video is an error rather than missing", async () => {
    const account = vi.fn(async () => "act_1");
    const videos = await loadCreativeVideos(database([{ id: "c1", media_asset_id: "m1" }, { id: "c2", media_asset_id: null }]), "b1", ["c1", "c2"], account);
    expect(videos.get("c1")).toMatchObject({ state: "error", assetId: "m1" });
    expect(videos.has("c2")).toBe(false);
    expect(account).not.toHaveBeenCalled();
  });

  it("blocks a linked video when uploads are on but the video flag is off", async () => {
    flags.uploads = true;
    const account = vi.fn(async () => "act_1");
    const videos = await loadCreativeVideos(database([{ id: "c1", media_asset_id: "m1" }]), "b1", ["c1"], account);
    expect(videos.get("c1")).toMatchObject({ state: "error", assetId: "m1" });
    expect(account).not.toHaveBeenCalled();
  });

  it("reads the selected account and accepts its ready video when both flags are on", async () => {
    flags.uploads = true;
    flags.video = true;
    const account = vi.fn(async () => "act_1");
    const videos = await loadCreativeVideos(database([{ id: "c1", media_asset_id: "m1" }]), "b1", ["c1"], account);
    expect(videos.get("c1")).toMatchObject({ state: "ready", assetId: "m1", videoId: "v1" });
    expect(account).toHaveBeenCalledOnce();
  });

  it("does not pass preflight when the creative query returns no result", async () => {
    const query = { select: () => query, in: () => query, eq: async () => ({ data: null, error: null }) };
    await expect(loadCreativeVideos({ from: () => query } as never, "b1", ["c1"], async () => "act_1")).rejects.toThrow();
  });
});
