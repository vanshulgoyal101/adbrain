import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readVideo, stripVideoMetadata } from "@/lib/media/mp4";
import { finalizeUpload, signUpload, type MediaRow } from "@/lib/media/store";
import { fakeSupabase } from "./helpers/media-fake";

vi.mock("@/lib/env", () => ({ getEnv: () => ({ MEDIA_UPLOADS_ENABLED: true, MEDIA_VIDEO_ENABLED: true }) }));

const source = readFileSync("tests/fixtures/media/data-track.mp4");
const wide = readFileSync("tests/fixtures/media/wide-gps.mov");
const businessId = "11111111-1111-4111-8111-111111111111";

function modified(change: (bytes: Buffer) => void): Buffer {
  const bytes = Buffer.from(source);
  change(bytes);
  return bytes;
}

function lastBox(bytes: Buffer, name: string): number {
  const offset = bytes.lastIndexOf(Buffer.from(name));
  if (offset < 0) throw new Error(`Missing ${name} fixture box`);
  return offset;
}

const compact = () => modified((bytes) => {
  const stsz = lastBox(bytes, "stsz");
  bytes.write("stz2", stsz, "ascii");
  bytes.writeUInt32BE(8, stsz + 8);
  bytes.writeUInt8(31, stsz + 16);
  bytes.writeUInt8(2, stsz + 17);
});

function malformedSeiLength(): Buffer {
  const bytes = Buffer.from(source);
  const marker = Buffer.from("x264 - core");
  const markerOffset = bytes.indexOf(marker);
  for (let offset = markerOffset - 5; offset >= 0; offset--) {
    const length = bytes.readUInt32BE(offset);
    const payload = offset + 4;
    if (length > 0 && payload + length <= bytes.length && payload <= markerOffset
      && markerOffset + marker.length <= payload + length && (bytes[payload] & 0x1f) === 6) {
      bytes.writeUInt32BE(0x7fffffff, offset);
      return bytes;
    }
  }
  throw new Error("Missing length-prefixed SEI fixture");
}

function wideOffsets(): Buffer {
  const start = lastBox(source, "stco") - 4;
  const oldSize = source.readUInt32BE(start);
  const count = source.readUInt32BE(start + 12);
  const replacement = Buffer.alloc(16 + count * 8);
  replacement.writeUInt32BE(replacement.length, 0);
  replacement.write("co64", 4, "ascii");
  replacement.writeUInt32BE(count, 12);
  for (let i = 0; i < count; i++) replacement.writeBigUInt64BE(BigInt(source.readUInt32BE(start + 16 + i * 4)), 16 + i * 8);
  const bytes = Buffer.concat([source.subarray(0, start), replacement, source.subarray(start + oldSize)]);
  const growth = replacement.length - oldSize;
  for (const name of ["stbl", "minf", "mdia", "trak", "moov"]) {
    const offset = source.lastIndexOf(Buffer.from(name), start) - 4;
    if (offset < 0) throw new Error(`Missing parent ${name}`);
    bytes.writeUInt32BE(source.readUInt32BE(offset) + growth, offset);
  }
  return bytes;
}

function nestedEdits(depth: number): Buffer {
  const nested = Buffer.alloc(depth * 8);
  for (let index = 0; index < depth; index++) {
    nested.writeUInt32BE((depth - index) * 8, index * 8);
    nested.write("edts", index * 8 + 4, "ascii");
  }
  const bytes = Buffer.concat([source, nested]);
  const moov = source.indexOf("moov") - 4;
  bytes.writeUInt32BE(source.readUInt32BE(moov) + nested.length, moov);
  return bytes;
}

function sampleExtension(track: number, type: string, marker: Buffer): Buffer {
  let stsd = -1;
  for (let index = 0; index <= track; index++) stsd = source.indexOf("stsd", stsd + 1);
  if (stsd < 0) throw new Error("Missing sample description");
  const entry = stsd + 12;
  const end = entry + source.readUInt32BE(entry);
  const extension = Buffer.alloc(8 + (type === "uuid" ? 16 : 0) + marker.length);
  extension.writeUInt32BE(extension.length, 0);
  extension.write(type, 4, "ascii");
  marker.copy(extension, extension.length - marker.length);
  const bytes = Buffer.concat([source.subarray(0, end), extension, source.subarray(end)]);
  const ancestors = [entry, stsd - 4];
  for (const name of ["stbl", "minf", "mdia", "trak", "moov"]) {
    const offset = source.lastIndexOf(Buffer.from(name), entry) - 4;
    if (offset < 0) throw new Error(`Missing parent ${name}`);
    ancestors.push(offset);
  }
  for (const offset of ancestors) bytes.writeUInt32BE(source.readUInt32BE(offset) + extension.length, offset);
  return bytes;
}

