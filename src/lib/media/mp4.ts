/**
 * #748 (#2653 = A): the little of MP4/MOV (ISO BMFF / QuickTime boxes) the server needs to check an owner's video
 * without decoding it: its container, length and shown size. Both formats share the box layout.
 */
export type VideoInfo = { mime: "video/mp4" | "video/quicktime"; durationMs: number; width: number; height: number };

type Box = { type: string; start: number; content: number; end: number };

function boxes(bytes: Uint8Array, from: number, to: number): Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = view.getUint32(at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) return found;
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) size = to - at;
    if (size < header || at + size > to) return found;
    found.push({ type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)), start: at, content: at + header, end: at + size });
    at += size;
  }
  return found;
}

const child = (bytes: Uint8Array, box: Box | undefined, type: string) =>
  box ? boxes(bytes, box.content, box.end).find((item) => item.type === type) : undefined;

/** Container, duration and display size, or null if this isn't a playable MP4/MOV with a video track. */
export function readVideo(bytes: Uint8Array): VideoInfo | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const top = boxes(bytes, 0, bytes.length);
  const ftyp = top.find((box) => box.type === "ftyp");
  const moov = top.find((box) => box.type === "moov");
  if (!ftyp || !moov || ftyp.end - ftyp.content < 4 || !top.some((box) => box.type === "mdat")) return null;
  const brand = String.fromCharCode(...bytes.subarray(ftyp.content, ftyp.content + 4));

  const mvhd = child(bytes, moov, "mvhd");
  if (!mvhd || mvhd.end - mvhd.content < 32) return null;
  const v1 = bytes[mvhd.content] === 1;
  const timescale = view.getUint32(mvhd.content + (v1 ? 20 : 12));
  const duration = v1 ? Number(view.getBigUint64(mvhd.content + 24)) : view.getUint32(mvhd.content + 16);
  if (!timescale || !duration) return null;

  for (const trak of boxes(bytes, moov.content, moov.end).filter((box) => box.type === "trak")) {
    const hdlr = child(bytes, child(bytes, trak, "mdia"), "hdlr");
    if (!hdlr || hdlr.end - hdlr.content < 12 || String.fromCharCode(...bytes.subarray(hdlr.content + 8, hdlr.content + 12)) !== "vide") continue;
    const tkhd = child(bytes, trak, "tkhd");
    const base = tkhd && bytes[tkhd.content] === 1 ? 52 : 40;
    if (!tkhd || tkhd.end - tkhd.content < base + 44) return null;
    let width = view.getUint32(tkhd.content + base + 36) / 65536;
    let height = view.getUint32(tkhd.content + base + 40) / 65536;
    // Phones store portrait video landscape with a 90° matrix: a = 0 means a quarter turn, so the shown size swaps.
    if (view.getInt32(tkhd.content + base) === 0) [width, height] = [height, width];
    width = Math.round(width);
    height = Math.round(height);
    if (!width || !height) return null;
    return { mime: brand === "qt  " ? "video/quicktime" : "video/mp4", durationMs: Math.round(duration * 1000 / timescale), width, height };
  }
  return null;
}

const PRIVATE = new Set(["udta", "meta", "uuid", "XMP_"]);

/**
 * A copy with user data, metadata and XMP boxes (an iPhone's location, the device, times) blanked: each becomes a
 * same-size `free` box of zeros, so every offset into `mdat` stays right and nothing is re-encoded (Reviewer, #1245:
 * no location leaves with an owner's media).
 */
export function stripVideoMetadata(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  const blank = (from: number, to: number, depth: number) => {
    for (const box of boxes(out, from, to)) {
      if (PRIVATE.has(box.type)) {
        out.set([0x66, 0x72, 0x65, 0x65], box.start + 4);
        out.fill(0, box.content, box.end);
      } else if (depth < 2 && (box.type === "moov" || box.type === "trak")) blank(box.content, box.end, depth + 1);
    }
  };
  blank(0, out.length, 0);
  return out;
}
