const MAX_NAL_UNITS_PER_SAMPLE = 65_536;
const EXTENDED_AVC_PROFILES = new Set([44, 83, 86, 100, 110, 118, 122, 128, 134, 135, 138, 139, 144, 244]);

function walkAvcSample(
  sample: Uint8Array,
  lengthSize: number,
  retain: (start: number, end: number) => void,
): number | null {
  if (lengthSize !== 1 && lengthSize !== 2 && lengthSize !== 4) return null;
  let at = 0;
  let outputLength = 0;
  let nalCount = 0;
  let hasPictureSlice = false;
  let retained = false;

  while (at < sample.length) {
    if (++nalCount > MAX_NAL_UNITS_PER_SAMPLE || sample.length - at < lengthSize) return null;
    let nalLength = 0;
    for (let index = 0; index < lengthSize; index++) nalLength = nalLength * 256 + sample[at + index];
    const nalStart = at + lengthSize;
    if (!nalLength || nalLength > sample.length - nalStart) return null;
    const header = sample[nalStart];
    const type = header & 0x1f;
    if ((header & 0x80) !== 0 || type === 0 || type >= 24) return null;
    if (type >= 1 && type <= 5) hasPictureSlice = true;
    const end = nalStart + nalLength;
    if (type !== 6) {
      retain(at, end);
      outputLength += end - at;
      retained = true;
    }
    at = end;
  }

  return retained && hasPictureSlice ? outputLength : null;
}

export function parseAvcNalLengthSize(configuration: Uint8Array): number | null {
  if (configuration.length < 7 || configuration[0] !== 1
    || (configuration[4] & 0xfc) !== 0xfc || (configuration[5] & 0xe0) !== 0xe0) return null;
  const lengthSizeCode = configuration[4] & 3;
  if (lengthSizeCode === 2) return null;
  const lengthSize = lengthSizeCode + 1;
  let at = 6;

  const sequenceParameterSets = configuration[5] & 0x1f;
  if (!sequenceParameterSets) return null;
  for (let index = 0; index < sequenceParameterSets; index++) {
    if (at + 2 > configuration.length) return null;
    const length = (configuration[at] << 8) | configuration[at + 1];
    at += 2;
    if (!length || length > configuration.length - at
      || (configuration[at] & 0x80) !== 0 || (configuration[at] & 0x1f) !== 7) return null;
    at += length;
  }

  if (at >= configuration.length) return null;
  const pictureParameterSets = configuration[at++];
  if (!pictureParameterSets) return null;
  for (let index = 0; index < pictureParameterSets; index++) {
    if (at + 2 > configuration.length) return null;
    const length = (configuration[at] << 8) | configuration[at + 1];
    at += 2;
    if (!length || length > configuration.length - at
      || (configuration[at] & 0x80) !== 0 || (configuration[at] & 0x1f) !== 8) return null;
    at += length;
  }

  if (EXTENDED_AVC_PROFILES.has(configuration[1])) {
    if (at + 4 > configuration.length || (configuration[at] & 0xfc) !== 0xfc
      || (configuration[at + 1] & 0xf8) !== 0xf8 || (configuration[at + 2] & 0xf8) !== 0xf8) return null;
    const sequenceParameterSetExtensions = configuration[at + 3];
    at += 4;
    for (let index = 0; index < sequenceParameterSetExtensions; index++) {
      if (at + 2 > configuration.length) return null;
      const length = (configuration[at] << 8) | configuration[at + 1];
      at += 2;
      if (!length || length > configuration.length - at
        || (configuration[at] & 0x80) !== 0 || (configuration[at] & 0x1f) !== 13) return null;
      at += length;
    }
  }

  return at === configuration.length ? lengthSize : null;
}

export function avcSeiStrippedLength(sample: Uint8Array, lengthSize: number): number | null {
  return walkAvcSample(sample, lengthSize, () => undefined);
}

export function writeAvcSampleWithoutSei(
  sample: Uint8Array,
  lengthSize: number,
  output: Uint8Array,
  outputOffset: number,
): number | null {
  if (!Number.isSafeInteger(outputOffset) || outputOffset < 0 || outputOffset > output.length) return null;
  let cursor = outputOffset;
  let overflow = false;
  const length = walkAvcSample(sample, lengthSize, (start, end) => {
    if (end - start > output.length - cursor) {
      overflow = true;
      return;
    }
    output.set(sample.subarray(start, end), cursor);
    cursor += end - start;
  });
  if (length === null || overflow || cursor - outputOffset !== length) return null;
  return length;
}

export function stripAvcSei(sample: Uint8Array, lengthSize: number): Uint8Array | null {
  const length = avcSeiStrippedLength(sample, lengthSize);
  if (length === null) return null;
  const output = new Uint8Array(length);
  const written = writeAvcSampleWithoutSei(sample, lengthSize, output, 0);
  if (written !== length) return null;
  return output;
}