function extraTableBytes(type: string, extra: Buffer): Buffer {
  const start = source.indexOf(type) - 4;
  if (start < 0) throw new Error(`Missing ${type} fixture box`);
  const end = start + source.readUInt32BE(start);
  const bytes = Buffer.concat([source.subarray(0, end), extra, source.subarray(end)]);
  const ancestors = [start];
  for (const name of ["stbl", "minf", "mdia", "trak", "moov"]) {
    const offset = source.lastIndexOf(Buffer.from(name), start) - 4;
    if (offset < 0) throw new Error(`Missing parent ${name}`);
    ancestors.push(offset);
  }
  for (const offset of ancestors) bytes.writeUInt32BE(source.readUInt32BE(offset) + extra.length, offset);
  return bytes;
}

function replaceLastTable(bytes: Buffer, type: string, replacement: Buffer): Buffer {
  const start = lastBox(bytes, type) - 4;
  const oldSize = bytes.readUInt32BE(start);
  const out = Buffer.concat([bytes.subarray(0, start), replacement, bytes.subarray(start + oldSize)]);
  const growth = replacement.length - oldSize;
  for (const name of ["stbl", "minf", "mdia", "trak", "moov"]) {
    const offset = bytes.lastIndexOf(Buffer.from(name), start) - 4;
    if (offset < 0) throw new Error(`Missing parent ${name}`);
    out.writeUInt32BE(bytes.readUInt32BE(offset) + growth, offset);
  }
  return out;
}

function firstTwoCounts(type: string, countOffset: number): number {
  const first = source.indexOf(type);
  const second = source.indexOf(type, first + 1);
  if (first < 0 || second < 0) throw new Error(`Missing ${type} fixture tables`);
  return source.readUInt32BE(first + countOffset) + source.readUInt32BE(second + countOffset);
}

function zeroSizedMetadata(samples: number, chunks: number): Buffer {
  if (samples % chunks) throw new Error("Samples must divide evenly into chunks");
  const stsz = Buffer.alloc(20 + samples * 4);
  stsz.writeUInt32BE(stsz.length, 0);
  stsz.write("stsz", 4, "ascii");
  stsz.writeUInt32BE(samples, 16);
  let bytes = replaceLastTable(source, "stsz", stsz);
  const stsc = lastBox(bytes, "stsc");
  if (bytes.readUInt32BE(stsc + 8) !== 1) throw new Error("Expected one metadata chunk run");
  bytes.writeUInt32BE(samples / chunks, stsc + 16);
  if (chunks !== 2) {
    const offset = source.readUInt32BE(lastBox(source, "stco") + 12);
    const stco = Buffer.alloc(16 + chunks * 4);
    stco.writeUInt32BE(stco.length, 0);
    stco.write("stco", 4, "ascii");
    stco.writeUInt32BE(chunks, 12);
    for (let index = 0; index < chunks; index++) stco.writeUInt32BE(offset, 16 + index * 4);
    bytes = replaceLastTable(bytes, "stco", stco);
  }
  return bytes;
}

