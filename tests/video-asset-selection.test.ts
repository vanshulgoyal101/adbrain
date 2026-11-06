import { beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ video: false }));
vi.mock("@/lib/media/store", () => ({ mediaVideoEnabled: () => flags.video }));
vi.mock("@/services/meta-media-store", () => ({ supabaseMetaMediaReader: vi.fn() }));
import { findVideoAssetIds } from "@/lib/campaign/creative-video";

function database(result: { data: { id: string }[] | null; error: object | null }) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(async () => result),
  };
  return { from: vi.fn(() => query), query };
}

describe("selected video assets (#781)", () => {
  beforeEach(() => { flags.video = false; });

  it("does not query or prepare anything when videos are disabled", async () => {
    const db = database({ data: [], error: null });
    expect(await findVideoAssetIds(db as never, "business-1", ["video-1"])).toEqual([]);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("reads only selected video IDs for this business through the supplied client", async () => {
    flags.video = true;
    const db = database({ data: [{ id: "video-1" }], error: null });
    expect(await findVideoAssetIds(db as never, "business-1", ["photo-1", "video-1"])).toEqual(["video-1"]);
    expect(db.from).toHaveBeenCalledWith("media_assets");
    expect(db.query.eq).toHaveBeenCalledWith("business_id", "business-1");
    expect(db.query.eq).toHaveBeenCalledWith("kind", "video");
    expect(db.query.in).toHaveBeenCalledWith("id", ["photo-1", "video-1"]);
  });

  it("surfaces a failed read instead of treating videos as photos", async () => {
    flags.video = true;
    const db = database({ data: null, error: {} });
    await expect(findVideoAssetIds(db as never, "business-1", ["video-1"])).rejects.toThrow();
  });

  it("does not treat a missing query result as an empty video list", async () => {
    flags.video = true;
    const db = database({ data: null, error: null });
    await expect(findVideoAssetIds(db as never, "business-1", ["video-1"])).rejects.toThrow();
  });
});
