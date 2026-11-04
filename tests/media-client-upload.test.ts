import { describe, expect, it, vi } from "vitest";
import { prepareImage, prepareVideo, scaledSize, uploadPrepared, UploadError, type Codec, type Prepared, type SignedUpload, type VideoReader } from "@/lib/media/client-upload";

const file = (type = "image/jpeg", name = "IMG_2041.jpg") => new File([new Uint8Array([1, 2, 3])], name, { type });
const codec = (width: number, height: number, bytes = 300_000): Codec => vi.fn(async () => ({ blob: new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), width, height }));
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("prepareImage (#778 slice 3b)", () => {
  it("re-encodes to at most 2048 px, hashes the bytes that will be sent, and gives the fit line", async () => {
    const encode = codec(1638, 2048);
    const prepared = await prepareImage(file(), encode);
    expect(encode).toHaveBeenCalledWith(expect.any(File), 2048);
    expect(prepared).toMatchObject({ name: "IMG_2041", width: 1638, height: 2048, bytes: 300_000, fit: { level: "ready", message: "Ready for Feed, Stories and Reels" } });
    expect(prepared.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(scaledSize(4032, 3024)).toEqual({ width: 2048, height: 1536 });
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("refuses a wrong type, an unreadable file, a too-small photo and an oversized one with the CPO's lines", async () => {
    await expect(prepareImage(file("image/heic", "a.heic"), codec(1000, 1000))).rejects.toThrow("This file type can't be used.");
    await expect(prepareImage(file(), vi.fn(async () => { throw new Error("decode"); }))).rejects.toMatchObject({ code: "MEDIA_FORMAT" });
    await expect(prepareImage(file(), codec(480, 640))).rejects.toThrow("Too small (480 px wide). Use the original photo, not a screenshot or a WhatsApp copy.");
    await expect(prepareImage(file(), codec(2048, 2048, 9 * 1024 * 1024))).rejects.toThrow("This file is 9.0 MB; the limit is 8.0 MB.");
  });
});

describe("prepareVideo (#778)", () => {
  const clip = (type = "video/mp4", name = "tour.mp4") => new File(["video"], name, { type });
  const read: VideoReader = async () => ({ width: 720, height: 1280, durationMs: 60_000 });

  it("keeps an MP4 or MOV's bytes, reads its dimensions and duration, and hashes the upload", async () => {
    for (const selected of [clip(), clip("video/quicktime", "tour.mov")]) {
      const prepared = await prepareVideo(selected, read);
      expect(prepared).toMatchObject({
        kind: "video", mime: selected.type, name: "tour", bytes: 5, width: 720, height: 1280, durationMs: 60_000,
        fit: { level: "ready", ratio: "9:16" },
      });
      expect(prepared.blob).toBe(selected);
      expect(prepared.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("estimates a useful trim for an oversized video before signing", async () => {
    const tooBig = clip();
    Object.defineProperty(tooBig, "size", { value: 100 * 1024 * 1024 });
    const reader = vi.fn(read);
    await expect(prepareVideo(tooBig, reader)).rejects.toMatchObject({
      code: "MEDIA_TOO_LARGE",
      words: { key: "upload.videoTooBigTrim", values: { size: "100 MB", max: "50 MB", seconds: 30 } },
    });
    expect(reader).toHaveBeenCalledOnce();
  });

  it("suggests a smaller export when a trim cannot fit or its metadata is unreadable", async () => {
    const tooBig = clip();
    Object.defineProperty(tooBig, "size", { value: 100 * 1024 * 1024 });
    for (const reader of [
      async () => ({ width: 720, height: 1280, durationMs: 2000 }),
      async () => { throw new Error("unreadable"); },
    ]) {
      await expect(prepareVideo(tooBig, reader)).rejects.toMatchObject({
        code: "MEDIA_TOO_LARGE",
        words: { key: "upload.videoTooBig", values: { size: "100 MB", max: "50 MB" } },
      });
    }
  });

  it("accepts exactly 60 seconds but refuses a longer video before upload", async () => {
    await expect(prepareVideo(clip(), read)).resolves.toMatchObject({ durationMs: 60_000 });
    await expect(prepareVideo(clip(), async () => ({ width: 720, height: 1280, durationMs: 60_001 })))
      .rejects.toMatchObject({ code: "MEDIA_TOO_LONG", words: { key: "upload.videoTooLong", values: { max: 60 } } });
  });

  it("accepts exactly 50 MiB and refuses one byte over the limit", async () => {
    const atLimit = clip();
    const overLimit = clip();
    Object.defineProperty(atLimit, "size", { value: 50 * 1024 * 1024 });
    Object.defineProperty(overLimit, "size", { value: 50 * 1024 * 1024 + 1 });
    await expect(prepareVideo(atLimit, read)).resolves.toMatchObject({ bytes: 50 * 1024 * 1024 });
    await expect(prepareVideo(overLimit, read)).rejects.toMatchObject({ code: "MEDIA_TOO_LARGE" });
  });

  it("refuses unsupported and unreadable videos before upload", async () => {
    const reader = vi.fn(read);
    await expect(prepareVideo(clip("video/webm", "tour.webm"), reader)).rejects.toMatchObject({ code: "MEDIA_FORMAT" });
    expect(reader).not.toHaveBeenCalled();
    await expect(prepareVideo(clip(), async () => ({ width: 0, height: 1280, durationMs: Infinity })))
      .rejects.toMatchObject({ code: "MEDIA_FORMAT" });
    await expect(prepareVideo(clip(), async () => { throw new Error("unreadable"); }))
      .rejects.toMatchObject({ code: "MEDIA_FORMAT" });
  });
});

describe("uploadPrepared (#778 slice 3b)", () => {
  const prepared: Prepared = { kind: "image", mime: "image/jpeg", name: "Kitchen", blob: new Blob(["x"], { type: "image/jpeg" }), bytes: 1, width: 1080, height: 1350, sha256: "a".repeat(64), fit: { level: "ready", ratio: "4:5", message: "" } };
  const video: Prepared = { kind: "video", mime: "video/quicktime", name: "Tour", blob: new Blob(["v"], { type: "video/quicktime" }), bytes: 1, width: 720, height: 1280, durationMs: 2000, sha256: "b".repeat(64), fit: { level: "ready", ratio: "9:16", message: "" } };
  const asset = { id: "m1", kind: "image", name: "Kitchen", tags: [], width: 1080, height: 1350, bytes: 1, durationMs: null, fit: prepared.fit, url: "https://example.com/kitchen.jpg", createdAt: "2026-11-03T08:00:00Z" };

  it("signs, uploads the bytes straight to Storage, then finalizes", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json(200, { ok: true, duplicate: false, id: "m1", bucket: "media", path: "b1/m1.jpg", token: "t" }))
      .mockResolvedValueOnce(json(200, { ok: true, asset }));
    const uploadToSignedUrl = vi.fn(async () => ({ error: null }));
    await expect(uploadPrepared("b1", prepared, { fetch, uploadToSignedUrl })).resolves.toEqual({ status: "added", asset });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ businessId: "b1", mime: "image/jpeg", bytes: 1, sha256: "a".repeat(64), width: 1080, height: 1350, name: "Kitchen" });
    expect(uploadToSignedUrl).toHaveBeenCalledWith("media", "b1/m1.jpg", "t", prepared.blob, "image/jpeg");
    expect(fetch.mock.calls[1][0]).toBe("/api/media/finalize");
  });

  it("sends a video's actual MIME and duration, and uploads to the signed video bucket", async () => {
    const videoAsset = { ...asset, id: "m2", kind: "video", durationMs: 2000 };
    const fetch = vi.fn()
      .mockResolvedValueOnce(json(200, { ok: true, duplicate: false, id: "m2", bucket: "media-video", path: "b1/m2.mov", token: "t" }))
      .mockResolvedValueOnce(json(200, { ok: true, asset: videoAsset }));
    const uploadToSignedUrl = vi.fn(async () => ({ error: null }));
    await expect(uploadPrepared("b1", video, { fetch, uploadToSignedUrl })).resolves.toEqual({ status: "added", asset: videoAsset });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ businessId: "b1", mime: "video/quicktime", bytes: 1, sha256: "b".repeat(64), width: 720, height: 1280, durationMs: 2000, name: "Tour" });
    expect(uploadToSignedUrl).toHaveBeenCalledWith("media-video", "b1/m2.mov", "t", video.blob, "video/quicktime");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ id: "m2" });
  });

  it("allows finalization longer than the server's 60-second execution limit", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      const fetch = vi.fn()
        .mockResolvedValueOnce(json(200, { ok: true, duplicate: false, id: "m1", bucket: "media", path: "p", token: "t" }))
        .mockResolvedValueOnce(json(200, { ok: true, asset }));
      await uploadPrepared("b1", prepared, { fetch, uploadToSignedUrl: vi.fn(async () => ({ error: null })) });
      expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([30_000, expect.any(Number)]);
      expect(timeout.mock.calls[1][0]).toBeGreaterThan(60_000);
    } finally {
      timeout.mockRestore();
    }
  });

  it("reports a signed video before its Storage transfer finishes", async () => {
    let finish!: (value: { error: null }) => void;
    const fetch = vi.fn()
      .mockResolvedValueOnce(json(200, { ok: true, duplicate: false, id: "m2", bucket: "media-video", path: "b1/m2.mov", token: "t" }))
      .mockResolvedValueOnce(json(200, { ok: true, asset: { ...asset, id: "m2", kind: "video", durationMs: 2000 } }));
    const uploadToSignedUrl = vi.fn(() => new Promise<{ error: null }>((resolve) => { finish = resolve; }));
    const onSigned = vi.fn();
    const pending = uploadPrepared("b1", video, { fetch, uploadToSignedUrl }, { onSigned });
    await vi.waitFor(() => expect(uploadToSignedUrl).toHaveBeenCalledOnce());
    expect(onSigned).toHaveBeenCalledOnce();
    finish({ error: null });
    await expect(pending).resolves.toMatchObject({ status: "added" });
  });

  it("refuses a malformed or wrong-bucket sign response without sending the file", async () => {
    for (const signed of [
      { ok: true, duplicate: false, id: "m2", bucket: "media", path: "b1/m2.mov", token: "t" },
      { ok: true, duplicate: false, id: "m2", bucket: "media-video", token: "t" },
    ]) {
      const fetch = vi.fn()
        .mockResolvedValueOnce(json(200, signed))
        .mockResolvedValueOnce(json(200, { ok: true, asset }));
      const uploadToSignedUrl = vi.fn(async () => ({ error: null }));
      await expect(uploadPrepared("b1", video, { fetch, uploadToSignedUrl })).rejects.toMatchObject({ code: "MEDIA_UNAVAILABLE" });
      expect(uploadToSignedUrl).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["MEDIA_QUOTA", "upload.videoQuotaReached"],
    ["MEDIA_TOO_LARGE", "upload.videoRejectedLarge"],
    ["MEDIA_TOO_LONG", "upload.videoTooLong"],
    ["MEDIA_TYPE", "upload.videoFormat"],
    ["MEDIA_RIGHTS_REQUIRED", "upload.rightsRequiredMedia"],
  ])("turns video %s into localized actionable copy", async (code, key) => {
    const fetch = vi.fn().mockResolvedValueOnce(json(422, { ok: false, code, error: "Untranslated server text" }));
    const uploadToSignedUrl = vi.fn();
    await expect(uploadPrepared("b1", video, { fetch, uploadToSignedUrl })).rejects.toMatchObject({ code, words: { key } });
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it("a duplicate reuses the saved copy without sending bytes", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(200, { ok: true, duplicate: true, asset }));
    const uploadToSignedUrl = vi.fn();
    await expect(uploadPrepared("b1", prepared, { fetch, uploadToSignedUrl })).resolves.toEqual({ status: "duplicate", asset });
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it("does not report success when the sign or finalize response omits the saved asset", async () => {
    const uploadToSignedUrl = vi.fn(async () => ({ error: null }));
    const duplicate = vi.fn().mockResolvedValueOnce(json(200, { ok: true, duplicate: true }));
    await expect(uploadPrepared("b1", prepared, { fetch: duplicate, uploadToSignedUrl })).rejects.toMatchObject({ code: "MEDIA_UNAVAILABLE" });
    expect(uploadToSignedUrl).not.toHaveBeenCalled();

    const finalized = vi.fn()
      .mockResolvedValueOnce(json(200, { ok: true, duplicate: false, id: "m1", bucket: "media", path: "p", token: "t" }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    await expect(uploadPrepared("b1", prepared, { fetch: finalized, uploadToSignedUrl })).rejects.toMatchObject({ code: "MEDIA_UNAVAILABLE" });
  });

  it("maps failures: rights not ticked, the server's own reason, a crash and a dropped connection", async () => {
    const run = (response: Response | Error, upload: SignedUpload = vi.fn(async () => ({ error: null }))) =>
      uploadPrepared("b1", prepared, { fetch: vi.fn(async () => { if (response instanceof Error) throw response; return response; }), uploadToSignedUrl: upload });
    await expect(run(json(409, { code: "MEDIA_RIGHTS_REQUIRED", error: "x" }))).rejects.toMatchObject({ code: "MEDIA_RIGHTS_REQUIRED", message: "Tick the box above to add your photos." });
    await expect(run(json(429, { code: "MEDIA_MONTHLY_LIMIT", error: "You've added 50 photos this month." }))).rejects.toThrow("You've added 50 photos this month.");
    await expect(run(json(503, { error: "stack trace" }))).rejects.toThrow("This didn't upload. Check your connection and tap Try again.");
    await expect(run(new TypeError("offline"))).rejects.toBeInstanceOf(UploadError);
    const storageDown = vi.fn(async () => ({ error: new Error("storage") }));
    await expect(run(json(200, { ok: true, duplicate: false, id: "m1", bucket: "media", path: "p", token: "t" }), storageDown)).rejects.toMatchObject({ code: "MEDIA_NETWORK" });
  });
});