const unsafe: Array<[string, () => Buffer]> = [
  ["compact sample sizes", compact],
  ["missing sample sizes", () => modified((bytes) => bytes.write("xxxx", lastBox(bytes, "stsz"), "ascii"))],
  ["truncated sample sizes", () => modified((bytes) => bytes.writeUInt32BE(3, lastBox(bytes, "stsz") + 12))],
  ["missing chunk runs", () => modified((bytes) => bytes.write("xxxx", lastBox(bytes, "stsc"), "ascii"))],
  ["invalid first chunk", () => modified((bytes) => bytes.writeUInt32BE(0, lastBox(bytes, "stsc") + 12))],
  ["missing chunk coverage", () => modified((bytes) => bytes.writeUInt32BE(0, lastBox(bytes, "stsc") + 16))],
  ["out-of-file offset", () => modified((bytes) => bytes.writeUInt32BE(0xffffffff, lastBox(bytes, "stco") + 12))],
  ["overlapping media and metadata chunks", () => modified((bytes) => bytes.writeUInt32BE(bytes.readUInt32BE(bytes.indexOf("stco") + 12), lastBox(bytes, "stco") + 12))],
  ["external data reference", () => modified((bytes) => bytes.writeUInt32BE(0, lastBox(bytes, "url ") + 4))],
  ["truncated box", () => modified((bytes) => bytes.writeUInt32BE(0x7fffffff, lastBox(bytes, "stsz") - 4))],
  ["fragmented media", () => Buffer.concat([source, Buffer.from([0, 0, 0, 8, 0x6d, 0x6f, 0x6f, 0x66])])],
  ["unknown top-level box", () => Buffer.concat([source, Buffer.from([0, 0, 0, 12, 0x7a, 0x7a, 0x7a, 0x7a, 1, 2, 3, 4])])],
  ["unknown movie metadata", () => {
    const bytes = Buffer.from(wide);
    bytes.write("zzzz", lastBox(bytes, "udta"), "ascii");
    return bytes;
  }],
  ["unknown video codec", () => modified((bytes) => bytes.write("zzzz", bytes.indexOf("avc1", bytes.indexOf("stsd")), "ascii"))],
  ["unknown sample extension", () => sampleExtension(0, "zzzz", Buffer.from("PRIVATE"))],
  ["invalid sample extension payload", () => sampleExtension(0, "pasp", Buffer.from("PRIVATE"))],
  ["unparsed sample-table bytes", () => extraTableBytes("stts", Buffer.from("TABLE-PRIVATE"))],
  ["excessive box nesting", () => nestedEdits(10_000)],
];

