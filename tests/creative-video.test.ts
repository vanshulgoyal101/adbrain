import { describe, expect, it } from "vitest";
import { readCreativeVideos, type PreflightVideo } from "@/lib/campaign/creative-video";
import { buildCreativeReviewPayload } from "@/lib/campaign/preflight";
import { creativesBlockerMessage } from "@/lib/campaign/review-blocker-words";
import { translator } from "@/i18n/locale";
import type { MediaAsset, MetaUploadRow } from "@/services/meta-media";

// #781: Go live waits for an owner's video to be ready at Meta; launch then only runs on ready ads.
const businessId = "816aaafb-7ebc-4ad7-bbda-001beff172f8";
const upload = (patch: Partial<MetaUploadRow>): MetaUploadRow => ({
  id: "u1", businessId, mediaAssetId: "m1", adAccountId: "act_1", kind: "video", attempt: 1, uploadName: "n", imageHash: null, videoId: null,
  status: "processing", problem: null, width: null, height: null, lengthMs: null, instagramEligible: null, claimedAt: "2026-11-03T00:00:00Z", checkedAt: null, ...patch,
});
const store = (kind: MediaAsset["kind"], row: MetaUploadRow | null) => ({
  asset: async (_: string, id: string) => ({ id, businessId, kind, status: "ready", deletedAt: null, path: "p" }) satisfies MediaAsset,
  upload: async () => row,
});
const read = (kind: MediaAsset["kind"], row: MetaUploadRow | null, mediaAssetId: string | null = "m1") =>
  readCreativeVideos(store(kind, row), businessId, "act_1", [{ creativeId: "c1", mediaAssetId }]);

describe("readCreativeVideos (#781)", () => {
  it("a photo, or an ad without media, is not a video", async () => {
    expect((await read("image", null)).size).toBe(0);
    expect((await read("video", null, null)).size).toBe(0);
  });
  it("a video not yet sent, starting or processing is processing", async () => {
    for (const row of [null, upload({ status: "starting" }), upload({ status: "processing" })]) expect((await read("video", row)).get("c1")).toEqual({ state: "processing", reason: null, assetId: "m1" });
  });
  it("ready needs the Meta video id", async () => {
    expect((await read("video", upload({ status: "ready", videoId: "v1" }))).get("c1")?.state).toBe("ready");
    expect((await read("video", upload({ status: "ready" }))).get("c1")?.state).toBe("processing");
  });
  it("a video with no ad account to launch in waits, never goes as a picture", async () => {
    const videos = await readCreativeVideos(store("video", upload({ status: "ready", videoId: "v1" })), businessId, undefined, [{ creativeId: "c1", mediaAssetId: "m1" }]);
    expect(videos.get("c1")?.state).toBe("processing");
  });
  it("an error carries Meta's reason in plain words", async () => {
    expect((await read("video", upload({ status: "error", problem: "format" }))).get("c1")).toEqual({ state: "error", assetId: "m1", reason: expect.stringContaining("MP4 or MOV") });
  });
});

describe("fail closed on linked media (#781)", () => {
  const gone = [{ id: "m1", businessId, kind: "video", status: "ready", deletedAt: "2026-11-03T00:00:00Z", path: "p" }, { id: "m1", businessId, kind: "video", status: "pending", deletedAt: null, path: "p" }, null];
  it("a deleted, not-ready or missing file is an error, never the poster", async () => {
    for (const asset of gone) {
      const videos = await readCreativeVideos({ asset: async () => asset as MediaAsset | null, upload: async () => upload({ status: "ready", videoId: "v1" }) }, businessId, "act_1", [{ creativeId: "c1", mediaAssetId: "m1" }]);
      expect(videos.get("c1")?.state).toBe("error");
    }
  });
});

describe("Review binds the video (#781)", () => {
  const base = { id: "c1", businessId, approved: true, imageUrl: "https://example.com/p.jpg", headline: "Tour" };
  const hash = (assetId: string, videoId: string) => JSON.stringify(buildCreativeReviewPayload([{ ...base, video: { state: "ready", reason: null, assetId, videoId } }]));
  it("a swapped video changes the review, a photo keeps its old shape", () => {
    expect(hash("a", "v1")).not.toBe(hash("b", "v2"));
    expect(hash("a", "v1")).not.toBe(hash("a", "v2"));
    expect(JSON.stringify(buildCreativeReviewPayload([base]))).not.toContain("video");
  });
});

describe("Go live with a video (#781)", () => {
  const say = translator("en", "review");
  const ad = (video?: PreflightVideo) => [{ id: "c1", businessId, approved: true, imageUrl: "https://example.com/poster.jpg", headline: "Tour", video }];
  const blocker = (video?: Parameters<typeof ad>[0]) => creativesBlockerMessage({ businessId, creativeIds: ["c1"] }, ad(video), say);

  it("photos and ready videos pass", () => {
    expect(blocker()).toBeNull();
    expect(blocker({ state: "ready", reason: null })).toBeNull();
  });
  it("a video can't go to a website yet, said before Go live", () => {
    const words = creativesBlockerMessage({ businessId, creativeIds: ["c1"], destination: "website" }, ad({ state: "ready", reason: null, assetId: "m1", videoId: "v1" }), say)!;
    expect(words).toContain("can't go to a website");
  });
  it("a processing video blocks with the wait words", () => {
    expect(blocker({ state: "processing", reason: null })).toContain("still being prepared by Facebook");
  });
  it("a failed video blocks with its reason and what to do", () => {
    const words = blocker({ state: "error", reason: "Meta couldn't use this video file. Try another video." })!;
    expect(words).toContain("Meta couldn't use this video file");
    expect(words).toContain("Take it out of this campaign");
  });
});
