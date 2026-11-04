/**
 * #748 (#2653 = A): the little of MP4/MOV (ISO BMFF / QuickTime boxes) the server needs to check an owner's video
 * without decoding it: its container, length and shown size. Both formats share the box layout.
 */
export type VideoInfo = { mime: "video/mp4" | "video/quicktime"; durationMs: number; width: number; height: number };

type Box = { type: string; start: number; content: number; end: number };
type Chunk = { start: number; end: number; keep: boolean };
type Range = { start: number; end: number };
type Privacy = { privateBoxes: Box[]; padding: Box[]; fields: Range[] };
type VideoPlan = Privacy & { info: VideoInfo; mdats: Box[]; chunks: Chunk[] };

const MAX_BOXES = 100_000;
const MAX_CHUNKS = 100_000;
const MAX_SAMPLES = 1_000_000;
const MAX_DEPTH = 16;
const KEPT_TRACKS = new Set(["vide", "soun"]);
const PRIVATE = new Set(["udta", "meta", "uuid", "XMP_", "loci", "ID32", "ilst", "keys"]);
const PADDING = new Set(["free", "skip", "wide"]);
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "tapt"]);
const CHILDREN: Record<string, ReadonlySet<string>> = {
  root: new Set(["ftyp", "moov", "mdat"]),
  moov: new Set(["mvhd", "trak"]),
  trak: new Set(["tkhd", "edts", "mdia", "tapt"]),
  edts: new Set(["elst"]),
  tapt: new Set(["clef", "prof", "enof"]),
  mdia: new Set(["mdhd", "hdlr", "minf"]),
  minf: new Set(["vmhd", "smhd", "hmhd", "nmhd", "hdlr", "dinf", "stbl"]),
  dinf: new Set(["dref"]),
  stbl: new Set(["stsd", "stts", "stss", "ctts", "stsc", "stsz", "stco", "co64", "sbgp", "sgpd", "stps", "stsh"]),
};
const VIDEO_ENTRIES = new Set(["avc1", "avc3", "hvc1", "hev1", "mp4v", "jpeg", "mjpa", "mjpg", "vp09", "av01"]);
const AUDIO_ENTRIES = new Set(["mp4a", "alac", "ac-3", "ec-3", "Opus", "fLaC", "lpcm", "sowt", "twos", "in24", "in32", "fl32", "fl64", "ulaw", "alaw"]);
const VIDEO_EXTENSIONS = new Set(["avcC", "hvcC", "av1C", "vpcC", "esds", "btrt", "pasp", "clap", "colr", "fiel", "gama", "mdcv", "clli"]);
const AUDIO_EXTENSIONS = new Set(["frma", "mp4a", "esds", "btrt", "chan", "enda", "alac", "dac3", "dec3", "ddts", "dfLa", "dOps", "glbl"]);
const FIXED_EXTENSIONS: Record<string, number> = { btrt: 12, pasp: 8, clap: 32, fiel: 2, gama: 4, mdcv: 24, clli: 4, frma: 4, enda: 2 };

function boxes(bytes: Uint8Array, from: number, to: number): Box[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: Box[] = [];
  let at = from;
  while (at < to) {
    if (to - at < 8 || found.length >= MAX_BOXES) return null;
    let size = view.getUint32(at);
    let header = 8;
    if (size === 1) {
      if (to - at < 16) return null;
      const extended = view.getBigUint64(at + 8);
      if (extended > BigInt(to - at)) return null;
      size = Number(extended);
      header = 16;
    } else if (size === 0) size = to - at;
    if (size < header || size > to - at) return null;
    found.push({ type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)), start: at, content: at + header, end: at + size });
    at += size;
  }
  return found;
}

const children = (bytes: Uint8Array, box: Box) => boxes(bytes, box.content, box.end);
function only(items: Box[] | null, type: string): Box | null {
  const matching = items?.filter((item) => item.type === type);
  return matching?.length === 1 ? matching[0] : null;
}

