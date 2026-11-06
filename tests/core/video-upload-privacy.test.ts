import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readVideo, stripVideoMetadata } from "@/lib/media/mp4";

const source = readFileSync("tests/fixtures/media/data-track.mp4");

function seiLengthOffset(bytes: Buffer, marker: Buffer): number {
  const markerOffset = bytes.indexOf(marker);
  for (let offset = markerOffset - 5; offset >= 0; offset--) {
    const length = bytes.readUInt32BE(offset);
    const payload = offset + 4;
    if (length > 0 && payload + length <= bytes.length && payload <= markerOffset
      && markerOffset + marker.length <= payload + length && (bytes[payload] & 0x1f) === 6) return offset;
  }
  throw new Error("Missing length-prefixed SEI fixture");
}

describe("video-upload privacy gate (#2857)", () => {
  it("removes a recorded non-media track and rejects an unsupported sample map", () => {
    const secret = Buffer.from("TRACKSECRET");
    const clean = Buffer.from(stripVideoMetadata(source));
    expect(source.includes(secret)).toBe(true);
    expect(clean.includes(secret)).toBe(false);
    expect(readVideo(clean)).toEqual(readVideo(source));

    const unsupported = Buffer.from(source);
    const sampleTable = unsupported.lastIndexOf("stsz");
    if (sampleTable < 0) throw new Error("Missing metadata sample table");
    unsupported.write("stz2", sampleTable, "ascii");
    expect(readVideo(unsupported)).toBeNull();
    expect(() => stripVideoMetadata(unsupported)).toThrow();
  });

  it("refuses or removes ancillary user data hidden in an encoded video sample", () => {
    const bytes = Buffer.from(source);
    const marker = Buffer.from("PRIVATE-SEI");
    const offset = bytes.indexOf("x264 - core");
    if (offset < 0) throw new Error("Missing fixture SEI");
    marker.copy(bytes, offset);
    if (!readVideo(bytes)) {
      expect(() => stripVideoMetadata(bytes)).toThrow();
    } else {
      expect(Buffer.from(stripVideoMetadata(bytes)).includes(marker)).toBe(false);
    }
  });

  it("rejects a malformed AVC NAL length instead of preserving unparsed sample bytes", () => {
    const bytes = Buffer.from(source);
    const marker = Buffer.from("x264 - core");
    const offset = seiLengthOffset(bytes, marker);
    bytes.writeUInt32BE(0x7fffffff, offset);
    expect(() => stripVideoMetadata(bytes)).toThrow();
  });
});
