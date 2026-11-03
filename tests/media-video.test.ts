import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readVideo, stripVideoMetadata } from "@/lib/media/mp4";
import { MEDIA_MONTHLY_VIDEOS, MEDIA_VIDEO_MAX_BYTES, mediaFit, videoRefusal, videoTrimSeconds } from "@/lib/media/rules";
import { finalizeUpload, monthStartIst, signUpload, type MediaRow } from "@/lib/media/store";
import { fakeSupabase } from "./helpers/media-fake";

const env = vi.hoisted(() => ({ MEDIA_UPLOADS_ENABLED: true, MEDIA_VIDEO_ENABLED: true }));
vi.mock("@/lib/env", () => ({ getEnv: () => env }));

// #748: real files made with ffmpeg 6: a tall H.264 MP4 (moov first), a wide MOV with AAC and an ISO 6709 location in
// its user data (moov last), the same MOV turned portrait by a 90° matrix (how phones store it), and a 61 s clip.
const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/media/${name}`));
const tall = fixture("tall.mp4"), wideGps = fixture("wide-gps.mov"), rotated = fixture("rotated.mov"), long = fixture("long.mp4"), dataTrack = fixture("data-track.mp4");
const GPS = Buffer.from("077.5946");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const BUSINESS = "11111111-1111-4111-8111-111111111111";
const MB = 1024 * 1024;

describe("video rules (#748, Designer on #744)", () => {
  it("refuses with one fix the owner can do on the phone", () => {
    expect(videoRefusal("video/quicktime", 30 * MB, 59_000)).toBeNull();
    expect(videoRefusal("video/mp4", MEDIA_VIDEO_MAX_BYTES, 60_400)).toBeNull();
    expect(videoRefusal("video/webm", MB, 5_000)).toMatchObject({ status: 415, code: "MEDIA_TYPE" });
    expect(videoRefusal("video/mp4", 82 * MB, 45_000)).toMatchObject({ status: 413, message: "82 MB, limit 50 MB. Trim it to about 25 seconds in your Gallery." });
    expect(videoRefusal("video/mp4", 20 * MB, 61_000)).toMatchObject({ status: 422, code: "MEDIA_TOO_LONG", message: expect.stringContaining("limit 60") });
  });

  it("works out the trim length in 5-second steps, never past the cap, and says so when no trim can fit", () => {
    expect(videoTrimSeconds(45_000, 82 * MB)).toBe(25);
    expect(videoTrimSeconds(300_000, 60 * MB)).toBe(60);
    expect(videoTrimSeconds(15_000, 150 * MB)).toBe(5);
    expect(videoTrimSeconds(10_000, 400 * MB)).toBeNull();
    expect(videoTrimSeconds(2_000, 100 * MB)).toBeNull();
  });

  it("never promises a trim that can't fit: a 2-second 100 MB clip is told to save a smaller copy (CPO, #744)", () => {
    const refusal = videoRefusal("video/mp4", 100 * MB, 2_000);
    expect(refusal).toMatchObject({ status: 413, code: "MEDIA_TOO_LARGE" });
    expect(refusal?.message).toBe("100 MB, limit 50 MB. Trimming won't be enough: save a smaller, lower-resolution copy (for example 720p) in your Gallery.");
    expect(refusal?.message).not.toMatch(/Trim it to/);
  });

  it("judges a video by its shape only: small clips aren't refused, wide is Feed only", () => {
    expect(mediaFit(144, 256, "video")).toMatchObject({ level: "ready" });
    expect(mediaFit(1280, 720, "video")).toMatchObject({ level: "feed", ratio: "16:9" });
    expect(mediaFit(144, 256)).toMatchObject({ level: "too_small" });
  });
});

describe("MP4/MOV reader (#748)", () => {
  it("reads container, length and the size it's shown at, wherever the moov box is", () => {
    expect(readVideo(tall)).toEqual({ mime: "video/mp4", durationMs: 2000, width: 720, height: 1280 });
    expect(readVideo(wideGps)).toEqual({ mime: "video/quicktime", durationMs: 3000, width: 1280, height: 720 });
    expect(readVideo(rotated)).toEqual({ mime: "video/quicktime", durationMs: 3000, width: 720, height: 1280 });
    expect(readVideo(long)).toMatchObject({ durationMs: 61_000 });
  });

  it("refuses what isn't a whole MP4/MOV with a video track", () => {
    expect(readVideo(new Uint8Array(readFileSync("package.json")))).toBeNull();
    expect(readVideo(wideGps.subarray(0, wideGps.length - 2000))).toBeNull();
    expect(readVideo(new Uint8Array(0))).toBeNull();
  });

  it("blanks the location and other user data in place: same size, same video", () => {
    expect(Buffer.from(wideGps).includes(GPS)).toBe(true);
    const clean = stripVideoMetadata(wideGps);
    expect(clean.length).toBe(wideGps.length);
    expect(Buffer.from(clean).includes(GPS)).toBe(false);
    expect(readVideo(clean)).toEqual(readVideo(wideGps));
    expect(readVideo(stripVideoMetadata(rotated))).toEqual(readVideo(rotated));
  });

  it("drops tracks other than picture and sound, samples included (a GPS or metadata stream)", () => {
    const secret = Buffer.from("TRACKSECRET");
    expect(Buffer.from(dataTrack).includes(secret)).toBe(true);
    const clean = Buffer.from(stripVideoMetadata(dataTrack));
    expect(clean.includes(secret)).toBe(false);
    expect(clean.includes(Buffer.from("sbtl"))).toBe(false);
    expect(clean.includes(Buffer.from("soun"))).toBe(true);
    expect(readVideo(clean)).toEqual(readVideo(dataTrack));
  });

  it("survives broken sample tables without reading past the file", () => {
    const broken = Buffer.from(dataTrack);
    const stco = broken.lastIndexOf(Buffer.from("stco"));
    broken.writeUInt32BE(0xffffffff, stco + 8);
    broken.writeUInt32BE(0x7fffffff, stco + 12);
    expect(() => stripVideoMetadata(broken)).not.toThrow();
  });
});

describe("video uploads (#748)", () => {
  let db: ReturnType<typeof fakeSupabase>;
  beforeEach(() => { db = fakeSupabase(); env.MEDIA_VIDEO_ENABLED = true; });
  const sign = (bytes: Uint8Array, extra: Partial<Parameters<typeof signUpload>[1]> = {}) => signUpload(db.client, {
    businessId: BUSINESS, userId: "u", mime: "video/mp4", bytes: bytes.length, sha256: sha(bytes), width: 720, height: 1280,
    durationMs: readVideo(bytes)?.durationMs ?? 1000, rightsConfirmedAt: "2026-11-02T10:00:00.000Z", ...extra,
  });
  async function uploaded(bytes: Uint8Array, extra: Partial<Parameters<typeof signUpload>[1]> = {}) {
    const result = await sign(bytes, extra);
    if (result.duplicate) throw new Error("unexpected duplicate");
    db.objects.set(result.path, bytes);
    return db.tables.media_assets.find((row) => row.id === result.id) as MediaRow;
  }

  it("signs a video row with its length; refusals at sign leave nothing behind and use none of the 3", async () => {
    const result = await sign(tall);
    expect(result).toMatchObject({ duplicate: false, bucket: "media-video" });
    const row = db.tables.media_assets[0] as MediaRow;
    expect(row).toMatchObject({ kind: "video", mime: "video/mp4", duration_ms: 2000, status: "pending" });
    expect(row.path).toMatch(/\.mp4$/);
    await expect(sign(long)).rejects.toMatchObject({ status: 422, code: "MEDIA_TOO_LONG" });
    await expect(sign(tall, { sha256: "a".repeat(64), bytes: 60 * MB })).rejects.toMatchObject({ status: 413 });
    await expect(sign(tall, { sha256: "b".repeat(64), durationMs: undefined })).rejects.toMatchObject({ status: 415 });
    expect(db.tables.media_assets).toHaveLength(1);
  });

  it("treats a video as a wrong photo type while MEDIA_VIDEO_ENABLED is off", async () => {
    env.MEDIA_VIDEO_ENABLED = false;
    await expect(sign(tall)).rejects.toMatchObject({ status: 415, message: "Please choose a JPG, PNG or WebP photo." });
    expect(db.tables.media_assets).toEqual([]);
  });

  it("says uploads are paused when the database's global video budget is full (#2653), leaving no row; photos still work", async () => {
    db.insertErrors.push({ code: "P0001", message: "MEDIA_VIDEO_BUDGET" });
    await expect(sign(tall)).rejects.toMatchObject({ status: 503, code: "MEDIA_VIDEO_PAUSED", message: "Video uploads are paused for a short while. Try again tomorrow or use photos." });
    expect(db.tables.media_assets).toEqual([]);
    const photo = await signUpload(db.client, { businessId: BUSINESS, userId: "u", mime: "image/jpeg", bytes: 1000, sha256: "c".repeat(64), width: 1080, height: 1350, rightsConfirmedAt: "x" });
    expect(photo).toMatchObject({ duplicate: false, bucket: "media" });
  });

  it(`stops at ${MEDIA_MONTHLY_VIDEOS} videos a month, says when more come, and photos still count on their own`, async () => {
    for (let index = 0; index < MEDIA_MONTHLY_VIDEOS; index++) {
      db.tables.media_assets.push({ business_id: BUSINESS, source: "upload", kind: "video", sha256: String(index).padStart(64, "0"), created_at: new Date().toISOString(), deleted_at: null });
    }
    await expect(sign(tall)).rejects.toMatchObject({ status: 429, code: "MEDIA_QUOTA", message: expect.stringMatching(/^You've used 3 of 3 videos this month\. More from 1 [A-Z][a-z]{2}; photos still work\.$/) });
    db.insertErrors.push({ code: "P0001", message: "MEDIA_QUOTA" });
    db.tables.media_assets.length = 0;
    await expect(sign(tall)).rejects.toMatchObject({ status: 429, message: expect.stringContaining("videos this month") });
    const photo = await signUpload(db.client, { businessId: BUSINESS, userId: "u", mime: "image/jpeg", bytes: 1000, sha256: "c".repeat(64), width: 1080, height: 1350, rightsConfirmedAt: "x" });
    expect(photo).toMatchObject({ duplicate: false, bucket: "media" });
    expect(db.storageCalls).toEqual([expect.objectContaining({ op: "sign", bucket: "media" })]);
  });

  it("finalize keeps a checked video as it is, minus its location, at a fresh path", async () => {
    const row = await uploaded(wideGps, { mime: "video/quicktime", width: 1280, height: 720 });
    const uploadPath = row.path;
    const view = await finalizeUpload(db.client, row);
    expect(view).toMatchObject({ kind: "video", durationMs: 3000, width: 1280, height: 720, fit: { level: "feed" } });
    expect(view.url).toContain(".mov");
    const saved = db.tables.media_assets[0] as MediaRow;
    expect(saved).toMatchObject({ status: "ready", mime: "video/quicktime", duration_ms: 3000 });
    const stored = db.objects.get(saved.path)!;
    expect(stored.length).toBe(wideGps.length);
    expect(Buffer.from(stored).includes(GPS)).toBe(false);
    expect(saved.path).not.toBe(uploadPath);
    expect(db.objects.has(uploadPath)).toBe(false);
    // QA 2 on #2735: videos live in their own bucket, so a photo token stays bounded by the 8 MB `media` bucket.
    expect(new Set(db.storageCalls.map((call) => call.bucket))).toEqual(new Set(["media-video"]));
    expect(db.storageCalls.map((call) => call.op)).toEqual(["sign", "upload", "read"]);
  });

  it("finalize reads the real length and type: a browser that lied is refused and the row still counts", async () => {
    const lied = await uploaded(long, { durationMs: 10_000 });
    await expect(finalizeUpload(db.client, lied)).rejects.toMatchObject({ status: 422, code: "MEDIA_TOO_LONG" });
    const notVideo = new Uint8Array(readFileSync("package.json"));
    const fake = await uploaded(notVideo, { durationMs: 5_000 });
    await expect(finalizeUpload(db.client, fake)).rejects.toMatchObject({ status: 415, code: "MEDIA_TYPE" });
    expect(db.tables.media_assets.every((row) => row.deleted_at && row.status === "pending")).toBe(true);
    expect(db.tables.media_assets.every((row) => String(row.created_at) >= monthStartIst())).toBe(true);
  });

  it("a portrait phone clip stored landscape is shown tall and fits Stories and Reels", async () => {
    const row = await uploaded(rotated, { mime: "video/quicktime" });
    await expect(finalizeUpload(db.client, row)).resolves.toMatchObject({ width: 720, height: 1280, fit: { level: "ready" } });
  });
});