describe("video metadata sanitation", () => {
  it.each(unsafe)("refuses %s instead of returning bytes that may retain metadata", (_name, make) => {
    const bytes = make();
    expect(readVideo(bytes)).toBeNull();
    expect(() => stripVideoMetadata(bytes)).toThrow();
  });

  it("clears unreferenced bytes in mdat as well as a non-media track's samples", () => {
    const mdat = source.indexOf(Buffer.from("mdat")) - 4;
    const end = mdat + source.readUInt32BE(mdat);
    const marker = Buffer.from("UNREFERENCED-PRIVATE-MARKER");
    const bytes = Buffer.concat([source.subarray(0, end), marker, source.subarray(end)]);
    bytes.writeUInt32BE(source.readUInt32BE(mdat) + marker.length, mdat);
    expect(readVideo(bytes)).toEqual(readVideo(source));
    const clean = Buffer.from(stripVideoMetadata(bytes));
    expect(clean.includes(marker)).toBe(false);
    expect(clean.includes(Buffer.from("TRACKSECRET"))).toBe(false);
    expect(readVideo(clean)).toEqual(readVideo(source));
  });

  it("keeps supported 64-bit chunk offsets and removes the metadata samples", () => {
    const bytes = wideOffsets();
    expect(readVideo(bytes)).toEqual(readVideo(source));
    const clean = Buffer.from(stripVideoMetadata(bytes));
    expect(clean.includes(Buffer.from("TRACKSECRET"))).toBe(false);
    expect(readVideo(clean)).toEqual(readVideo(source));
  });

  it("counts zero-length metadata samples against the aggregate sample limit", () => {
    const remaining = 1_000_000 - firstTwoCounts("stsz", 12);
    const atLimit = zeroSizedMetadata(remaining, 2);
    const overLimit = zeroSizedMetadata(remaining + 2, 2);
    expect(readVideo(atLimit)).toEqual(readVideo(source));
    expect(readVideo(overLimit)).toBeNull();
    expect(() => stripVideoMetadata(overLimit)).toThrow();
  });

  it("counts zero-length metadata chunks against the aggregate chunk limit", () => {
    const remaining = 100_000 - firstTwoCounts("stco", 8);
    const atLimit = zeroSizedMetadata(remaining, remaining);
    const overLimit = zeroSizedMetadata(remaining + 1, remaining + 1);
    expect(readVideo(atLimit)).toEqual(readVideo(source));
    expect(readVideo(overLimit)).toBeNull();
    expect(() => stripVideoMetadata(overLimit)).toThrow();
  });

  it("does not mutate the caller's buffer while sanitizing", () => {
    const bytes = Buffer.from(source);
    const original = Buffer.from(bytes);
    const clean = stripVideoMetadata(bytes);
    expect(bytes.equals(original)).toBe(true);
    expect(Buffer.from(clean).includes(Buffer.from("TRACKSECRET"))).toBe(false);
  });

  it("clears a video sample entry's free-form compressor name", () => {
    const bytes = Buffer.from(source);
    const entry = bytes.indexOf("stsd") + 12;
    const name = entry + 8 + 42;
    const marker = Buffer.from("CAMERA-PRIVATE");
    bytes.writeUInt8(marker.length, name);
    marker.copy(bytes, name + 1);
    expect(readVideo(bytes)).toEqual(readVideo(source));
    const clean = Buffer.from(stripVideoMetadata(bytes));
    expect(clean.includes(marker)).toBe(false);
    expect(readVideo(clean)).toEqual(readVideo(source));
  });

  it("clears handler names and movie, track and media creation times", () => {
    const bytes = Buffer.from(source);
    const handler = bytes.indexOf("hdlr");
    const marker = Buffer.from("PRIVATE");
    marker.copy(bytes, handler + 4 + 24);
    const headers = ["mvhd", "tkhd", "mdhd"].map((name) => {
      const start = bytes.indexOf(name) + 4;
      bytes.writeUInt32BE(0x12345678, start + 4);
      bytes.writeUInt32BE(0x87654321, start + 8);
      return start;
    });
    expect(readVideo(bytes)).toEqual(readVideo(source));
    const clean = Buffer.from(stripVideoMetadata(bytes));
    expect(clean.includes(marker)).toBe(false);
    for (const start of headers) expect(clean.subarray(start + 4, start + 12)).toEqual(Buffer.alloc(8));
    expect(readVideo(clean)).toEqual(readVideo(source));
  });

  it.each([["video", 0], ["audio", 1]])("clears private boxes inside a %s sample entry", (_kind, track) => {
    const marker = Buffer.from("NESTED-PRIVATE-MARKER");
    const bytes = sampleExtension(track, "uuid", marker);
    expect(readVideo(bytes)).toEqual(readVideo(source));
    const clean = Buffer.from(stripVideoMetadata(bytes));
    expect(clean.includes(marker)).toBe(false);
    expect(readVideo(clean)).toEqual(readVideo(source));
  });

  it("rejects an unsafe original at finalize without promoting it", async () => {
    const bytes = compact();
    const db = fakeSupabase();
    const admin = Object.assign({}, db.client, {
      rpc: async () => ({ data: { status: "reserved" }, error: null }),
    }) as unknown as SupabaseClient;
    const signed = await signUpload(admin, {
      businessId, userId: "u", mime: "video/mp4", bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), width: 720, height: 1280, durationMs: 2000, rightsConfirmedAt: "x",
    });
    if (signed.duplicate) throw new Error("Unexpected duplicate");
    db.objects.set(signed.path, bytes);
    const row = db.tables.media_assets.find((entry) => entry.id === signed.id) as MediaRow;
    await expect(finalizeUpload(admin, row)).rejects.toMatchObject({ status: 415, code: "MEDIA_TYPE" });
    expect(db.objects.has(signed.path)).toBe(false);
    expect(db.storageCalls.filter((call) => call.op === "upload")).toHaveLength(0);
    expect(db.tables.media_assets[0]).toMatchObject({ status: "pending", deleted_at: expect.any(String) });
  });

  it("rejects malformed AVC samples before promoting them", async () => {
    const bytes = malformedSeiLength();
    const db = fakeSupabase();
    const admin = Object.assign({}, db.client, {
      rpc: async () => ({ data: { status: "reserved" }, error: null }),
    }) as unknown as SupabaseClient;
    const signed = await signUpload(admin, {
      businessId, userId: "u", mime: "video/mp4", bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), width: 720, height: 1280, durationMs: 2000, rightsConfirmedAt: "x",
    });
    if (signed.duplicate) throw new Error("Unexpected duplicate");
    db.objects.set(signed.path, bytes);
    const row = db.tables.media_assets.find((entry) => entry.id === signed.id) as MediaRow;
    await expect(finalizeUpload(admin, row)).rejects.toMatchObject({ status: 415, code: "MEDIA_TYPE" });
    expect(db.objects.has(signed.path)).toBe(false);
    expect(db.storageCalls.filter((call) => call.op === "upload")).toHaveLength(0);
    expect(db.tables.media_assets[0]).toMatchObject({ status: "pending", deleted_at: expect.any(String) });
  });
});
