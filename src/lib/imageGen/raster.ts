import sharp from "sharp";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export async function validateRaster(bytes: Uint8Array) {
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
  const { data, info } = await image
    .rotate()
    .png()
    .toBuffer({ resolveWithObject: true });
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
  if (Number(response.headers.get("content-length")) > maximum)
    throw new Error("Image response is too large.");
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
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