function containsChunk(mdats: Box[], start: number, end: number): boolean {
  let low = 0, high = mdats.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (mdats[middle].content <= start) low = middle + 1;
    else high = middle;
  }
  const mdat = mdats[low - 1];
  return !!mdat && start >= mdat.content && end <= mdat.end;
}

function localReferences(bytes: Uint8Array, view: DataView, minf: Box): number | null {
  const dinf = only(children(bytes, minf), "dinf");
  const dref = dinf && only(children(bytes, dinf), "dref");
  if (!dref || dref.end - dref.content < 8 || view.getUint32(dref.content) !== 0) return null;
  const count = view.getUint32(dref.content + 4);
  const refs = boxes(bytes, dref.content + 8, dref.end);
  if (!refs || !count || refs.length !== count) return null;
  if (refs.some((ref) => ref.type !== "url " || ref.end - ref.content !== 4 || view.getUint32(ref.content) !== 1)) return null;
  return count;
}

function samplePrivacy(bytes: Uint8Array, view: DataView, handler: string, descriptions: Box[], budget: { boxes: number }): Privacy | null {
  const privacy: Privacy = { privateBoxes: [], padding: [], fields: [] };
  if (!KEPT_TRACKS.has(handler)) return privacy;
  const video = handler === "vide";
  const extensions = (items: Box[], depth: number): boolean => {
    if (depth > MAX_DEPTH) return false;
    return items.every((box) => {
      if (--budget.boxes < 0) return false;
      if (PRIVATE.has(box.type) || box.type.charCodeAt(0) === 0xa9) { privacy.privateBoxes.push(box); return true; }
      if (PADDING.has(box.type)) { privacy.padding.push(box); return true; }
      if (!video && box.type === "wave") {
        const nested = children(bytes, box);
        return !!nested && extensions(nested, depth + 1);
      }
      if (!video && box.type === "\0\0\0\0") return box.end === box.content;
      if (!(video ? VIDEO_EXTENSIONS : AUDIO_EXTENSIONS).has(box.type)) return false;
      const length = FIXED_EXTENSIONS[box.type];
      if (length !== undefined) return box.end - box.content === length;
      if (box.type === "colr") {
        const format = String.fromCharCode(...bytes.subarray(box.content, box.content + 4));
        return (format === "nclc" && box.end - box.content === 10) || (format === "nclx" && box.end - box.content === 11);
      }
      return true;
    });
  };
  for (const entry of descriptions) {
    if (!(video ? VIDEO_ENTRIES : AUDIO_ENTRIES).has(entry.type)) return null;
    let base = 78;
    if (video) {
      if (entry.end - entry.content < base) return null;
      privacy.fields.push({ start: entry.content + 42, end: entry.content + 74 });
    } else {
      if (entry.end - entry.content < 28) return null;
      const version = view.getUint16(entry.content + 8);
      if (version > 2) return null;
      base = version === 0 ? 28 : version === 1 ? 44 : 64;
      if (entry.end - entry.content < base) return null;
    }
    const extra = boxes(bytes, entry.content + base, entry.end);
    if (!extra || !extensions(extra, 0)) return null;
  }
  return privacy;
}

