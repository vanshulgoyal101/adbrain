import sharp from "sharp";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * #661: the anonymous Pollinations tier ignores nologo and stamps "pollinations.ai" in the bottom-right
 * (about the last 30 px of an 858 px image). Its images lose a bottom strip (6%, at least 44 px) and the
 * same share of the width, centred, so the shape is kept. Images under 400 px aren't stamped answers.
 */
function watermarkFreeRegion(width: number, height: number) {
  if (height < 400) return null;
  const keptHeight = height - Math.max(Math.round(height * 0.06), 44);
  const keptWidth = Math.round((width * keptHeight) / height);
  return { left: Math.floor((width - keptWidth) / 2), top: 0, width: keptWidth, height: keptHeight };
}

export async function validateRaster(bytes: Uint8Array, options: { trimWatermark?: boolean } = {}) {
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES)
    throw new Error("Image is empty or exceeds 20 MB.");
  const image = sharp(bytes, {
    limitInputPixels: 40_000_000,
    failOn: "warning",
  });
  const metadata = await image.metadata();
  if (
    !["png", "jpeg", "webp"].includes(metadata.format ?? "") ||
    (metadata.pages ?? 1) > 1
  )
    throw new Error("Expected a single PNG, JPEG or WebP image.");
  let { data, info } = await image
    .rotate()
    .png()
    .toBuffer({ resolveWithObject: true });
  const region = options.trimWatermark ? watermarkFreeRegion(info.width, info.height) : null;
  if (region) ({ data, info } = await sharp(data).extract(region).png().toBuffer({ resolveWithObject: true }));
  if (data.byteLength > MAX_IMAGE_BYTES)
    throw new Error("Decoded image exceeds 20 MB.");
  return {
    bytes: data,
    contentType: "image/png",
    width: info.width,
    height: info.height,
  };
}

export async function readBoundedResponse(
  response: Response,
  maximum = MAX_IMAGE_BYTES,
): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel();
    throw new Error("Image response is too large.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Image response has no body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error("Image response is too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
