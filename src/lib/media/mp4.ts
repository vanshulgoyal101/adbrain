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

const handler = (bytes: Uint8Array, trak: Box) => {
  const hdlr = child(bytes, child(bytes, trak, "mdia"), "hdlr");
  return hdlr && hdlr.end - hdlr.content >= 12 ? String.fromCharCode(...bytes.subarray(hdlr.content + 8, hdlr.content + 12)) : "";
};

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
    if (handler(bytes, trak) !== "vide") continue;
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
const KEPT_TRACKS = new Set(["vide", "soun"]);

/** Zero the samples a track points at in `mdat` (stsz sizes, stsc chunk runs, stco/co64 chunk offsets). */
function zeroSamples(out: Uint8Array, trak: Box) {
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const stbl = child(out, child(out, child(out, trak, "mdia"), "minf"), "stbl");
  const stsz = child(out, stbl, "stsz");
  const stsc = child(out, stbl, "stsc");
  const stco = child(out, stbl, "stco") ?? child(out, stbl, "co64");
  if (!stsz || !stsc || !stco || stsz.end - stsz.content < 12 || stsc.end - stsc.content < 8 || stco.end - stco.content < 8) return;
  const fixed = view.getUint32(stsz.content + 4);
  const samples = Math.min(view.getUint32(stsz.content + 8), fixed ? Infinity : (stsz.end - stsz.content - 12) / 4);
  const runs = Math.min(view.getUint32(stsc.content + 4), (stsc.end - stsc.content - 8) / 12);
  const wide = stco.type === "co64";
  const chunks = Math.min(view.getUint32(stco.content + 4), (stco.end - stco.content - 8) / (wide ? 8 : 4));
  let sample = 0;
  let run = 0;
  for (let chunk = 1; chunk <= chunks && sample < samples; chunk++) {
    while (run + 1 < runs && view.getUint32(stsc.content + 8 + (run + 1) * 12) <= chunk) run++;
    const perChunk = runs ? view.getUint32(stsc.content + 8 + run * 12 + 4) : 0;
    let at = wide ? Number(view.getBigUint64(stco.content + 8 + (chunk - 1) * 8)) : view.getUint32(stco.content + 8 + (chunk - 1) * 4);
    const count = Math.min(perChunk, samples - sample);
    if (fixed) {
      out.fill(0, Math.min(at, out.length), Math.min(at + fixed * count, out.length));
      sample += count;
      continue;
    }
    for (let i = 0; i < count && at < out.length; i++, sample++) {
      const size = view.getUint32(stsz.content + 12 + sample * 4);
      out.fill(0, at, Math.min(at + size, out.length));
      at += size;
    }
  }
}

/**
 * A copy with user data, metadata and XMP boxes (an iPhone's location, the device, times) blanked: each becomes a
 * same-size `free` box of zeros, so every offset into `mdat` stays right and nothing is re-encoded (Reviewer, #1245:
 * no location leaves with an owner's media). Tracks other than picture and sound (an iPhone's timed metadata, a
 * GoPro's GPS stream) go too: their samples in `mdat` are zeroed first, then their `trak` is blanked.
 */
export function stripVideoMetadata(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  const toFree = (box: Box) => {
    out.set([0x66, 0x72, 0x65, 0x65], box.start + 4);
    out.fill(0, box.content, box.end);
  };
  const blank = (from: number, to: number, depth: number) => {
    for (const box of boxes(out, from, to)) {
      if (PRIVATE.has(box.type)) toFree(box);
      else if (box.type === "trak" && !KEPT_TRACKS.has(handler(out, box))) {
        zeroSamples(out, box);
        toFree(box);
      } else if (depth < 2 && (box.type === "moov" || box.type === "trak")) blank(box.content, box.end, depth + 1);
    }
  };
  blank(0, out.length, 0);
  return out;
}