function trackChunks(bytes: Uint8Array, view: DataView, trak: Box, mdats: Box[], remainingChunks: number, remainingSamples: number, budget: { boxes: number }):
  (Privacy & { handler: string; chunks: Chunk[]; chunkCount: number; sampleCount: number }) | null {
  const trakBoxes = children(bytes, trak);
  const mdia = only(trakBoxes, "mdia");
  const mdiaBoxes = mdia && children(bytes, mdia);
  const hdlr = only(mdiaBoxes, "hdlr");
  const minf = only(mdiaBoxes, "minf");
  if (!hdlr || hdlr.end - hdlr.content < 12 || !minf) return null;
  const handler = String.fromCharCode(...bytes.subarray(hdlr.content + 8, hdlr.content + 12));
  const keep = KEPT_TRACKS.has(handler);
  const refs = localReferences(bytes, view, minf);
  const stbl = only(children(bytes, minf), "stbl");
  const tables = stbl && children(bytes, stbl);
  if (!refs || !tables) return null;

  const stsd = only(tables, "stsd");
  const stsz = only(tables, "stsz");
  const stsc = only(tables, "stsc");
  const offsets = tables.filter((box) => box.type === "stco" || box.type === "co64");
  if (!stsd || !stsz || !stsc || offsets.length !== 1 || tables.some((box) => box.type === "stz2")) return null;
  const stco = offsets[0];
  if (stsd.end - stsd.content < 8 || stsz.end - stsz.content < 12 || stsc.end - stsc.content < 8 || stco.end - stco.content < 8
    || [stsd, stsz, stsc, stco].some((box) => view.getUint32(box.content) !== 0)) return null;

  const descriptions = boxes(bytes, stsd.content + 8, stsd.end);
  if (!descriptions || descriptions.length !== view.getUint32(stsd.content + 4) || !descriptions.length
    || descriptions.some((box) => box.end - box.content < 8 || !view.getUint16(box.content + 6) || view.getUint16(box.content + 6) > refs)) return null;
  budget.boxes -= descriptions.length;
  if (budget.boxes < 0) return null;
  const privacy = samplePrivacy(bytes, view, handler, descriptions, budget);
  if (!privacy) return null;
  const fixed = view.getUint32(stsz.content + 4);
  const samples = view.getUint32(stsz.content + 8);
  const runs = view.getUint32(stsc.content + 4);
  const count = view.getUint32(stco.content + 4);
  const wide = stco.type === "co64";
  if (samples > remainingSamples || count > remainingChunks
    || stsz.end - stsz.content !== 12 + (fixed ? 0 : samples * 4)
    || stsc.end - stsc.content !== 8 + runs * 12
    || stco.end - stco.content !== 8 + count * (wide ? 8 : 4)) return null;
  if (!samples) return runs || count ? null : { ...privacy, handler, chunks: [], chunkCount: 0, sampleCount: 0 };
  if (!runs || !count) return null;

  let previousFirst = 0;
  for (let run = 0; run < runs; run++) {
    const at = stsc.content + 8 + run * 12;
    const first = view.getUint32(at), perChunk = view.getUint32(at + 4), description = view.getUint32(at + 8);
    if ((run === 0 && first !== 1) || first <= previousFirst || first > count || !perChunk || !description || description > descriptions.length) return null;
    previousFirst = first;
  }

  const chunks: Chunk[] = [];
  let sample = 0, run = 0;
  for (let chunk = 1; chunk <= count; chunk++) {
    while (run + 1 < runs && view.getUint32(stsc.content + 8 + (run + 1) * 12) <= chunk) run++;
    const perChunk = view.getUint32(stsc.content + 12 + run * 12);
    if (perChunk > samples - sample) return null;
    let size = fixed * perChunk;
    if (!fixed) {
      for (let i = 0; i < perChunk; i++) {
        size += view.getUint32(stsz.content + 12 + (sample + i) * 4);
        if (size > bytes.length) return null;
      }
    }
    if (!Number.isSafeInteger(size) || size > bytes.length) return null;
    sample += perChunk;
    const offsetAt = stco.content + 8 + (chunk - 1) * (wide ? 8 : 4);
    const raw = wide ? view.getBigUint64(offsetAt) : BigInt(view.getUint32(offsetAt));
    if (raw > BigInt(bytes.length)) return null;
    const start = Number(raw), end = start + size;
    if (end > bytes.length || !containsChunk(mdats, start, end)) return null;
    if (size) chunks.push({ start, end, keep });
  }
  return sample === samples ? { ...privacy, handler, chunks, chunkCount: count, sampleCount: samples } : null;
}

