import { expect, it } from "vitest";
import { findAdVideoByName, startAdVideo, type MetaGraph } from "@/lib/meta/media";
import {
  ensureMetaMedia, type MediaAsset, type MetaMediaStore, type MetaUploadRow,
} from "@/services/meta-media";

it("does not upload a second video when an older page precedes the lost upload (#749)", async () => {
  const asset: MediaAsset = {
    id: "44444444-4444-4444-8444-444444444444",
    businessId: "11111111-1111-4111-8111-111111111111",
    kind: "video", status: "ready", deletedAt: null, path: "business/clip.mp4",
  };
  const account = "act_9000000000000001";
  let row: MetaUploadRow = {
    id: "claim", businessId: asset.businessId, mediaAssetId: asset.id, adAccountId: account,
    kind: "video", attempt: 1, uploadName: "lost-upload", imageHash: null, videoId: null,
    status: "starting", problem: null, width: null, height: null, lengthMs: null,
    instagramEligible: null, claimedAt: "2026-10-29T07:00:00Z", checkedAt: null,
  };
  const store: MetaMediaStore = {
    asset: async () => asset,
    upload: async () => ({ ...row }),
    insert: async () => { throw new Error("The claim already exists."); },
    update: async (id, expected, patch) => {
      if (id !== row.id || expected.status !== row.status || expected.attempt !== row.attempt) return null;
      row = { ...row, ...patch };
      return { ...row };
    },
  };
  let posts = 0;
  const graph: MetaGraph = async <T,>(path: string, opts: { method?: string } = {}) => {
    if (opts.method === "POST") {
      posts += 1;
      return { id: "9000000000000003" } as T;
    }
    if (path.endsWith("&after=second")) {
      return {
        data: [{ id: "9000000000000002", title: "lost-upload", created_time: "2026-10-29T07:00:01+0000" }],
      } as T;
    }
    return {
      data: [{ id: "9000000000000004", title: "older-video", created_time: "2026-01-04T11:53:00+0000" }],
      paging: { cursors: { after: "second" }, next: "https://graph.facebook.com/next" },
    } as T;
  };

  const result = await ensureMetaMedia({
    store,
    meta: {
      adAccountId: account,
      uploadImage: async () => { throw new Error("Not an image."); },
      startVideo: (input) => startAdVideo(graph, account, input),
      findVideoByName: (name, since) => findAdVideoByName(graph, account, name, since),
      readVideo: async () => ({
        status: "processing", width: null, height: null, lengthSeconds: null,
        instagramEligible: null, thumbnailUrl: null,
      }),
    },
    readBytes: async () => { throw new Error("Videos use signed URLs."); },
    signedUrl: async () => "https://storage.example/clip.mp4",
    now: () => new Date("2026-10-29T07:10:00Z"),
  }, { businessId: asset.businessId, assetId: asset.id });

  expect(posts, "A still-unsettled listing cannot authorize another advideos POST.").toBe(0);
  expect(result).toEqual({ status: "processing", kind: "video", videoId: "9000000000000002" });
  expect(row.attempt).toBe(1);
});
