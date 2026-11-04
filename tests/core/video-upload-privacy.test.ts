import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readVideo, stripVideoMetadata } from "@/lib/media/mp4";

const source = readFileSync("tests/fixtures/media/data-track.mp4");

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
});