function validLeaf(bytes: Uint8Array, view: DataView, box: Box, fields: Range[]): boolean {
  const length = box.end - box.content;
  const version = bytes[box.content];
  if (box.type === "ftyp") return length >= 8 && length % 4 === 0;
  if (box.type === "mvhd" || box.type === "tkhd" || box.type === "mdhd") {
    if (version !== 0 && version !== 1) return false;
    const sizes = box.type === "mvhd" ? [100, 112] : box.type === "tkhd" ? [84, 96] : [24, 36];
    if (length !== sizes[version]) return false;
    fields.push({ start: box.content + 4, end: box.content + (version === 1 ? 20 : 12) });
    return true;
  }
  if (box.type === "hdlr") {
    if (length < 24) return false;
    fields.push({ start: box.content + 24, end: box.end });
    return true;
  }
  const fixed: Record<string, number> = { vmhd: 12, smhd: 8, hmhd: 20, nmhd: 4, clef: 12, prof: 12, enof: 12 };
  if (fixed[box.type] !== undefined) return length === fixed[box.type];
  const entries: Record<string, number> = { stts: 8, stss: 4, ctts: 8, stps: 4, stsh: 8 };
  if (entries[box.type] !== undefined || box.type === "elst") {
    if (length < 8 || (view.getUint32(box.content) & 0x00ffffff) !== 0
      || (version !== 0 && !(version === 1 && (box.type === "ctts" || box.type === "elst")))) return false;
    const size = box.type === "elst" ? (version === 1 ? 20 : 12) : entries[box.type];
    return length === 8 + view.getUint32(box.content + 4) * size;
  }
  if (box.type === "sbgp" || box.type === "sgpd") {
    if (length < 12 || (view.getUint32(box.content) & 0x00ffffff) !== 0) return false;
    const group = String.fromCharCode(...bytes.subarray(box.content + 4, box.content + 8));
    if (group !== "roll" && group !== "prol") return false;
    if (box.type === "sbgp") {
      if (version !== 0 && version !== 1) return false;
      const countAt = box.content + (version === 1 ? 12 : 8);
      return countAt + 4 <= box.end && length === countAt - box.content + 4 + view.getUint32(countAt) * 8;
    }
    if (version > 2) return false;
    if (version === 0) return length === 12 + view.getUint32(box.content + 8) * 2;
    if (length < (version === 1 ? 16 : 20) || view.getUint32(box.content + 8) !== 2) return false;
    const countAt = box.content + (version === 1 ? 12 : 16);
    return length === countAt - box.content + 4 + view.getUint32(countAt) * 2;
  }
  return true;
}

