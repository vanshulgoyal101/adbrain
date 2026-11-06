import { describe, expect, it } from "vitest";
import { parseAvcNalLengthSize, stripAvcSei } from "@/lib/media/avc";

describe("AVC sample sanitization", () => {
  it("rejects samples without a picture slice after removing SEI NALs", () => {
    const sample = Buffer.from([
      0, 0, 0, 2, 0x06, 0x80,
      0, 0, 0, 2, 0x67, 0x80,
    ]);
    expect(stripAvcSei(sample, 4)).toBeNull();
  });

  it("rejects an AVC configuration whose SPS entry has the wrong NAL type", () => {
    const configuration = Uint8Array.from([1, 66, 0, 30, 0xff, 0xe1, 0, 1, 0x66, 1, 0, 1, 0x68]);
    expect(parseAvcNalLengthSize(configuration)).toBeNull();
  });

  it("removes SEI units from samples using two-byte NAL lengths", () => {
    const sample = Uint8Array.from([0, 3, 0x06, 0x05, 0x80, 0, 2, 0x65, 0x80]);
    expect(stripAvcSei(sample, 2)).toEqual(Uint8Array.from([0, 2, 0x65, 0x80]));
  });
});
