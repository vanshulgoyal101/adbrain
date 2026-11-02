import { describe, expect, it, vi } from "vitest";
import { prepareImage, scaledSize, uploadPrepared, UploadError, type Codec, type Prepared, type SignedUpload } from "@/lib/media/client-upload";

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

describe("uploadPrepared (#778 slice 3b)", () => {
  const prepared: Prepared = { name: "Kitchen", blob: new Blob(["x"]), bytes: 1, width: 1080, height: 1350, sha256: "a".repeat(64), fit: { level: "ready", ratio: "4:5", message: "" } };
  const asset = { id: "m1" };

  it("signs, uploads the bytes straight to Storage, then finalizes", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json(200, { ok: true, duplicate: false, id: "m1", path: "b1/m1.jpg", token: "t" }))
      .mockResolvedValueOnce(json(200, { ok: true, asset }));
    const uploadToSignedUrl = vi.fn(async () => ({ error: null }));
    await expect(uploadPrepared("b1", prepared, { fetch, uploadToSignedUrl })).resolves.toEqual({ status: "added", asset });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ businessId: "b1", mime: "image/jpeg", bytes: 1, sha256: "a".repeat(64), width: 1080, height: 1350, name: "Kitchen" });
    expect(uploadToSignedUrl).toHaveBeenCalledWith("b1/m1.jpg", "t", prepared.blob);
    expect(fetch.mock.calls[1][0]).toBe("/api/media/finalize");
  });

  it("a duplicate reuses the saved copy without sending bytes", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(200, { ok: true, duplicate: true, asset }));
    const uploadToSignedUrl = vi.fn();
    await expect(uploadPrepared("b1", prepared, { fetch, uploadToSignedUrl })).resolves.toEqual({ status: "duplicate", asset });
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it("maps failures: rights not ticked, the server's own reason, a crash and a dropped connection", async () => {
    const run = (response: Response | Error, upload: SignedUpload = vi.fn(async () => ({ error: null }))) =>
      uploadPrepared("b1", prepared, { fetch: vi.fn(async () => { if (response instanceof Error) throw response; return response; }), uploadToSignedUrl: upload });
    await expect(run(json(409, { code: "MEDIA_RIGHTS_REQUIRED", error: "x" }))).rejects.toMatchObject({ code: "MEDIA_RIGHTS_REQUIRED", message: "Tick the box above to add your photos." });
    await expect(run(json(429, { code: "MEDIA_MONTHLY_LIMIT", error: "You've added 50 photos this month." }))).rejects.toThrow("You've added 50 photos this month.");
    await expect(run(json(503, { error: "stack trace" }))).rejects.toThrow("This didn't upload. Check your connection and tap Try again.");
    await expect(run(new TypeError("offline"))).rejects.toBeInstanceOf(UploadError);
    const storageDown = vi.fn(async () => ({ error: new Error("storage") }));
    await expect(run(json(200, { duplicate: false, id: "m1", path: "p", token: "t" }), storageDown)).rejects.toMatchObject({ code: "MEDIA_NETWORK" });
  });
});