function planVideo(bytes: Uint8Array): VideoPlan | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const top = boxes(bytes, 0, bytes.length);
  const ftyp = only(top, "ftyp"), moov = only(top, "moov");
  if (!top || !ftyp || ftyp.end - ftyp.content < 4 || !moov || top.some((box) => box.type === "moof" || box.type === "mfra")) return null;
  const mdats = top.filter((box) => box.type === "mdat");
  const movieBoxes = children(bytes, moov);
  const mvhd = only(movieBoxes, "mvhd");
  if (!mdats.length || !movieBoxes || movieBoxes.some((box) => box.type === "mvex") || !mvhd || mvhd.end - mvhd.content < 32) return null;
  const version = bytes[mvhd.content];
  if (version !== 0 && version !== 1) return null;
  const timescale = view.getUint32(mvhd.content + (version === 1 ? 20 : 12));
  const duration = version === 1 ? Number(view.getBigUint64(mvhd.content + 24)) : view.getUint32(mvhd.content + 16);
  if (!timescale || !duration || !Number.isSafeInteger(duration)) return null;

  const chunks: Chunk[] = [];
  const privateBoxes: Box[] = [], padding: Box[] = [], fields: Range[] = [];
  const removedTracks = new Set<number>();
  const budget = { boxes: MAX_BOXES };
  let remainingChunks = MAX_CHUNKS, remainingSamples = MAX_SAMPLES;
  let video: Box | null = null;
  for (const trak of movieBoxes.filter((box) => box.type === "trak")) {
    const track = trackChunks(bytes, view, trak, mdats, remainingChunks, remainingSamples, budget);
    if (!track) return null;
    remainingChunks -= track.chunkCount;
    remainingSamples -= track.sampleCount;
    for (const chunk of track.chunks) chunks.push(chunk);
    for (const box of track.privateBoxes) privateBoxes.push(box);
    for (const box of track.padding) padding.push(box);
    for (const field of track.fields) fields.push(field);
    if (track.handler === "vide" && track.chunks.length && !video) video = trak;
    if (!KEPT_TRACKS.has(track.handler)) removedTracks.add(trak.start);
  }
  if (!video) return null;
  chunks.sort((a, b) => a.start - b.start);
  for (let index = 1; index < chunks.length; index++) {
    if (chunks[index].start < chunks[index - 1].end) return null;
  }

  const tkhd = only(children(bytes, video), "tkhd");
  if (!tkhd || (bytes[tkhd.content] !== 0 && bytes[tkhd.content] !== 1)) return null;
  const base = bytes[tkhd.content] === 1 ? 52 : 40;
  if (tkhd.end - tkhd.content < base + 44) return null;
  let width = view.getUint32(tkhd.content + base + 36) / 65536;
  let height = view.getUint32(tkhd.content + base + 40) / 65536;
  // Phones store portrait video landscape with a 90° matrix: a = 0 means a quarter turn.
  if (view.getInt32(tkhd.content + base) === 0) [width, height] = [height, width];
  width = Math.round(width);
  height = Math.round(height);
  if (!width || !height) return null;

  let visited = 0;
  const walk = (items: Box[], parent: string, depth: number): boolean => {
    if (depth > MAX_DEPTH) return false;
    return items.every((box) => {
      if (++visited > MAX_BOXES) return false;
      if (PRIVATE.has(box.type) || box.type.charCodeAt(0) === 0xa9 || (box.type === "trak" && removedTracks.has(box.start))) {
        privateBoxes.push(box);
        return true;
      }
      if (PADDING.has(box.type)) { padding.push(box); return true; }
      if (!CHILDREN[parent]?.has(box.type)) return false;
      if (!CONTAINERS.has(box.type)) return validLeaf(bytes, view, box, fields);
      const nested = children(bytes, box);
      return !!nested && walk(nested, box.type, depth + 1);
    });
  };
  if (!walk(top, "root", 0)) return null;
  const brand = String.fromCharCode(...bytes.subarray(ftyp.content, ftyp.content + 4));
  return {
    info: { mime: brand === "qt  " ? "video/quicktime" : "video/mp4", durationMs: Math.round(duration * 1000 / timescale), width, height },
    mdats, chunks, privateBoxes, padding, fields,
  };
}

/** Container, duration and display size, or null when its container cannot be safely mapped. */
export function readVideo(bytes: Uint8Array): VideoInfo | null {
  return planVideo(bytes)?.info ?? null;
}

/**
 * Blank known private boxes and everything in `mdat` except proven picture and sound chunks. Unsupported or incomplete
 * sample maps are rejected; same-size `free` boxes preserve media offsets. Encoded samples are not inspected, so this
 * alone does not establish a complete metadata-privacy guarantee.
 */
export function stripVideoMetadata(bytes: Uint8Array): Uint8Array {
  const plan = planVideo(bytes);
  if (!plan) throw new Error("unsafe video metadata");
  const out = new Uint8Array(bytes);
  let index = 0;
  for (const mdat of plan.mdats) {
    let cursor = mdat.content;
    while (index < plan.chunks.length && plan.chunks[index].start < mdat.end) {
      const chunk = plan.chunks[index++];
      if (!chunk.keep) continue;
      out.fill(0, cursor, chunk.start);
      cursor = chunk.end;
    }
    out.fill(0, cursor, mdat.end);
  }
  for (const box of plan.privateBoxes) {
    out.set([0x66, 0x72, 0x65, 0x65], box.start + 4);
    out.fill(0, box.content, box.end);
  }
  for (const box of plan.padding) out.fill(0, box.content, box.end);
  for (const field of plan.fields) out.fill(0, field.start, field.end);
  return out;
}
