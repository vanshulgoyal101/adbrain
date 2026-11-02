import sharp from "sharp";

/**
 * #1897: the `creatives` bucket passed the free plan's 1 GB with ~1 MB PNG posters (p90 3.1 MB). Generated and edited
 * ads are stored as WebP: quality 90 keeps a poster's small text sharp (lossy WebP smears it lower), 80 only if that
 * is still over the cap. Old PNG rows are left as they are.
 */
export const MAX_STORED_IMAGE_BYTES = 1_500_000;
const STORAGE_QUALITIES = [90, 80];

export function isWebp(bytes: Uint8Array): boolean {
  return bytes.length > 12 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF"
    && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP";
}

/** The WebP to store, or null to keep the original bytes (already smaller, or not an image sharp can read). */
export async function storageWebp(bytes: Uint8Array): Promise<Uint8Array | null> {
  let smallest: Buffer | null = null;
  for (const quality of STORAGE_QUALITIES) {
    const encoded = await sharp(bytes).rotate().webp({ quality, effort: 4 }).toBuffer();
    if (!smallest || encoded.length < smallest.length) smallest = encoded;
    if (encoded.length <= MAX_STORED_IMAGE_BYTES) break;
  }
  return smallest && smallest.length < bytes.length ? new Uint8Array(smallest) : null;
}

/** An owner's download (any stored format): a JPEG any app takes, about a tenth of a PNG; transparency goes white. */
export async function downloadJpeg(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await sharp(bytes).flatten({ background: "#ffffff" }).jpeg({ quality: 92, mozjpeg: true }).toBuffer());
}

/** Meta's ad images take JPEG or PNG; a stored WebP is sent as a high-quality JPEG. */
export async function jpegIfWebp(bytes: Uint8Array): Promise<{ bytes: Uint8Array; converted: boolean }> {
  if (!isWebp(bytes)) return { bytes, converted: false };
  return { bytes: new Uint8Array(await sharp(bytes).jpeg({ quality: 92, mozjpeg: true }).toBuffer()), converted: true };
}
