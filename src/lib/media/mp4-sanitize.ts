import { avcSeiStrippedLength, writeAvcSampleWithoutSei } from "@/lib/media/avc";
import type { VideoPlan } from "@/lib/media/mp4";

export class UnsafeVideoError extends Error {
  constructor() {
    super("unsafe video metadata");
    this.name = "UnsafeVideoError";
  }
}

export function sanitizeVideoMetadata(bytes: Uint8Array, plan: VideoPlan | null): Uint8Array {
  if (!plan) throw new UnsafeVideoError();
  const out = new Uint8Array(bytes);
  const outView = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const fixedSizes = new Map<number, number>();

  for (const chunk of plan.chunks) {
    if (!chunk.video) continue;
    for (const sample of chunk.samples) {
      if (sample.nalLengthSize === null || sample.start === sample.end) throw new UnsafeVideoError();
      const sanitizedSize = avcSeiStrippedLength(bytes.subarray(sample.start, sample.end), sample.nalLengthSize);
      if (sanitizedSize === null) throw new UnsafeVideoError();
      sample.sanitizedSize = sanitizedSize;
      if (sample.sizeField !== null) outView.setUint32(sample.sizeField, sanitizedSize);
      else if (sample.fixedSizeField !== null) {
        const previous = fixedSizes.get(sample.fixedSizeField);
        if (previous !== undefined && previous !== sanitizedSize) throw new UnsafeVideoError();
        fixedSizes.set(sample.fixedSizeField, sanitizedSize);
      }
    }
  }

  for (const [field, size] of fixedSizes) {
    outView.setUint32(field, size);
  }

  const chunksByMdat = plan.mdats.map(() => [] as VideoPlan["chunks"]);
  let mdatIndex = 0;
  for (const chunk of plan.chunks) {
    while (mdatIndex < plan.mdats.length && plan.mdats[mdatIndex].end < chunk.start) mdatIndex++;
    const mdat = plan.mdats[mdatIndex];
    if (!mdat || chunk.start < mdat.content || chunk.end > mdat.end) throw new UnsafeVideoError();
    chunksByMdat[mdatIndex].push(chunk);
  }

  for (let index = 0; index < plan.mdats.length; index++) {
    const mdat = plan.mdats[index];
    let cursor = mdat.content;
    for (const chunk of chunksByMdat[index]) {
      const chunkStart = cursor;
      if (chunk.keep && chunk.video) {
        for (const sample of chunk.samples) {
          if (sample.nalLengthSize === null || sample.sanitizedSize === null) throw new UnsafeVideoError();
          const written = writeAvcSampleWithoutSei(
            bytes.subarray(sample.start, sample.end), sample.nalLengthSize, out, cursor,
          );
          if (written !== sample.sanitizedSize || cursor + written > mdat.end) throw new UnsafeVideoError();
          cursor += written;
        }
      } else if (chunk.keep) {
        const size = chunk.end - chunk.start;
        if (cursor + size > mdat.end) throw new UnsafeVideoError();
        out.set(bytes.subarray(chunk.start, chunk.end), cursor);
        cursor += size;
      } else {
        const size = chunk.end - chunk.start;
        if (cursor + size > mdat.end) throw new UnsafeVideoError();
        out.fill(0, cursor, cursor + size);
        cursor += size;
      }
      if (chunk.offsetWide) outView.setBigUint64(chunk.offsetField, BigInt(chunkStart));
      else {
        if (chunkStart > 0xffffffff) throw new UnsafeVideoError();
        outView.setUint32(chunk.offsetField, chunkStart);
      }
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
